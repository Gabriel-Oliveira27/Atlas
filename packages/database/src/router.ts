/**
 * Roteador de banco de dados — implementa a regra central do Atlas:
 *
 *   Banco PRINCIPAL disponível   → SEMPRE usa o principal
 *   Banco PRINCIPAL indisponível → usa o outro temporariamente
 *   Banco PRINCIPAL voltou       → volta a ele e dispara a reconciliação
 *
 * Qual dos dois é o principal vem de `DATABASE_PRIMARY`. Nada aqui
 * assume que é o local: até 29/07/2026 era (ADR 003), hoje o padrão é o
 * Neon (ADR 008), e uma instalação com Postgres na rede dos usuários
 * continua podendo inverter de volta com uma variável.
 *
 * Essa simetria é o motivo de o código falar "principal" e "secundário"
 * em vez de "local" e "nuvem". A versão anterior amarrava a recuperação
 * ao local, e invertida ela nunca reconciliava.
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
   * a reconciliação assim que o banco principal retorna.
   */
  onNodeChange?: (event: NodeChangeEvent) => void | Promise<void>;
  /**
   * Chamado quando o nó SECUNDÁRIO volta a responder.
   *
   * Existe porque isso NÃO troca o nó ativo — o principal segue
   * atendendo — e portanto não passa por `onNodeChange`. Sem este
   * gancho, o secundário voltava do nada e ficava desatualizado até a
   * próxima janela agendada. É aqui que mora "sempre que o local estiver
   * ativo, atualiza o local".
   */
  onSecondaryAvailable?: (event: SecondaryAvailableEvent) => void | Promise<void>;
}

export interface NodeChangeEvent {
  from: DatabaseNode | null;
  to: DatabaseNode;
  /** true quando o PRINCIPAL voltou depois de uma indisponibilidade. */
  recovered: boolean;
  at: Date;
}

export interface SecondaryAvailableEvent {
  /** Qual nó voltou — o que não é o principal. */
  node: DatabaseNode;
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
  private readonly onSecondaryAvailable?: RouterOptions['onSecondaryAvailable'];

  private timer?: NodeJS.Timeout;
  private activeNode: DatabaseNode | null = null;
  /** Marca que o PRINCIPAL já esteve fora — base para detectar recuperação. */
  private primaryWasDown = false;
  /**
   * Última disponibilidade conhecida do secundário. `null` = ainda não
   * verificamos, e é de propósito: no primeiro check não existe transição,
   * então a API não dispara uma sincronização a cada reinício.
   */
  private secondaryAvailable: boolean | null = null;

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
    this.onSecondaryAvailable = options.onSecondaryAvailable;
  }

  /** O nó que não é o principal. `null` quando o Neon não está configurado. */
  secondaryNode(): DatabaseNode | null {
    if (this.primary === DATABASE_NODE.LOCAL) {
      return this.clients.cloud ? DATABASE_NODE.CLOUD : null;
    }
    return DATABASE_NODE.LOCAL;
  }

  getPrimaryNode(): DatabaseNode {
    return this.primary;
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

  /**
   * true quando estamos em contingência: atendendo pelo secundário
   * porque o principal não respondeu.
   *
   * Genérico de propósito. A versão anterior perguntava "o ativo é o Neon
   * E o principal é o local?" — com `DATABASE_PRIMARY=CLOUD` isso
   * devolvia false mesmo rodando no local, e a interface deixava de
   * avisar exatamente no caso em que os dados podem estar defasados.
   */
  isDegraded(): boolean {
    return this.activeNode !== null && this.activeNode !== this.primary;
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

    // Depois da eleição: o secundário voltar não muda o nó ativo, então
    // precisa de aviso próprio.
    await this.notifySecondaryTransition(localResult.ok, cloudResult?.ok ?? false, now);

    return this.health;
  }

  /**
   * Dispara `onSecondaryAvailable` na transição indisponível → disponível
   * do nó secundário.
   *
   * Só na transição: chamar a cada verificação faria a API sincronizar de
   * 15 em 15 segundos enquanto os dois bancos estivessem de pé.
   */
  private async notifySecondaryTransition(
    localOk: boolean,
    cloudOk: boolean,
    at: Date,
  ): Promise<void> {
    const secondary = this.secondaryNode();
    if (!secondary) return;

    const ok = secondary === DATABASE_NODE.LOCAL ? localOk : cloudOk;
    const previous = this.secondaryAvailable;
    this.secondaryAvailable = ok;

    if (previous === false && ok) {
      await this.onSecondaryAvailable?.({ node: secondary, at });
    }
  }

  /**
   * Elege o nó ativo.
   *
   * A prioridade do principal é incondicional: mesmo que o secundário
   * esteja respondendo mais rápido, os dados de referência ficam no
   * principal. Latência menor não vale ler de uma réplica que pode estar
   * atrás da última escrita.
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

    const primaryOk = this.primary === DATABASE_NODE.LOCAL ? localOk : cloudOk;
    if (!primaryOk) this.primaryWasDown = true;

    this.activeNode = next;

    if (next === null || next === previous) return;

    // Recuperação = voltamos ao PRINCIPAL depois de ele ter caído. É o
    // gatilho da reconciliação: existem escritas feitas no secundário
    // durante a queda a trazer de volta.
    const recovered = next === this.primary && this.primaryWasDown && previous !== null;
    if (recovered) this.primaryWasDown = false;

    await this.onNodeChange?.({ from: previous, to: next, recovered, at });
  }
}
