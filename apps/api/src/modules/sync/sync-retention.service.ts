/**
 * Poda o rastro da sincronização nos dois bancos.
 *
 * ── Por que existe ──────────────────────────────────────────────────
 * O que cresce sem limite aqui não é o histórico do usuário. Uma linha
 * de `SetLog` ou `HydrationLog` são datas e inteiros, e as fotos ficam no
 * Cloudinary (`AssessmentPhoto` guarda `url`, não binário) — anos disso
 * cabem folgados no plano gratuito do Neon.
 *
 * O que cresce é o rastro do próprio motor: `ChangeLog` grava uma cópia
 * JSON INTEGRAL da linha a cada escrita, para sempre. Uma edição de
 * treino que hoje ocupa 300 bytes deixa 300 bytes de payload atrás dela,
 * em dois bancos, e nada nunca podava. `SyncRun` e `SyncConflict`
 * resolvido seguem a mesma lógica em escala menor.
 *
 * ── Por que isto é seguro e apagar dado de usuário não seria ────────
 * 1. Estas três tabelas NÃO estão em `SYNC_ENTITIES`, e os `ChangeLog`
 *    são criados explicitamente pelos serviços — não por middleware.
 *    Apagar aqui não gera outbox novo, então a poda não se propaga como
 *    se fosse exclusão de dado do usuário.
 * 2. Nada aqui é a única cópia de nada: o que o `ChangeLog` guardava já
 *    está aplicado nas tabelas de verdade, nos dois lados.
 * 3. Só alcança o que já terminou — entrada SYNCED, execução encerrada,
 *    conflito resolvido. Nenhuma idade faz uma entrada PENDING, FAILED
 *    ou um conflito em aberto ser tocado: é justamente o que alguém
 *    ainda precisa ver.
 *
 * Apagar histórico do usuário do Neon foi considerado e recusado: com o
 * Neon principal, o arquivo ficaria só no notebook — e notebook desligado
 * é exatamente o caso que a inversão veio resolver. Ver ADR 008.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { PrismaClient } from '@atlas/database';
import { CHANGE_STATUS, DATABASE_NODE, type DatabaseNode } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

export interface RetentionNodeResult {
  node: DatabaseNode;
  changeLogs: number;
  syncRuns: number;
  conflicts: number;
  skipped?: string;
}

export interface RetentionSummary {
  cutoff: string;
  nodes: RetentionNodeResult[];
}

/** Superfície mínima usada aqui — evita depender do tipo completo do delegate. */
interface PrunableDelegate {
  findMany: (args: {
    where: Record<string, unknown>;
    select: { id: true };
    take: number;
  }) => Promise<Array<{ id: string }>>;
  deleteMany: (args: { where: { id: { in: string[] } } }) => Promise<{ count: number }>;
}

@Injectable()
export class SyncRetentionService {
  private readonly logger = new Logger(SyncRetentionService.name);

  /** Impede duas podas simultâneas apagando o mesmo lote. */
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  get isRunning(): boolean {
    return this.running;
  }

  async prune(): Promise<RetentionSummary> {
    if (this.running) {
      throw new Error('Poda de retenção já em andamento');
    }

    this.running = true;

    const days = this.config.sync.retentionDays;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const health = this.prisma.getHealth();
    const nodes: RetentionNodeResult[] = [];

    try {
      // Cada banco é podado por conta própria. Um fora do ar não impede o
      // outro: a poda não precisa dos dois de pé para fazer sentido, e
      // rodar só de um lado apenas adia a do outro.
      const targets: Array<{ node: DatabaseNode; client: PrismaClient | null; up: boolean }> = [
        { node: DATABASE_NODE.LOCAL, client: this.prisma.local, up: health.local.available },
        {
          node: DATABASE_NODE.CLOUD,
          client: this.prisma.cloud,
          up: health.cloud?.available ?? false,
        },
      ];

      for (const target of targets) {
        if (!target.client) {
          nodes.push({ ...this.emptyResult(target.node), skipped: 'não configurado' });
          continue;
        }

        if (!target.up) {
          nodes.push({ ...this.emptyResult(target.node), skipped: 'indisponível' });
          continue;
        }

        nodes.push(await this.pruneNode(target.node, target.client, cutoff));
      }

      const total = nodes.reduce((sum, n) => sum + n.changeLogs + n.syncRuns + n.conflicts, 0);
      this.logger.log(
        `Retenção concluída: ${total} registros de controle apagados ` +
          `(anteriores a ${cutoff.toISOString()}, ${days} dias).`,
      );

      return { cutoff: cutoff.toISOString(), nodes };
    } finally {
      this.running = false;
    }
  }

  private emptyResult(node: DatabaseNode): RetentionNodeResult {
    return { node, changeLogs: 0, syncRuns: 0, conflicts: 0 };
  }

  private async pruneNode(
    node: DatabaseNode,
    client: PrismaClient,
    cutoff: Date,
  ): Promise<RetentionNodeResult> {
    const delegates = client as unknown as Record<string, PrunableDelegate>;

    // A ordem importa: `ChangeLog` e `SyncConflict` apontam para
    // `SyncRun`. Apagar os filhos primeiro dispensa depender da ação
    // referencial e evita deixar linha órfã no meio do caminho.
    const changeLogs = await this.deleteInBatches(delegates.changeLog, {
      status: CHANGE_STATUS.SYNCED,
      syncedAt: { lt: cutoff },
    });

    const conflicts = await this.deleteInBatches(delegates.syncConflict, {
      resolved: true,
      resolvedAt: { lt: cutoff },
    });

    const syncRuns = await this.deleteInBatches(delegates.syncRun, {
      finishedAt: { lt: cutoff },
    });

    this.logger.log(
      `[${node}] podados: ${changeLogs} ChangeLog, ${conflicts} SyncConflict, ${syncRuns} SyncRun.`,
    );

    return { node, changeLogs, syncRuns, conflicts };
  }

  /**
   * Apaga em lotes.
   *
   * Um `deleteMany` sozinho seria uma transação só sobre possivelmente
   * centenas de milhares de linhas — no Neon isso é tempo de lock e risco
   * de estourar o timeout da conexão. Em lotes, cada passo é curto e uma
   * interrupção no meio só deixa trabalho para a próxima noite.
   */
  private async deleteInBatches(
    delegate: PrunableDelegate | undefined,
    where: Record<string, unknown>,
  ): Promise<number> {
    if (!delegate) return 0;

    const take = this.config.sync.batchSize;
    let removed = 0;

    for (;;) {
      const batch = await delegate.findMany({ where, select: { id: true }, take });
      if (batch.length === 0) break;

      const result = await delegate.deleteMany({ where: { id: { in: batch.map((r) => r.id) } } });
      removed += result.count;

      if (batch.length < take) break;
    }

    return removed;
  }
}
