/**
 * Guard de rate limit do Atlas.
 *
 * Muda duas coisas em relação ao `ThrottlerGuard` padrão:
 *
 *  1. **Quem é contado.** O padrão conta por IP. Numa academia inteira
 *     atrás do mesmo NAT, ou num celular em rede móvel, o IP é
 *     compartilhado — e o limite de IA (5/hora) seria consumido pelo
 *     primeiro usuário. Quando a requisição traz um access token
 *     VÁLIDO, contamos por usuário; caso contrário (login, cadastro,
 *     token forjado) o IP é a única identidade confiável.
 *
 *     A verificação do token acontece aqui, antes do `JwtAuthGuard`,
 *     porque este guard roda primeiro — e precisa rodar primeiro, senão
 *     uma enxurrada de tokens inválidos tomaria 401 sem nunca ser
 *     limitada. O custo é um HMAC-SHA256; irrelevante perto do que a
 *     rota faria em seguida.
 *
 *  2. **O erro devolvido.** O padrão lança `ThrottlerException`, que
 *     vira um 429 fora do envelope do Atlas. Aqui vira `AppError` com
 *     `RATE_LIMITED`, para o front ter um único caminho de tratamento.
 */

import { Inject, Injectable, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  getOptionsToken,
  getStorageToken,
  type ThrottlerLimitDetail,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { extractBearerToken, verifyAccessToken } from '@atlas/auth';
import { AppError, ERROR_CODES } from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';

@Injectable()
export class AtlasThrottlerGuard extends ThrottlerGuard {
  constructor(
    @Inject(getOptionsToken()) options: ThrottlerModuleOptions,
    @Inject(getStorageToken()) storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: EnvConfig,
  ) {
    super(options, storageService, reflector);
  }

  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const headers = req.headers as Record<string, string | undefined> | undefined;
    const token = extractBearerToken(headers?.authorization);

    if (token) {
      try {
        const jwt = this.config.jwt;
        const payload = verifyAccessToken(token, {
          accessSecret: jwt.accessSecret,
          refreshSecret: jwt.refreshSecret,
          accessTtl: jwt.accessTtl,
          refreshTtl: jwt.refreshTtl,
          issuer: jwt.issuer,
          audience: jwt.audience,
        });

        return `user:${payload.sub}`;
      } catch {
        // Token inválido ou expirado: cai para o IP. É o caso em que
        // limitar importa mais, não menos.
      }
    }

    return `ip:${(req.ip as string | undefined) ?? 'desconhecido'}`;
  }

  protected override async throwThrottlingException(
    _context: ExecutionContext,
    detail: ThrottlerLimitDetail,
  ): Promise<void> {
    throw new AppError(
      ERROR_CODES.RATE_LIMITED,
      'Muitas requisições. Aguarde um instante e tente de novo.',
      { status: 429, details: { retryAfterSeconds: detail.timeToBlockExpire } },
    );
  }
}
