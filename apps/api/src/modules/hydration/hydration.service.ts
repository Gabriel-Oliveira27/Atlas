/**
 * Hidratação — segundo módulo funcional completo.
 *
 * Implementado por inteiro (e não esqueletado) porque exercita o caso
 * mais delicado do offline-first: registros append-only criados em
 * vários dispositivos ao mesmo tempo. Serve de referência para os
 * demais módulos de logging.
 */

import { Injectable } from '@nestjs/common';
import { AppError, CHANGE_OPERATION, toDayKey, type PaginatedResult } from '@atlas/shared';
import { buildPaginationMeta, normalizePagination } from '@atlas/shared';
import type {
  HydrationHistoryQuery,
  HydrationReminderInput,
  LogHydrationInput,
} from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

@Injectable()
export class HydrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  /**
   * Registra consumo de líquido.
   *
   * `clientGeneratedId` garante idempotência: o app offline pode enviar
   * o mesmo registro mais de uma vez na sincronização sem duplicar água
   * no total do dia.
   */
  async log(userId: string, input: LogHydrationInput) {
    const db = this.prisma.db;
    const dayKey = toDayKey(input.consumedAt);

    return db.$transaction(async (tx) => {
      if (input.clientGeneratedId) {
        const existing = await tx.hydrationLog.findUnique({
          where: {
            userId_clientGeneratedId: {
              userId,
              clientGeneratedId: input.clientGeneratedId,
            },
          },
        });

        // Já registrado: devolve o mesmo resultado em vez de duplicar.
        if (existing) return existing;
      }

      const log = await tx.hydrationLog.create({
        data: {
          userId,
          amountMl: input.amountMl,
          drinkType: input.drinkType,
          consumedAt: input.consumedAt,
          dayKey,
          ...(input.note ? { note: input.note } : {}),
          ...(input.clientGeneratedId ? { clientGeneratedId: input.clientGeneratedId } : {}),
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'HydrationLog',
          entityId: log.id,
          operation: CHANGE_OPERATION.CREATE,
          payload: log as never,
          version: log.version,
          originNode: this.config.nodeId,
          targetNode: this.prisma.replicationTarget,
        },
      });

      await this.refreshDailyActivity(tx, userId, dayKey);

      return log;
    });
  }

  /** Resumo do dia — alimenta o card de hidratação na Home. */
  async getDaySummary(userId: string, day?: string) {
    const dayKey = day ?? toDayKey();
    const db = this.prisma.db;

    const [user, logs] = await Promise.all([
      db.user.findFirst({
        where: { id: userId, deletedAt: null },
        select: { dailyWaterGoalMl: true },
      }),
      db.hydrationLog.findMany({
        where: { userId, dayKey, deletedAt: null },
        orderBy: { consumedAt: 'asc' },
      }),
    ]);

    if (!user) throw AppError.notFound('Usuário', userId);

    const totalMl = logs.reduce((sum, log) => sum + log.amountMl, 0);
    const goalMl = user.dailyWaterGoalMl;

    return {
      dayKey,
      totalMl,
      goalMl,
      remainingMl: Math.max(0, goalMl - totalMl),
      percentage: goalMl > 0 ? Math.min(100, Math.round((totalMl / goalMl) * 100)) : 0,
      goalReached: totalMl >= goalMl,
      entries: logs.map((log) => ({
        id: log.id,
        amountMl: log.amountMl,
        drinkType: log.drinkType,
        consumedAt: log.consumedAt,
      })),
    };
  }

  /** Histórico agregado para os gráficos. */
  async getHistory(
    userId: string,
    query: HydrationHistoryQuery,
  ): Promise<PaginatedResult<unknown>> {
    const { page, pageSize, skip, take } = normalizePagination(query);
    const db = this.prisma.db;

    const where = {
      userId,
      deletedAt: null,
      ...(query.from || query.to
        ? {
            consumedAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
    };

    // Agregação por dia direto no banco — trazer todos os registros e
    // somar em memória não escala para históricos longos.
    const [grouped, total] = await Promise.all([
      db.hydrationLog.groupBy({
        by: ['dayKey'],
        where,
        _sum: { amountMl: true },
        _count: { id: true },
        orderBy: { dayKey: 'desc' },
        skip,
        take,
      }),
      db.hydrationLog
        .groupBy({ by: ['dayKey'], where, _count: { id: true } })
        .then((rows) => rows.length),
    ]);

    const items = grouped.map((row) => ({
      dayKey: row.dayKey,
      totalMl: row._sum.amountMl ?? 0,
      entryCount: row._count.id,
    }));

    return { items, meta: buildPaginationMeta(page, pageSize, total) };
  }

  async deleteLog(userId: string, logId: string) {
    const db = this.prisma.db;

    return db.$transaction(async (tx) => {
      const log = await tx.hydrationLog.findFirst({
        where: { id: logId, userId, deletedAt: null },
      });

      if (!log) throw AppError.notFound('Registro de hidratação', logId);

      // Exclusão lógica: o tombstone é o que propaga a remoção para os
      // outros dispositivos.
      const deleted = await tx.hydrationLog.update({
        where: { id: logId },
        data: {
          deletedAt: new Date(),
          version: log.version + 1,
          originNode: this.config.nodeId,
        },
      });

      await tx.changeLog.create({
        data: {
          entity: 'HydrationLog',
          entityId: logId,
          operation: CHANGE_OPERATION.DELETE,
          payload: { id: logId } as never,
          version: deleted.version,
          originNode: this.config.nodeId,
          targetNode: this.prisma.replicationTarget,
        },
      });

      await this.refreshDailyActivity(tx, userId, log.dayKey);

      return { id: logId, deleted: true };
    });
  }

  async upsertReminder(userId: string, input: HydrationReminderInput) {
    const db = this.prisma.db;

    const existing = await db.hydrationReminder.findFirst({ where: { userId, deletedAt: null } });

    if (existing) {
      return db.hydrationReminder.update({
        where: { id: existing.id },
        data: {
          ...input,
          version: existing.version + 1,
          originNode: this.config.nodeId,
        },
      });
    }

    return db.hydrationReminder.create({
      data: { userId, ...input, originNode: this.config.nodeId },
    });
  }

  async getReminder(userId: string) {
    return this.prisma.db.hydrationReminder.findFirst({ where: { userId, deletedAt: null } });
  }

  /**
   * Atualiza o resumo diário.
   *
   * Recalcula a partir dos registros em vez de somar/subtrair de forma
   * incremental: com sincronização offline, chegam registros fora de
   * ordem, e um contador incremental acumularia erro.
   */
  private async refreshDailyActivity(
    tx: Parameters<Parameters<PrismaService['db']['$transaction']>[0]>[0],
    userId: string,
    dayKey: string,
  ): Promise<void> {
    const [user, aggregate] = await Promise.all([
      tx.user.findUnique({ where: { id: userId }, select: { dailyWaterGoalMl: true } }),
      tx.hydrationLog.aggregate({
        where: { userId, dayKey, deletedAt: null },
        _sum: { amountMl: true },
      }),
    ]);

    const totalMl = aggregate._sum.amountMl ?? 0;
    const goalMl = user?.dailyWaterGoalMl ?? 2450;

    await tx.dailyActivity.upsert({
      where: { userId_dayKey: { userId, dayKey } },
      update: {
        hydrationTotalMl: totalMl,
        hydrationGoalMl: goalMl,
        hydrationGoalMet: totalMl >= goalMl,
        version: { increment: 1 },
      },
      create: {
        userId,
        dayKey,
        hydrationTotalMl: totalMl,
        hydrationGoalMl: goalMl,
        hydrationGoalMet: totalMl >= goalMl,
        originNode: this.config.nodeId,
      },
    });
  }
}
