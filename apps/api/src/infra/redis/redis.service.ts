/**
 * Conexão Redis compartilhada — filas BullMQ e rate limit.
 */

import { Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { EnvConfig } from '../../config/env.config.js';

@Injectable()
export class RedisService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(private readonly config: EnvConfig) {
    this.client = new Redis(this.config.redis.url, {
      keyPrefix: `${this.config.redis.prefix}:`,
      // Exigido pelo BullMQ: sem isto, um comando pendente pode ficar
      // preso indefinidamente quando o Redis cai.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5_000),
    });

    this.client.on('error', (error) => {
      this.logger.error({ err: error }, 'Erro na conexão com o Redis');
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
      this.logger.log('Redis conectado.');
    } catch (error) {
      // O Redis é usado por filas e rate limit; sem ele a API ainda
      // atende requisições, então apenas registramos o aviso.
      this.logger.warn({ err: error }, 'Redis indisponível — filas e rate limit ficam degradados.');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client.quit().catch(() => this.client.disconnect());
  }

  async ping(timeoutMs = 2000): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const startedAt = Date.now();
    try {
      await Promise.race([
        this.client.ping(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tempo esgotado')), timeoutMs),
        ),
      ]);
      return { ok: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Opções de conexão no formato esperado pelo BullMQ. */
  get connectionOptions(): { host: string; port: number; password?: string; db?: number } {
    const url = new URL(this.config.redis.url);
    return {
      host: url.hostname,
      port: Number(url.port || 6379),
      ...(url.password ? { password: url.password } : {}),
      ...(url.pathname.length > 1 ? { db: Number(url.pathname.slice(1)) } : {}),
    };
  }
}
