/**
 * Serviço de usuários — módulo funcional de referência.
 *
 * Serve de MODELO para os demais módulos de negócio: mostra o uso do
 * cliente roteado (`prisma.db`), o padrão de versionamento/outbox nas
 * escritas e a checagem de escopo antes de expor dados de terceiros.
 */

import { Injectable } from '@nestjs/common';
import {
  AppError,
  buildPaginationMeta,
  calculateBmi,
  normalizePagination,
  suggestDailyWaterMl,
  type AuthenticatedUser,
  type PaginatedResult,
} from '@atlas/shared';
import { canAccessUserData } from '@atlas/auth';
import type {
  ListUsersQuery,
  LogWeightInput,
  PaginationInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
} from '@atlas/validation';
import { CHANGE_OPERATION, DATABASE_NODE } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

/** Preferências devolvidas ao cliente após atualização. */
export interface UserPreferencesView {
  theme: string;
  locale: string;
  units: string;
  preferences: unknown;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  /** Perfil completo do próprio usuário. */
  async getProfile(userId: string) {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        role: true,
        memberships: {
          where: { isActive: true },
          include: { gym: { select: { id: true, name: true, slug: true, logoUrl: true } } },
        },
      },
    });

    if (!user) throw AppError.notFound('Usuário', userId);

    return this.toProfileView(user);
  }

  /**
   * Atualiza o perfil.
   *
   * A escrita é transacional junto com o outbox: gravar o `ChangeLog`
   * depois da atualização abriria uma janela em que uma queda deixaria
   * o dado salvo mas nunca sincronizado.
   */
  async updateProfile(userId: string, input: UpdateProfileInput) {
    const db = this.prisma.db;

    return db.$transaction(async (tx) => {
      const current = await tx.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { version: true },
      });

      if (!current) throw AppError.notFound('Usuário', userId);

      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...input,
          version: current.version + 1,
          originNode: this.config.nodeId,
        },
        include: { role: true, memberships: { where: { isActive: true } } },
      });

      await tx.changeLog.create({
        data: {
          entity: 'User',
          entityId: userId,
          operation: CHANGE_OPERATION.UPDATE,
          payload: input as never,
          version: updated.version,
          originNode: this.config.nodeId,
          targetNode: DATABASE_NODE.CLOUD,
        },
      });

      return this.toProfileView(updated);
    });
  }

  /**
   * Atualiza preferências (tema, idioma, notificações).
   *
   * O tipo de retorno é anotado explicitamente: sem isso o TypeScript
   * infere tipos internos do Prisma que não são "nomeáveis" a partir de
   * outro package no pnpm (TS2742).
   */
  async updatePreferences(
    userId: string,
    input: UpdatePreferencesInput,
  ): Promise<UserPreferencesView> {
    const db = this.prisma.db;

    const current = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { version: true, preferences: true, theme: true, locale: true, units: true },
    });

    if (!current) throw AppError.notFound('Usuário', userId);

    // `theme`, `locale` e `units` têm coluna própria (são consultados);
    // o restante vai para o JSON de preferências.
    const { theme, locale, units, ...jsonPreferences } = input;
    const merged = {
      ...(current.preferences as Record<string, unknown>),
      ...jsonPreferences,
    };

    const updated = await db.user.update({
      where: { id: userId },
      data: {
        ...(theme ? { theme } : {}),
        ...(locale ? { locale } : {}),
        ...(units ? { units } : {}),
        preferences: merged,
        version: current.version + 1,
        originNode: this.config.nodeId,
      },
      select: { theme: true, locale: true, units: true, preferences: true },
    });

    return updated;
  }

  /**
   * Sugere a meta diária de água com base no peso.
   * Não grava — cabe ao usuário aceitar a sugestão.
   */
  async suggestWaterGoal(userId: string): Promise<{ suggestedMl: number; currentMl: number }> {
    const user = await this.prisma.db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { weightKg: true, dailyWaterGoalMl: true },
    });

    if (!user) throw AppError.notFound('Usuário', userId);

    if (!user.weightKg) {
      throw AppError.validation('Informe seu peso para calcular a meta de água');
    }

    return {
      suggestedMl: suggestDailyWaterMl(user.weightKg),
      currentMl: user.dailyWaterGoalMl,
    };
  }

  /** Registra um novo peso na linha do tempo de evolução. */
  async logWeight(userId: string, input: LogWeightInput) {
    const db = this.prisma.db;
    const dayKey = input.measuredAt.toISOString().slice(0, 10);

    return db.$transaction(async (tx) => {
      // Um peso por dia: repesar no mesmo dia substitui o valor anterior.
      const log = await tx.weightLog.upsert({
        where: { userId_dayKey: { userId, dayKey } },
        update: {
          weightKg: input.weightKg,
          measuredAt: input.measuredAt,
          ...(input.note ? { note: input.note } : {}),
          version: { increment: 1 },
          originNode: this.config.nodeId,
        },
        create: {
          userId,
          weightKg: input.weightKg,
          measuredAt: input.measuredAt,
          dayKey,
          ...(input.note ? { note: input.note } : {}),
          originNode: this.config.nodeId,
        },
      });

      // O peso "atual" do perfil acompanha o último registro.
      await tx.user.update({
        where: { id: userId },
        data: { weightKg: input.weightKg, version: { increment: 1 } },
      });

      await tx.changeLog.create({
        data: {
          entity: 'WeightLog',
          entityId: log.id,
          operation: CHANGE_OPERATION.CREATE,
          payload: log as never,
          version: log.version,
          originNode: this.config.nodeId,
          targetNode: DATABASE_NODE.CLOUD,
        },
      });

      return log;
    });
  }

  /** Histórico de peso para o gráfico de evolução, paginado. */
  async getWeightHistory(
    userId: string,
    query: PaginationInput,
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;
    const where = { userId, deletedAt: null };

    const [items, total] = await Promise.all([
      db.weightLog.findMany({
        where,
        orderBy: { measuredAt: 'desc' },
        skip,
        take,
        select: { id: true, weightKg: true, measuredAt: true, dayKey: true, note: true },
      }),
      db.weightLog.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Listagem para administradores.
   * O escopo por academia é aplicado aqui: um GYM_ADMIN nunca enxerga
   * alunos de outra unidade.
   */
  async list(
    requester: AuthenticatedUser,
    query: ListUsersQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;

    const gymFilter =
      requester.role === 'SUPER_ADMIN'
        ? query.gymId
          ? { memberships: { some: { gymId: query.gymId, isActive: true } } }
          : {}
        : {
            memberships: {
              some: { gymId: requester.gymId ?? '__sem_academia__', isActive: true },
            },
          };

    const where = {
      deletedAt: null,
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.role ? { role: { name: query.role } } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { email: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
      ...gymFilter,
    };

    const [items, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          name: true,
          email: true,
          avatarUrl: true,
          isActive: true,
          goal: true,
          experienceLevel: true,
          lastLoginAt: true,
          role: { select: { name: true } },
        },
      }),
      db.user.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /** Busca por ID validando o escopo do solicitante. */
  async findByIdScoped(requester: AuthenticatedUser, targetId: string) {
    const target = await this.prisma.db.user.findFirst({
      where: { id: targetId, deletedAt: null },
      include: {
        role: true,
        memberships: { where: { isActive: true }, select: { gymId: true } },
      },
    });

    if (!target) throw AppError.notFound('Usuário', targetId);

    const allowed = canAccessUserData(
      {
        userId: requester.id,
        role: requester.role,
        permissions: requester.permissions,
        gymId: requester.gymId,
      },
      { userId: target.id, gymId: target.memberships[0]?.gymId ?? null },
    );

    if (!allowed) {
      throw AppError.forbidden('Você não tem acesso aos dados deste usuário');
    }

    return this.toProfileView(target);
  }

  private toProfileView(user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    birthDate: Date | null;
    sex: string;
    heightCm: number | null;
    weightKg: number | null;
    targetWeightKg: number | null;
    goal: string;
    experienceLevel: string;
    dailyWaterGoalMl: number;
    locale: string;
    theme: string;
    units: string;
    preferences: unknown;
    isActive: boolean;
    role: { name: string };
    // `gym` só vem quando a consulta pediu o include; nas demais, a
    // lista traz apenas os ids do vínculo.
    memberships?: Array<{ gymId: string; gym?: unknown }>;
  }) {
    // IMC calculado na leitura: o valor histórico congelado fica nas
    // avaliações; aqui queremos sempre o número atual.
    const bmi = user.weightKg && user.heightCm ? calculateBmi(user.weightKg, user.heightCm) : null;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      birthDate: user.birthDate,
      sex: user.sex,
      heightCm: user.heightCm,
      weightKg: user.weightKg,
      targetWeightKg: user.targetWeightKg,
      bmi,
      goal: user.goal,
      experienceLevel: user.experienceLevel,
      dailyWaterGoalMl: user.dailyWaterGoalMl,
      locale: user.locale,
      theme: user.theme,
      units: user.units,
      preferences: user.preferences,
      isActive: user.isActive,
      role: user.role.name,
      gyms:
        user.memberships
          ?.map((membership) => membership.gym)
          .filter((gym): gym is NonNullable<typeof gym> => Boolean(gym)) ?? [],
    };
  }
}
