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
  DATABASE_NODE,
  calculateBmi,
  calculateBodyFatNavy,
  calculateLeanMass,
  classifyBmi,
} from '@atlas/shared';
import type { CreateAssessmentInput } from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class AssessmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  async create(userId: string, input: CreateAssessmentInput, assessedById?: string) {
    const db = this.prisma.db;
    const targetUserId = input.userId ?? userId;

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
          targetNode: DATABASE_NODE.CLOUD,
        },
      });

      return { ...assessment, bmiCategory: classifyBmi(bmi) };
    });
  }

  async list(userId: string, limit = 20) {
    return this.prisma.db.assessment.findMany({
      where: { userId, deletedAt: null },
      orderBy: { assessedAt: 'desc' },
      take: limit,
      include: { measurements: true, photos: true },
    });
  }

  async findById(userId: string, id: string) {
    const assessment = await this.prisma.db.assessment.findFirst({
      where: { id, userId, deletedAt: null },
      include: { measurements: true, photos: true },
    });

    if (!assessment) throw AppError.notFound('Avaliação', id);

    return { ...assessment, bmiCategory: classifyBmi(assessment.bmi) };
  }

  /** Compara duas avaliações — alimenta a tela de evolução. */
  async compare(userId: string, fromId: string, toId: string) {
    const [from, to] = await Promise.all([
      this.findById(userId, fromId),
      this.findById(userId, toId),
    ]);

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
