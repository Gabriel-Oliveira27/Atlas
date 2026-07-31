/**
 * Avaliações físicas.
 *
 * O IMC e a massa magra são GRAVADOS, não calculados na leitura: o
 * valor precisa refletir a fórmula vigente na data da avaliação, senão
 * uma mudança futura de fórmula reescreveria todo o histórico.
 */

import { Injectable } from '@nestjs/common';
import {
  AppError,
  CHANGE_OPERATION,
  buildPaginationMeta,
  calculateBmi,
  calculateBodyFatNavy,
  calculateLeanMass,
  classifyBmi,
  normalizePagination,
  type AuthenticatedUser,
  type PaginatedResult,
} from '@atlas/shared';
import type { CreateAssessmentInput, ListAssessmentsQuery } from '@atlas/validation';
import { UserScopeService } from '../../common/scope/user-scope.service.js';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
    private readonly scope: UserScopeService,
  ) {}

  /**
   * Registra uma avaliação física.
   *
   * `input.userId` permite ao professor avaliar um aluno — e por isso
   * passa pelo `UserScopeService`. Antes, o valor era aceito direto do
   * corpo da requisição: qualquer conta com `assessment:create` podia
   * gravar uma avaliação na ficha de QUALQUER usuário do sistema,
   * inclusive de outra academia.
   */
  async create(requester: AuthenticatedUser, input: CreateAssessmentInput) {
    const db = this.prisma.db;
    const targetUserId = await this.scope.resolveTargetUserId(requester, input.userId);
    const assessedById = targetUserId === requester.id ? undefined : requester.id;

    if (input.clientGeneratedId) {
      const existing = await db.assessment.findUnique({
        where: {
          userId_clientGeneratedId: {
            userId: targetUserId,
            clientGeneratedId: input.clientGeneratedId,
          },
        },
        include: { measurements: true, photos: true },
      });

      // Reenvio da fila offline: devolve o mesmo registro em vez de
      // criar uma segunda avaliação com a mesma data.
      if (existing) return { ...existing, bmiCategory: classifyBmi(existing.bmi) };
    }

    const bmi = calculateBmi(input.weightKg, input.heightCm);

    // Se o %BF não foi informado mas há medidas suficientes, calcula
    // pelo método US Navy — o usuário só precisa de uma fita métrica.
    const bodyFatPercent = input.bodyFatPercent ?? this.tryEstimateBodyFat(input);
    const leanMassKg = bodyFatPercent
      ? calculateLeanMass(input.weightKg, bodyFatPercent)
      : undefined;

    return db.$transaction(async (tx) => {
      const assessment = await tx.assessment.create({
        data: {
          userId: targetUserId,
          ...(assessedById ? { assessedById } : {}),
          assessedAt: input.assessedAt,
          weightKg: input.weightKg,
          heightCm: input.heightCm,
          bmi,
          ...(bodyFatPercent !== undefined ? { bodyFatPercent } : {}),
          ...(leanMassKg !== undefined ? { leanMassKg } : {}),
          ...(input.muscleMassKg !== undefined ? { muscleMassKg: input.muscleMassKg } : {}),
          ...(input.restingHeartRate !== undefined
            ? { restingHeartRate: input.restingHeartRate }
            : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.clientGeneratedId ? { clientGeneratedId: input.clientGeneratedId } : {}),
          originNode: this.config.nodeId,
          measurements: {
            create: input.measurements.map((measurement) => ({
              site: measurement.site,
              valueCm: measurement.valueCm,
              originNode: this.config.nodeId,
            })),
          },
          photos: {
            create: input.photos.map((photo) => ({
              pose: photo.pose,
              url: photo.url,
              ...(photo.publicId ? { publicId: photo.publicId } : {}),
              originNode: this.config.nodeId,
            })),
          },
        },
        include: { measurements: true, photos: true },
      });

      await tx.changeLog.create({
        data: {
          entity: 'Assessment',
          entityId: assessment.id,
          operation: CHANGE_OPERATION.CREATE,
          payload: assessment as never,
          version: assessment.version,
          originNode: this.config.nodeId,
          targetNode: this.prisma.replicationTarget,
        },
      });

      return { ...assessment, bmiCategory: classifyBmi(bmi) };
    });
  }

  /**
   * Histórico de avaliações, paginado.
   *
   * `query.userId` permite ao professor ver o histórico de um aluno;
   * o escopo é validado antes de qualquer consulta.
   */
  async list(
    requester: AuthenticatedUser,
    query: ListAssessmentsQuery,
  ): Promise<PaginatedResult<unknown>> {
    const userId = await this.scope.resolveTargetUserId(requester, query.userId);
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;

    const where = {
      userId,
      deletedAt: null,
      ...(query.from || query.to
        ? {
            assessedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.assessment.findMany({
        where,
        orderBy: { assessedAt: 'desc' },
        skip,
        take,
        include: { measurements: true, photos: true },
      }),
      db.assessment.count({ where }),
    ]);

    return {
      items: items.map((item) => ({ ...item, bmiCategory: classifyBmi(item.bmi) })),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findById(requester: AuthenticatedUser, id: string) {
    const assessment = await this.prisma.db.assessment.findFirst({
      where: { id, deletedAt: null },
      include: { measurements: true, photos: true },
    });

    if (!assessment) throw AppError.notFound('Avaliação', id);

    // O filtro de escopo é pelo DONO da avaliação, não pelo id do
    // solicitante: filtrar por `userId` na query devolveria 404 para o
    // professor legítimo e esconderia o erro de permissão real.
    await this.scope.assertCanAccess(requester, assessment.userId);

    return { ...assessment, bmiCategory: classifyBmi(assessment.bmi) };
  }

  /** Compara duas avaliações — alimenta a tela de evolução. */
  async compare(requester: AuthenticatedUser, fromId: string, toId: string) {
    const [from, to] = await Promise.all([
      this.findById(requester, fromId),
      this.findById(requester, toId),
    ]);

    if (from.userId !== to.userId) {
      throw AppError.validation('As duas avaliações precisam ser do mesmo usuário');
    }

    const measurementDelta = to.measurements.map((current) => {
      const previous = from.measurements.find((m) => m.site === current.site);
      return {
        site: current.site,
        from: previous?.valueCm ?? null,
        to: current.valueCm,
        delta: previous ? Number((current.valueCm - previous.valueCm).toFixed(2)) : null,
      };
    });

    return {
      from: { id: from.id, assessedAt: from.assessedAt },
      to: { id: to.id, assessedAt: to.assessedAt },
      weightDeltaKg: Number((to.weightKg - from.weightKg).toFixed(2)),
      bmiDelta: Number((to.bmi - from.bmi).toFixed(2)),
      bodyFatDelta:
        to.bodyFatPercent && from.bodyFatPercent
          ? Number((to.bodyFatPercent - from.bodyFatPercent).toFixed(2))
          : null,
      leanMassDelta:
        to.leanMassKg && from.leanMassKg
          ? Number((to.leanMassKg - from.leanMassKg).toFixed(2))
          : null,
      measurements: measurementDelta,
    };
  }

  /**
   * Estima o %BF pelo método US Navy quando há medidas suficientes.
   * Devolve `undefined` se faltar alguma — melhor não ter o dado do que
   * ter um número inventado no histórico do usuário.
   */
  private tryEstimateBodyFat(input: CreateAssessmentInput): number | undefined {
    const neck = input.measurements.find((m) => m.site === 'NECK')?.valueCm;
    const waist = input.measurements.find((m) => m.site === 'WAIST')?.valueCm;
    const hip = input.measurements.find((m) => m.site === 'HIP')?.valueCm;

    if (!neck || !waist) return undefined;

    try {
      // Sem o sexo do usuário aqui, usa a fórmula masculina apenas
      // quando não há medida de quadril; com quadril, a feminina.
      return hip
        ? calculateBodyFatNavy({
            sex: 'FEMALE',
            heightCm: input.heightCm,
            neckCm: neck,
            waistCm: waist,
            hipCm: hip,
          })
        : calculateBodyFatNavy({
            sex: 'MALE',
            heightCm: input.heightCm,
            neckCm: neck,
            waistCm: waist,
          });
    } catch {
      return undefined;
    }
  }
}
