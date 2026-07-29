/**
 * Serviço de acesso ao banco — encapsula o roteador local/nuvem.
 *
 * Os módulos de negócio injetam ESTE serviço e chamam `db` para obter o
 * cliente ativo. Eles não sabem (nem devem saber) se estão falando com o
 * Postgres local ou com o Neon — é exatamente esse desacoplamento que
 * permite o failover ser transparente.
 */

import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  createDatabaseClients,
  disconnectAll,
  DatabaseRouter,
  type DatabaseHealth,
  type NodeChangeEvent,
  type PrismaClient,
  type SecondaryAvailableEvent,
} from '@atlas/database';
import { DATABASE_NODE, type DatabaseNode } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';

/**
 * Códigos de evento estáveis para regras de alerta.
 *
 * Alertar por texto de mensagem quebra na primeira revisão de redação.
 * Estes dois códigos são contrato com o pipeline de observabilidade.
 */
export const DB_FAILOVER_EVENT = 'database.failover.cloud';
export const DB_RECOVERY_EVENT = 'database.failover.recovered';
/** O secundário voltou — redundância restabelecida, sem troca de nó ativo. */
export const DB_SECONDARY_BACK_EVENT = 'database.secondary.available';

@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly router: DatabaseRouter;

  /**
   * Callbacks disparados quando o banco PRINCIPAL volta. O módulo de
   * sincronização se registra aqui — evita que este serviço dependa
   * dele (o que criaria uma dependência circular).
   */
  private readonly recoveryListeners: Array<(event: NodeChangeEvent) => void | Promise<void>> = [];

  /** Callbacks disparados quando o banco SECUNDÁRIO volta a responder. */
  private readonly secondaryListeners: Array<
    (event: SecondaryAvailableEvent) => void | Promise<void>
  > = [];

  constructor(private readonly config: EnvConfig) {
    const clients = createDatabaseClients({
      localUrl: this.config.database.localUrl,
      ...(this.config.database.cloudUrl ? { cloudUrl: this.config.database.cloudUrl } : {}),
      logQueries: this.config.database.logQueries,
    });

    this.router = new DatabaseRouter({
      clients,
      primary: this.config.database.primary,
      healthCheckIntervalMs: this.config.database.healthCheckIntervalMs,
      healthCheckTimeoutMs: this.config.database.healthCheckTimeoutMs,
      onNodeChange: (event) => this.handleNodeChange(event),
      onSecondaryAvailable: (event) => this.handleSecondaryAvailable(event),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.router.start();

    const health = this.router.getHealth();
    const primary = this.router.getPrimaryNode();

    // `DATABASE_PRIMARY=CLOUD` sem `DATABASE_URL_CLOUD` é contradição, e
    // silenciosa: o Neon nunca responde, a API atende tudo pelo local e
    // se declara degradada para sempre. Melhor dizer isso no boot.
    if (primary === DATABASE_NODE.CLOUD && !this.config.database.cloudUrl) {
      this.logger.error(
        'DATABASE_PRIMARY=CLOUD mas DATABASE_URL_CLOUD está vazio. ' +
          'A API vai atender pelo banco local e se reportar degradada indefinidamente. ' +
          'Configure a URL do Neon ou volte DATABASE_PRIMARY para LOCAL.',
      );
    }

    const primaryHealth = primary === DATABASE_NODE.LOCAL ? health.local : health.cloud;

    if (!primaryHealth?.available) {
      const secondaryUp =
        primary === DATABASE_NODE.LOCAL ? health.cloud?.available : health.local.available;

      this.logger.warn(
        `Banco PRINCIPAL (${primary}) indisponível (${primaryHealth?.error ?? 'sem detalhe'}). ` +
          (secondaryUp
            ? 'Operando temporariamente pelo secundário.'
            : 'O secundário também está indisponível — a API responderá 503.'),
      );
    } else {
      this.logger.log(`Banco PRINCIPAL (${primary}) disponível (${primaryHealth.latencyMs} ms).`);
    }

    if (!this.config.database.cloudUrl) {
      this.logger.warn(
        'DATABASE_URL_CLOUD não configurado — sem failover nem sincronização com a nuvem.',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.router.stop();
    await disconnectAll();
  }

  /** Cliente ativo. É o que os repositórios devem usar. */
  get db(): PrismaClient {
    return this.router.getClient();
  }

  /** Cliente local explícito — apenas para o motor de sincronização. */
  get local(): PrismaClient {
    return this.router.getLocalClient();
  }

  /** Cliente Neon explícito — apenas para o motor de sincronização. */
  get cloud(): PrismaClient | null {
    return this.router.getCloudClient();
  }

  get activeNode(): DatabaseNode | null {
    return this.router.getActiveNode();
  }

  /** Qual banco é o principal nesta instalação (`DATABASE_PRIMARY`). */
  get primaryNode(): DatabaseNode {
    return this.router.getPrimaryNode();
  }

  /**
   * Cliente do banco principal, para escrita de controle da própria
   * sincronização (SyncRun, contadores). Difere de `db`: `db` cai para o
   * secundário em contingência, este devolve `null` quando o principal
   * está fora — quem chama decide se tem sentido registrar no secundário.
   */
  get primary(): PrismaClient | null {
    const node = this.router.getPrimaryNode();
    const client = node === DATABASE_NODE.LOCAL ? this.local : this.cloud;
    const health = this.router.getHealth();
    const available =
      node === DATABASE_NODE.LOCAL ? health.local.available : health.cloud?.available;
    return available ? client : null;
  }

  /** true quando estamos em contingência: o secundário substituindo o principal. */
  get isDegraded(): boolean {
    return this.router.isDegraded();
  }

  getHealth(): DatabaseHealth {
    return this.router.getHealth();
  }

  async checkHealth(): Promise<DatabaseHealth> {
    return this.router.checkHealth();
  }

  /** Registra um callback para quando o banco PRINCIPAL retornar. */
  onPrimaryRecovered(listener: (event: NodeChangeEvent) => void | Promise<void>): void {
    this.recoveryListeners.push(listener);
  }

  /**
   * Registra um callback para quando o banco SECUNDÁRIO voltar a
   * responder — o gancho que mantém o secundário atualizado sem esperar
   * a janela agendada.
   */
  onSecondaryAvailable(listener: (event: SecondaryAvailableEvent) => void | Promise<void>): void {
    this.secondaryListeners.push(listener);
  }

  private async handleNodeChange(event: NodeChangeEvent): Promise<void> {
    const primary = this.router.getPrimaryNode();

    if (event.to !== primary) {
      // ERROR, não WARN: o banco principal caiu. O usuário já vê o
      // banner na UI, mas o banner não acorda ninguém — este log é o
      // gancho de alerta. `event` é o campo estável para a regra do
      // pipeline de observabilidade; a mensagem pode mudar, ele não.
      this.logger.error(
        { event: DB_FAILOVER_EVENT, from: event.from, to: event.to },
        `FAILOVER: banco principal (${primary}) indisponível — assumindo o ${event.to}. ` +
          'As alterações serão reconciliadas quando o principal voltar.',
      );

      await this.recordFailoverAudit(DB_FAILOVER_EVENT, event);
      return;
    }

    if (event.recovered) {
      this.logger.log(
        { event: DB_RECOVERY_EVENT, from: event.from, to: event.to },
        `Banco principal (${primary}) restabelecido — iniciando reconciliação.`,
      );

      await this.recordFailoverAudit(DB_RECOVERY_EVENT, event);

      for (const listener of this.recoveryListeners) {
        try {
          await listener(event);
        } catch (error) {
          // Uma falha na reconciliação não pode derrubar o roteador: o
          // banco voltou e a API precisa seguir atendendo.
          this.logger.error({ err: error }, 'Falha ao executar a reconciliação pós-recuperação.');
        }
      }
      return;
    }

    this.logger.log(`Banco ativo: ${event.to}.`);
  }

  /**
   * O secundário voltou. Não há troca de nó ativo — o principal continua
   * atendendo — mas o secundário está atrás das escritas do período em
   * que esteve fora, e é isso que os ouvintes vêm corrigir.
   */
  private async handleSecondaryAvailable(event: SecondaryAvailableEvent): Promise<void> {
    this.logger.log(
      { event: DB_SECONDARY_BACK_EVENT, node: event.node },
      `Banco secundário (${event.node}) voltou a responder — atualizando-o a partir do principal.`,
    );

    for (const listener of this.secondaryListeners) {
      try {
        await listener(event);
      } catch (error) {
        // O secundário desatualizado é um problema de redundância, não de
        // atendimento: o principal segue servindo. Não pode derrubar nada.
        this.logger.error({ err: error }, 'Falha ao atualizar o banco secundário.');
      }
    }
  }

  /**
   * Deixa a troca de nó registrada no banco, não só no log.
   *
   * O log some com a rotação; a trilha de auditoria responde "quando o
   * banco principal caiu na semana passada?" meses depois. A gravação é
   * best-effort de propósito: se o banco que sobrou também recusar a
   * escrita, o failover não pode falhar por causa do registro dele.
   */
  private async recordFailoverAudit(action: string, event: NodeChangeEvent): Promise<void> {
    try {
      await this.db.auditLog.create({
        data: {
          action,
          entity: 'Database',
          after: { from: event.from, to: event.to, nodeId: this.config.nodeId } as never,
        },
      });
    } catch (error) {
      this.logger.warn({ err: error }, 'Não foi possível registrar a troca de banco na auditoria.');
    }
  }
}
