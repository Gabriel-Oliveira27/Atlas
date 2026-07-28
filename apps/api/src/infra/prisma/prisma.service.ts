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
} from '@atlas/database';
import { DATABASE_NODE, type DatabaseNode } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';

@Injectable()
export class PrismaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);
  private readonly router: DatabaseRouter;

  /**
   * Callbacks disparados quando o banco local volta. O módulo de
   * sincronização se registra aqui — evita que este serviço dependa
   * dele (o que criaria uma dependência circular).
   */
  private readonly recoveryListeners: Array<(event: NodeChangeEvent) => void | Promise<void>> = [];

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
    });
  }

  async onModuleInit(): Promise<void> {
    await this.router.start();

    const health = this.router.getHealth();

    if (!health.local.available) {
      this.logger.warn(
        `Banco LOCAL indisponível (${health.local.error ?? 'sem detalhe'}). ` +
          (health.cloud?.available
            ? 'Operando temporariamente com o Neon.'
            : 'O Neon também está indisponível — a API responderá 503.'),
      );
    } else {
      this.logger.log(`Banco LOCAL disponível (${health.local.latencyMs} ms).`);
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

  /** true quando estamos em contingência (Neon substituindo o local). */
  get isDegraded(): boolean {
    return this.router.isDegraded();
  }

  getHealth(): DatabaseHealth {
    return this.router.getHealth();
  }

  async checkHealth(): Promise<DatabaseHealth> {
    return this.router.checkHealth();
  }

  /** Registra um callback para quando o banco local retornar. */
  onLocalRecovered(listener: (event: NodeChangeEvent) => void | Promise<void>): void {
    this.recoveryListeners.push(listener);
  }

  private async handleNodeChange(event: NodeChangeEvent): Promise<void> {
    if (event.to === DATABASE_NODE.CLOUD) {
      this.logger.warn(
        'Banco local indisponível — assumindo o Neon. As alterações serão reconciliadas quando o local voltar.',
      );
      return;
    }

    if (event.recovered) {
      this.logger.log('Banco local restabelecido — iniciando reconciliação.');

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
}
