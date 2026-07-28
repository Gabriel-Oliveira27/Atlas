/**
 * Roteador de banco de dados — implementa a regra central do Atlas:
 *
 *   Banco local disponível  → SEMPRE usa o local
 *   Banco local indisponível → usa o Neon temporariamente
 *   Banco local voltou       → volta ao local e dispara a reconciliação
 *
 * O estado da saúde é mantido em memória e atualizado por um verificador
 * periódico. Testar a conexão a cada requisição adicionaria latência a
 * todas elas; o intervalo (padrão 15 s) é o compromisso entre detectar a
 * queda rápido e não sobrecarregar o banco com pings.
 */

import type { PrismaClient } from '@prisma/client';
import { AppError, DATABASE_NODE, type DatabaseNode } from '@atlas/shared';
import { pingDatabase, type DatabaseClients } from './client.js';

export interface RouterOptions {
  clients: DatabaseClients;
  /** Qual banco tem prioridade quando ambos estão disponíveis. */
  primary?: DatabaseNode;
  healthCheckIntervalMs?: number;
  healthCheckTimeoutMs?: number;
  /**
   * Chamado quando o nó ativo muda. A API usa este gancho para disparar
   * a reconciliação assim que o banco local retorna.
   */
  onNodeChange?: (event: NodeChangeEvent) => void | Promise<void>;
}

export interface NodeChangeEvent {
  from: DatabaseNode | null;
  to: DatabaseNode;
  /** true quando o local voltou depois de uma indisponibilidade. */
  recovered: boolean;
  at: Date;
}

export interface DatabaseHealth {
  local: { available: boolean; latencyMs: number; error?: string; checkedAt: Date };
  cloud: { available: boolean; latencyMs: number; error?: string; checkedAt: Date } | null;
  activeNode: DatabaseNode | null;
}

export class DatabaseRouter {
  private readonly clients: DatabaseClients;
  private readonly primary: DatabaseNode;
  private readonly intervalMs: number;
  private readonly timeoutMs: number;
  private readonly onNodeChange?: RouterOptions['onNodeChange'];

  private timer?: NodeJS.Timeout;
  private activeNode: DatabaseNode | null = null;
  /** Marca que o local já esteve fora — usado para saber se houve recuperação. */
  private localWasDown = false;

  private health: DatabaseHealth = {
    local: { available: false, latencyMs: 0, checkedAt: new Date(0) },
    cloud: null,
    activeNode: null,
  };

  constructor(options: RouterOptions) {
    this.clients = options.clients;
    this.primary = options.primary ?? DATABASE_NODE.LOCAL;
    this.intervalMs = options.healthCheckIntervalMs ?? 15_000;
    this.timeoutMs = options.healthCheckTimeoutMs ?? 3_000;
    this.onNodeChange = options.onNodeChange;
  }

  /** Faz a primeira verificação e inicia o monitoramento periódico. */
  async start(): Promise<void> {
    await this.checkHealth();

    this.timer = setInterval(() => {
      void this.checkHealth();
    }, this.intervalMs);

    // Não segura o processo aberto por causa do timer.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /**
   * Cliente que deve atender a requisição atual.
   * Lança 503 apenas quando NENHUM dos dois bancos responde.
   */
  getClient(): PrismaClient {
    if (this.activeNode === DATABASE_NODE.LOCAL) return this.clients.local;
    if (this.activeNode === DATABASE_NODE.CLOUD && this.clients.cloud) return this.clients.cloud;
    throw AppError.allDatabasesUnavailable();
  }

  getActiveNode(): DatabaseNode | null {
    return this.activeNode;
  }

  getHealth(): DatabaseHealth {
    return this.health;
  }

  /** true quando estamos operando em contingência (Neon no lugar do local). */
  isDegraded(): boolean {
    return this.activeNode === DATABASE_NODE.CLOUD && this.primary === DATABASE_NODE.LOCAL;
  }

  /** Acesso direto ao cliente local — usado pelo motor de sincronização. */
  getLocalClient(): PrismaClient {
    return this.clients.local;
  }

  /** Acesso direto ao Neon — usado pelo motor de sincronização. */
  getCloudClient(): PrismaClient | null {
    return this.clients.cloud;
  }

  /** Verifica os dois bancos e reelege o nó ativo. */
  async checkHealth(): Promise<DatabaseHealth> {
    const now = new Date();

    const [localResult, cloudResult] = await Promise.all([
      pingDatabase(this.clients.local, this.timeoutMs),
      this.clients.cloud ? pingDatabase(this.clients.cloud, this.timeoutMs) : Promise.resolve(null),
    ]);

    this.health = {
      local: {
        available: localResult.ok,
        latencyMs: localResult.latencyMs,
        ...(localResult.error ? { error: localResult.error } : {}),
        checkedAt: now,
      },
      cloud: cloudResult
        ? {
            available: cloudResult.ok,
            latencyMs: cloudResult.latencyMs,
            ...(cloudResult.error ? { error: cloudResult.error } : {}),
            checkedAt: now,
          }
        : null,
      activeNode: this.activeNode,
    };

    await this.electActiveNode(localResult.ok, cloudResult?.ok ?? false, now);
    this.health.activeNode = this.activeNode;

    return this.health;
  }

  /**
   * Elege o nó ativo.
   *
   * A prioridade do local é incondicional quando `primary = LOCAL`:
   * mesmo que o Neon esteja respondendo mais rápido, os dados de
   * referência ficam no local.
   */
  private async electActiveNode(localOk: boolean, cloudOk: boolean, at: Date): Promise<void> {
    const previous = this.activeNode;
    let next: DatabaseNode | null = null;

    if (this.primary === DATABASE_NODE.LOCAL) {
      if (localOk) next = DATABASE_NODE.LOCAL;
      else if (cloudOk) next = DATABASE_NODE.CLOUD;
    } else {
      if (cloudOk) next = DATABASE_NODE.CLOUD;
      else if (localOk) next = DATABASE_NODE.LOCAL;
    }

    if (!localOk) this.localWasDown = true;

    this.activeNode = next;

    if (next === null || next === previous) return;

    // Recuperação = voltamos ao local depois de ele ter caído. É o gatilho
    // da reconciliação: existem escritas feitas no Neon a trazer de volta.
    const recovered = next === DATABASE_NODE.LOCAL && this.localWasDown && previous !== null;
    if (recovered) this.localWasDown = false;

    await this.onNodeChange?.({ from: previous, to: next, recovered, at });
  }
}
