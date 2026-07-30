/**
 * Armazenamento do rate limit no Redis.
 *
 * O padrão do @nestjs/throttler guarda o contador na MEMÓRIA DO
 * PROCESSO. Duas consequências que só aparecem em produção:
 *
 *   • duas instâncias da API ⇒ o limite efetivo dobra, porque cada
 *     processo conta a sua metade;
 *   • todo restart zera os contadores ⇒ basta esperar um deploy.
 *
 * Com o contador no Redis, o limite é do sistema, não do processo.
 *
 * Implementado sobre o `RedisService` que já existe em vez de somar
 * mais um pacote: são dois comandos de Redis, e a dependência extra
 * traria a sua própria conexão para gerenciar.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface.js';
import { RedisService } from './redis.service.js';

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);

  /**
   * Contadores locais usados só enquanto o Redis está fora.
   * Ver a nota sobre degradação em `increment`.
   */
  private readonly fallback = new Map<string, { hits: number; expiresAt: number }>();

  /**
   * Teto para o rate limit falar com o Redis.
   *
   * Este código roda no primeiro APP_GUARD, ou seja, à frente de TODA
   * requisição — inclusive das sondas de health que a hospedagem usa
   * para decidir se o deploy sobe. Nada aqui pode custar mais que uns
   * poucos milissegundos: contar acesso é acessório, atender é o
   * essencial. Estourado o prazo, o contador em memória assume.
   */
  private static readonly DEADLINE_MS = 300;

  constructor(private readonly redis: RedisService) {}

  /**
   * Impõe o prazo acima a uma operação no Redis.
   *
   * O `enableOfflineQueue: false` do RedisService já faz o comando
   * rejeitar de imediato quando a conexão está fora, e é a defesa
   * principal. Este prazo cobre o caso que a configuração não cobre:
   * conexão estabelecida ("ready") mas travada no meio — meio-aberta por
   * queda de rota, ou um servidor lento demais. Sem ele, o `await`
   * voltaria a poder segurar a requisição indefinidamente.
   */
  private async comPrazo<T>(operacao: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        operacao,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error(`Redis não respondeu em ${RedisThrottlerStorage.DEADLINE_MS}ms`)),
            RedisThrottlerStorage.DEADLINE_MS,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Registra um acerto e devolve o estado da janela.
   *
   * `INCR` + `PEXPIRE` em pipeline: o `INCR` cria a chave com 1 na
   * primeira requisição da janela e o `PEXPIRE` só é aplicado nessa
   * primeira vez — renovar o TTL a cada acerto transformaria a janela
   * fixa em janela deslizante infinita, e quem batesse no limite sem
   * parar nunca sairia do bloqueio.
   */
  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`;
    const blockKey = `throttle:${throttlerName}:${key}:blocked`;

    // Atalho sem I/O: Redis fora do ar é o caso comum numa hospedagem
    // gratuita, e nem vale tentar. Evita também encher o log com um erro
    // de conexão por requisição.
    if (!this.redis.isReady) {
      return this.incrementInMemory(hitKey, ttl, limit);
    }

    try {
      const blockedTtl = await this.comPrazo(this.redis.client.pttl(blockKey));
      if (blockedTtl > 0) {
        return {
          totalHits: limit + 1,
          timeToExpire: Math.ceil(blockedTtl / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockedTtl / 1000),
        };
      }

      const pipeline = this.redis.client.multi();
      pipeline.incr(hitKey);
      pipeline.pttl(hitKey);
      const result = await this.comPrazo(pipeline.exec());

      const totalHits = Number(result?.[0]?.[1] ?? 1);
      let remainingTtl = Number(result?.[1]?.[1] ?? -1);

      if (remainingTtl < 0) {
        await this.comPrazo(this.redis.client.pexpire(hitKey, ttl));
        remainingTtl = ttl;
      }

      if (totalHits > limit) {
        await this.comPrazo(this.redis.client.psetex(blockKey, blockDuration || ttl, '1'));
        const blockMs = blockDuration || ttl;

        return {
          totalHits,
          timeToExpire: Math.ceil(blockMs / 1000),
          isBlocked: true,
          timeToBlockExpire: Math.ceil(blockMs / 1000),
        };
      }

      return {
        totalHits,
        timeToExpire: Math.ceil(remainingTtl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    } catch (error) {
      // Redis fora: cair para contagem em memória em vez de recusar
      // toda requisição. O rate limit fica por processo (o problema
      // que este arquivo existe para resolver), mas a API continua no
      // ar — e o WARN diz por quê. Recusar tudo transformaria uma
      // queda do Redis em queda do Atlas inteiro.
      this.logger.warn(
        { err: error, throttlerName },
        'Redis indisponível para rate limit — usando contador em memória deste processo.',
      );
      return this.incrementInMemory(hitKey, ttl, limit);
    }
  }

  private incrementInMemory(key: string, ttl: number, limit: number): ThrottlerStorageRecord {
    const now = Date.now();
    const current = this.fallback.get(key);

    if (!current || current.expiresAt <= now) {
      this.fallback.set(key, { hits: 1, expiresAt: now + ttl });
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    current.hits += 1;
    const timeToExpire = Math.ceil((current.expiresAt - now) / 1000);
    const isBlocked = current.hits > limit;

    return {
      totalHits: current.hits,
      timeToExpire,
      isBlocked,
      timeToBlockExpire: isBlocked ? timeToExpire : 0,
    };
  }
}
