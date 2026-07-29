/**
 * Treinos — planos, sessões e séries.
 *
 * Implementado o ciclo essencial (listar plano ativo, iniciar sessão,
 * registrar série, finalizar). A criação/edição de planos por professor
 * e a periodização completa estão marcadas no roadmap; os schemas de
 * entrada já existem em @atlas/validation.
 */

import { Injectable } from '@nestjs/common';
import {
  AppError,
  CHANGE_OPERATION,
  DATABASE_NODE,
  ERROR_CODES,
  buildPaginationMeta,
  calculateVolumeLoad,
  normalizePagination,
  toDayKey,
  type AuthenticatedUser,
  type PaginatedResult,
} from '@atlas/shared';
import type {
  FinishWorkoutSessionInput,
  ListWorkoutLogsQuery,
  LogSetInput,
  PaginationInput,
  StartWorkoutSessionInput,
} from '@atlas/validation';
import { UserScopeService } from '../../common/scope/user-scope.service.js';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class WorkoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
    private readonly scope: UserScopeService,
  ) {}

  /** Plano ativo do usuário, com dias e exercícios prescritos. */
  async getActivePlan(userId: string) {
    return this.prisma.db.workoutPlan.findFirst({
      where: { userId, isActive: true, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        days: {
          where: { deletedAt: null },
          orderBy: { position: 'asc' },
          include: {
            exercises: {
              where: { deletedAt: null },
              orderBy: { position: 'asc' },
              include: {
                exercise: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    muscleGroup: { select: { name: true } },
                    media: { where: { type: 'GIF' }, take: 1 },
                  },
                },
              },
            },
          },
        },
        mesocycles: { orderBy: { position: 'asc' }, include: { microcycles: true } },
      },
    });
  }

  async listPlans(userId: string, query: PaginationInput): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;
    const where = { userId, deletedAt: null };

    const [items, total] = await Promise.all([
      db.workoutPlan.findMany({
        where,
        orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
        include: { days: { where: { deletedAt: null }, select: { id: true, label: true } } },
      }),
      db.workoutPlan.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Inicia uma sessão de treino.
   *
   * Só pode existir UMA sessão aberta por vez: duas sessões simultâneas
   * fariam as séries registradas caírem na sessão errada.
   */
  async startSession(userId: string, input: StartWorkoutSessionInput) {
    const db = this.prisma.db;

    return db.$transaction(async (tx) => {
      if (input.clientGeneratedId) {
        const existing = await tx.workoutLog.findUnique({
          where: {
            userId_clientGeneratedId: { userId, clientGeneratedId: input.clientGeneratedId },
          },
        });
        if (existing) return existing;
      }

      const open = await tx.workoutLog.findFirst({
        where: { userId, status: 'IN_PROGRESS', deletedAt: null },
      });

      if (open) {
        throw new AppError(
          ERROR_CODES.WORKOUT_SESSION_ALREADY_OPEN,
          'Já existe um treino em andamento. Finalize-o antes de iniciar outro.',
          { status: 409, details: { openSessionId: open.id } },
        );
      }

      const log = await tx.workoutLog.create({
        data: {
          userId,
          ...(input.workoutPlanId ? { workoutPlanId: input.workoutPlanId } : {}),
          ...(input.workoutDayId ? { workoutDayId: input.workoutDayId } : {}),
          startedAt: input.startedAt,
          status: 'IN_PROGRESS',
          ...(input.clientGeneratedId ? { clientGeneratedId: input.clientGeneratedId } : {}),
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'WorkoutLog',
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

  /** Sessão em andamento, se houver. */
  async getOpenSession(userId: string) {
    return this.prisma.db.workoutLog.findFirst({
      where: { userId, status: 'IN_PROGRESS', deletedAt: null },
      include: {
        sets: { where: { deletedAt: null }, orderBy: { completedAt: 'asc' } },
        workoutDay: { select: { id: true, label: true, name: true } },
      },
    });
  }

  /** Registra uma série executada. */
  async logSet(userId: string, workoutLogId: string, input: LogSetInput) {
    const db = this.prisma.db;

    return db.$transaction(async (tx) => {
      const session = await tx.workoutLog.findFirst({
        where: { id: workoutLogId, userId, deletedAt: null },
      });

      if (!session) throw AppError.notFound('Sessão de treino', workoutLogId);

      if (session.status !== 'IN_PROGRESS') {
        throw new AppError(ERROR_CODES.WORKOUT_SESSION_NOT_OPEN, 'Esta sessão já foi finalizada', {
          status: 409,
        });
      }

      if (input.clientGeneratedId) {
        const existing = await tx.setLog.findUnique({
          where: {
            workoutLogId_clientGeneratedId: {
              workoutLogId,
              clientGeneratedId: input.clientGeneratedId,
            },
          },
        });

        // Reenvio da fila offline: a série já está registrada.
        if (existing) return existing;
      }

      const set = await tx.setLog.create({
        data: {
          workoutLogId,
          exerciseId: input.exerciseId,
          setNumber: input.setNumber,
          reps: input.reps,
          weightKg: input.weightKg,
          technique: input.technique,
          ...(input.rpe !== undefined ? { rpe: input.rpe } : {}),
          ...(input.rir !== undefined ? { rir: input.rir } : {}),
          ...(input.durationSeconds !== undefined
            ? { durationSeconds: input.durationSeconds }
            : {}),
          ...(input.restSeconds !== undefined ? { restSeconds: input.restSeconds } : {}),
          isWarmup: input.isWarmup,
          completedAt: input.completedAt,
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.clientGeneratedId ? { clientGeneratedId: input.clientGeneratedId } : {}),
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'SetLog',
          entityId: set.id,
          operation: CHANGE_OPERATION.CREATE,
          payload: set as never,
          version: set.version,
          originNode: this.config.nodeId,
          targetNode: DATABASE_NODE.CLOUD,
        },
      });

      return set;
    });
  }

  /**
   * Finaliza a sessão e consolida os totais.
   *
   * O volume é calculado aqui (e não a cada leitura) porque alimenta
   * gráficos e os relatórios de IA — recalcular sempre seria caro.
   * Séries de aquecimento ficam de fora do volume.
   */
  async finishSession(userId: string, workoutLogId: string, input: FinishWorkoutSessionInput) {
    const db = this.prisma.db;

    return db.$transaction(async (tx) => {
      const session = await tx.workoutLog.findFirst({
        where: { id: workoutLogId, userId, deletedAt: null },
        include: { sets: { where: { deletedAt: null, isWarmup: false } } },
      });

      if (!session) throw AppError.notFound('Sessão de treino', workoutLogId);

      const totalVolumeLoad = session.sets.reduce(
        (sum, set) => sum + calculateVolumeLoad(1, set.reps, set.weightKg),
        0,
      );

      const durationSeconds = Math.max(
        0,
        Math.floor((input.finishedAt.getTime() - session.startedAt.getTime()) / 1000),
      );

      const updated = await tx.workoutLog.update({
        where: { id: workoutLogId },
        data: {
          status: input.status,
          finishedAt: input.finishedAt,
          totalVolumeLoad,
          durationSeconds,
          ...(input.rating !== undefined ? { rating: input.rating } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          version: session.version + 1,
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'WorkoutLog',
          entityId: workoutLogId,
          operation: CHANGE_OPERATION.UPDATE,
          payload: updated as never,
          version: updated.version,
          originNode: this.config.nodeId,
          targetNode: DATABASE_NODE.CLOUD,
        },
      });

      if (input.status === 'COMPLETED') {
        await this.updateDailyActivity(tx, userId, input.finishedAt, {
          volumeLoad: totalVolumeLoad,
          activeMinutes: Math.round(durationSeconds / 60),
        });
      }

      return updated;
    });
  }

  /**
   * Histórico de sessões, paginado.
   *
   * `query.userId` deixa o professor abrir o histórico de um aluno —
   * validado pelo escopo antes de qualquer consulta.
   */
  async listSessions(
    requester: AuthenticatedUser,
    query: ListWorkoutLogsQuery,
  ): Promise<PaginatedResult<unknown>> {
    const userId = await this.scope.resolveTargetUserId(requester, query.userId);
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;

    const where = {
      userId,
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.workoutPlanId ? { workoutPlanId: query.workoutPlanId } : {}),
      ...(query.from || query.to
        ? {
            startedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      db.workoutLog.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take,
        include: {
          workoutDay: { select: { label: true, name: true } },
          _count: { select: { sets: true } },
        },
      }),
      db.workoutLog.count({ where }),
    ]);

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * Atualiza o resumo diário e o streak.
   *
   * O streak é derivado do dia anterior: se o usuário treinou ontem,
   * continua a sequência; senão, recomeça em 1.
   */
  private async updateDailyActivity(
    tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
    userId: string,
    finishedAt: Date,
    totals: { volumeLoad: number; activeMinutes: number },
  ): Promise<void> {
    const dayKey = toDayKey(finishedAt);

    const previousDay = new Date(finishedAt.getTime() - 86_400_000);
    const previous = await tx.dailyActivity.findUnique({
      where: { userId_dayKey: { userId, dayKey: toDayKey(previousDay) } },
      select: { streak: true, workoutCompleted: true },
    });

    const streak = previous?.workoutCompleted ? previous.streak + 1 : 1;

    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { dailyWaterGoalMl: true },
    });

    await tx.dailyActivity.upsert({
      where: { userId_dayKey: { userId, dayKey } },
      update: {
        workoutCompleted: true,
        workoutCount: { increment: 1 },
        volumeLoad: { increment: totals.volumeLoad },
        activeMinutes: { increment: totals.activeMinutes },
        streak,
        version: { increment: 1 },
      },
      create: {
        userId,
        dayKey,
        workoutCompleted: true,
        workoutCount: 1,
        volumeLoad: totals.volumeLoad,
        activeMinutes: totals.activeMinutes,
        streak,
        hydrationGoalMl: user?.dailyWaterGoalMl ?? 2450,
        originNode: this.config.nodeId,
      },
    });
  }

  // TODO(roadmap MVP): criação e atribuição de planos por professor,
  // periodização (mesociclos/microciclos) e duplicação de modelos.
  // Schemas prontos: createWorkoutPlanSchema, mesocycleSchema.
}
