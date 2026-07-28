/**
 * Motor de sincronização entre o banco local e o Neon.
 *
 * ── Como funciona ───────────────────────────────────────────────────
 * Toda escrita deixa uma entrada em `ChangeLog` (outbox). A
 * sincronização lê as entradas PENDING e as aplica no outro banco.
 *
 * Por que outbox e não varrer `updatedAt`:
 *   • detecta EXCLUSÕES (um DELETE não aparece em varredura por data)
 *   • preserva a ORDEM das operações
 *   • guarda o `originNode`, evitando que a alteração volte para a
 *     origem em um eco infinito
 *
 * ── Resolução de conflitos ──────────────────────────────────────────
 *   LAST_WRITE_WINS — vence o maior `version`; empate desempata por
 *                     `updatedAt`. Padrão para registros editáveis.
 *   MERGE_UNION     — coleções append-only (hidratação, séries): dois
 *                     registros feitos offline são ambos verdadeiros.
 *   MANUAL          — divergência que exige decisão humana; fica em
 *                     `SyncConflict` aguardando um administrador.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@atlas/database';
import { findSyncEntity, syncEntitiesInOrder } from '@atlas/database';
import {
  CHANGE_OPERATION,
  CHANGE_STATUS,
  CONFLICT_RESOLUTION,
  DATABASE_NODE,
  SYNC_DIRECTION,
  SYNC_RUN_STATUS,
  SYNC_TRIGGER,
  type SyncDirection,
  type SyncRunSummary,
  type SyncStatusResponse,
  type SyncTrigger,
} from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

interface RunOptions {
  trigger: SyncTrigger;
  direction?: SyncDirection;
  entities?: string[];
  fullResync?: boolean;
  deviceId?: string;
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  /**
   * Trava em memória: impede duas execuções simultâneas.
   *
   * Duas sincronizações concorrentes aplicariam as mesmas entradas do
   * outbox duas vezes e poderiam gerar conflitos artificiais.
   */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {
    // Assim que o banco local voltar, reconcilia o que foi escrito no Neon.
    this.prisma.onLocalRecovered(async () => {
      await this.run({ trigger: SYNC_TRIGGER.RECONNECT, direction: SYNC_DIRECTION.BIDIRECTIONAL });
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Executa uma sincronização completa. */
  async run(options: RunOptions): Promise<SyncRunSummary> {
    if (this.running) {
      this.logger.warn('Sincronização já em andamento — ignorando o disparo.');
      throw new Error('Sincronização já em andamento');
    }

    const local = this.prisma.local;
    const cloud = this.prisma.cloud;

    if (!cloud) {
      throw new Error('Neon não configurado — não há com quem sincronizar');
    }

    this.running = true;
    const direction = options.direction ?? SYNC_DIRECTION.BIDIRECTIONAL;

    // O registro da execução vai no banco local: é a base histórica.
    const run = await local.syncRun.create({
      data: {
        trigger: options.trigger,
        direction,
        status: SYNC_RUN_STATUS.RUNNING,
        ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      },
    });

    let pushed = 0;
    let pulled = 0;
    let conflicts = 0;
    let failed = 0;

    try {
      if (direction !== SYNC_DIRECTION.CLOUD_TO_LOCAL) {
        const result = await this.applyPending(local, cloud, run.id, DATABASE_NODE.CLOUD);
        pushed = result.applied;
        conflicts += result.conflicts;
        failed += result.failed;
      }

      if (direction !== SYNC_DIRECTION.LOCAL_TO_CLOUD) {
        const result = await this.applyPending(cloud, local, run.id, DATABASE_NODE.LOCAL);
        pulled = result.applied;
        conflicts += result.conflicts;
        failed += result.failed;
      }

      const status = failed > 0 ? SYNC_RUN_STATUS.PARTIAL : SYNC_RUN_STATUS.SUCCESS;

      const finished = await local.syncRun.update({
        where: { id: run.id },
        data: {
          status,
          finishedAt: new Date(),
          pushedCount: pushed,
          pulledCount: pulled,
          conflictCount: conflicts,
          failedCount: failed,
        },
      });

      this.logger.log(
        `Sincronização ${status}: ${pushed} enviados, ${pulled} recebidos, ` +
          `${conflicts} conflitos, ${failed} falhas.`,
      );

      return this.toSummary(finished);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: error }, `Falha na sincronização: ${message}`);

      const failedRun = await local.syncRun.update({
        where: { id: run.id },
        data: {
          status: SYNC_RUN_STATUS.FAILED,
          finishedAt: new Date(),
          errorMessage: message,
          pushedCount: pushed,
          pulledCount: pulled,
          conflictCount: conflicts,
          failedCount: failed,
        },
      });

      return this.toSummary(failedRun);
    } finally {
      this.running = false;
    }
  }

  /**
   * Aplica as entradas pendentes do outbox de `source` em `target`.
   *
   * Processa em lotes para não carregar o outbox inteiro em memória
   * quando o banco ficou horas fora do ar.
   */
  private async applyPending(
    source: PrismaClient,
    target: PrismaClient,
    syncRunId: string,
    targetNode: (typeof DATABASE_NODE)[keyof typeof DATABASE_NODE],
  ): Promise<{ applied: number; conflicts: number; failed: number }> {
    let applied = 0;
    let conflicts = 0;
    let failed = 0;

    const batchSize = this.config.sync.batchSize;
    const orderedEntities = syncEntitiesInOrder().map((entity) => entity.name);

    // Percorre na ordem de dependência: um WorkoutDay não pode ser
    // inserido antes do WorkoutPlan que ele referencia.
    for (const entityName of orderedEntities) {
      let hasMore = true;

      while (hasMore) {
        const pending = await source.changeLog.findMany({
          where: {
            entity: entityName,
            status: CHANGE_STATUS.PENDING,
            targetNode,
          },
          orderBy: { occurredAt: 'asc' },
          take: batchSize,
        });

        if (pending.length === 0) {
          hasMore = false;
          break;
        }

        for (const change of pending) {
          try {
            const outcome = await this.applyChange(target, change);

            if (outcome === 'conflict') conflicts += 1;
            else applied += 1;

            await source.changeLog.update({
              where: { id: change.id },
              data: {
                status: outcome === 'conflict' ? CHANGE_STATUS.CONFLICT : CHANGE_STATUS.SYNCED,
                syncedAt: new Date(),
                syncRunId,
              },
            });
          } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : String(error);

            const attempts = change.attempts + 1;
            // Depois de N tentativas a entrada é marcada como FAILED para
            // não travar a fila indefinidamente; fica visível ao admin.
            const exhausted = attempts >= this.config.sync.maxRetries;

            await source.changeLog.update({
              where: { id: change.id },
              data: {
                attempts,
                lastError: message,
                syncRunId,
                ...(exhausted ? { status: CHANGE_STATUS.FAILED } : {}),
              },
            });

            this.logger.warn(
              `Falha ao aplicar ${change.entity}/${change.entityId} ` +
                `(tentativa ${attempts}): ${message}`,
            );
          }
        }

        hasMore = pending.length === batchSize;
      }
    }

    return { applied, conflicts, failed };
  }

  /**
   * Aplica uma alteração no banco de destino, resolvendo conflito.
   *
   * Devolve 'applied' ou 'conflict'.
   */
  private async applyChange(
    target: PrismaClient,
    change: {
      id: string;
      entity: string;
      entityId: string;
      operation: string;
      payload: unknown;
      version: number;
      originNode: string;
    },
  ): Promise<'applied' | 'conflict'> {
    const definition = findSyncEntity(change.entity);
    if (!definition) {
      throw new Error(`Entidade não registrada para sincronização: ${change.entity}`);
    }

    // Acesso dinâmico ao delegate. É o preço de um motor genérico —
    // a alternativa seria um switch com 20 casos duplicando a lógica.
    const delegate = (target as unknown as Record<string, DelegateLike>)[
      definition.delegate as string
    ];

    if (!delegate) {
      throw new Error(`Delegate do Prisma não encontrado: ${String(definition.delegate)}`);
    }

    const existing = await delegate.findUnique({ where: { id: change.entityId } });
    const payload = change.payload as Record<string, unknown>;

    // ── Registro novo no destino ────────────────────────────────────
    if (!existing) {
      if (change.operation === CHANGE_OPERATION.DELETE) {
        // Excluir algo que nunca chegou: nada a fazer.
        return 'applied';
      }

      await delegate.create({ data: { ...payload, id: change.entityId } });
      return 'applied';
    }

    // ── Já existe: decidir quem vence ───────────────────────────────
    const existingVersion = (existing as { version?: number }).version ?? 0;

    if (definition.resolution === CONFLICT_RESOLUTION.MERGE_UNION) {
      // Append-only: se já existe com o mesmo id, é o mesmo registro.
      // Nada a mesclar — a união acontece por os ids serem distintos.
      return 'applied';
    }

    if (change.version > existingVersion) {
      await delegate.update({
        where: { id: change.entityId },
        data: payload,
      });
      return 'applied';
    }

    if (change.version === existingVersion) {
      // Mesma versão com conteúdo potencialmente diferente: os dois
      // lados editaram a partir do mesmo ponto. Registra para análise.
      await this.recordConflict(target, change, existing, existingVersion);
      return 'conflict';
    }

    // Alteração mais antiga que o destino: descartada (o destino já
    // tem uma versão mais nova). Não é erro.
    return 'applied';
  }

  private async recordConflict(
    target: PrismaClient,
    change: { entity: string; entityId: string; payload: unknown; version: number },
    existing: unknown,
    existingVersion: number,
  ): Promise<void> {
    await target.syncConflict.create({
      data: {
        entity: change.entity,
        entityId: change.entityId,
        localVersion: change.version,
        cloudVersion: existingVersion,
        localPayload: change.payload as never,
        cloudPayload: existing as never,
        resolution: CONFLICT_RESOLUTION.MANUAL,
        resolved: false,
      },
    });
  }

  /** Estado atual da sincronização — alimenta o painel de administração. */
  async getStatus(): Promise<SyncStatusResponse> {
    const health = this.prisma.getHealth();
    const local = this.prisma.local;

    const [pendingChanges, unresolvedConflicts, lastRun] = await Promise.all([
      local.changeLog.count({ where: { status: CHANGE_STATUS.PENDING } }),
      local.syncConflict.count({ where: { resolved: false } }),
      local.syncRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);

    return {
      activeDatabase: health.activeNode ?? DATABASE_NODE.LOCAL,
      localAvailable: health.local.available,
      cloudAvailable: health.cloud?.available ?? false,
      pendingChanges,
      unresolvedConflicts,
      lastRun: lastRun ? this.toSummary(lastRun) : null,
      nextScheduledRun: null,
    };
  }

  private toSummary(run: {
    id: string;
    trigger: string;
    direction: string;
    status: string;
    startedAt: Date;
    finishedAt: Date | null;
    pushedCount: number;
    pulledCount: number;
    conflictCount: number;
    failedCount: number;
    errorMessage: string | null;
  }): SyncRunSummary {
    return {
      id: run.id,
      trigger: run.trigger as SyncRunSummary['trigger'],
      direction: run.direction as SyncRunSummary['direction'],
      status: run.status as SyncRunSummary['status'],
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      pushed: run.pushedCount,
      pulled: run.pulledCount,
      conflicts: run.conflictCount,
      failed: run.failedCount,
      errorMessage: run.errorMessage,
    };
  }
}

/** Superfície mínima do delegate do Prisma usada pelo motor genérico. */
interface DelegateLike {
  findUnique: (args: { where: { id: string } }) => Promise<unknown>;
  create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
  update: (args: { where: { id: string }; data: Record<string, unknown> }) => Promise<unknown>;
}
