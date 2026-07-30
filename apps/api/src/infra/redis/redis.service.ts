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

      /**
       * As duas opções abaixo existem para o comando FALHAR quando o
       * Redis não está lá — e não esperar por ele.
       *
       * A versão anterior usava `maxRetriesPerRequest: null` com a fila
       * offline no padrão (ligada), justificado como exigência do
       * BullMQ. O raciocínio estava invertido, e o BullMQ não é usado em
       * lugar nenhum do projeto: essa combinação faz o ioredis
       * ENFILEIRAR o comando enquanto o cliente está `reconnecting`, sem
       * nunca resolver nem rejeitar a promise.
       *
       * O efeito era o pior possível numa hospedagem sem Redis: o
       * `AtlasThrottlerGuard` é o primeiro APP_GUARD e roda em TODA
       * requisição, inclusive em `/api/health/live`. O `await` no Redis
       * não voltava, o catch que cai para o contador em memória nunca
       * disparava, e toda requisição pendurava para sempre — o health
       * check do Render estourava por timeout e o deploy morria em
       * "service unhealthy", com a API "de pé" e muda.
       *
       * Com a fila offline desligada, o comando rejeita de imediato
       * ("Stream isn't writeable"), o fallback funciona e a API atende.
       */
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,

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

  /**
   * O cliente está pronto para receber comando agora?
   *
   * Quem está no caminho de uma requisição deve checar isto ANTES de
   * chamar o Redis: pergunta sobre estado em memória, não faz I/O, e é a
   * diferença entre degradar na hora e pagar o timeout de um socket.
   */
  get isReady(): boolean {
    return this.client.status === 'ready';
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
