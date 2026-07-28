/**
 * Guard de autenticação — aplicado GLOBALMENTE.
 *
 * O padrão é exigir token; abrir uma rota exige o decorator `@Public()`.
 * A inversão importa: esquecer de proteger uma rota nova seria uma falha
 * silenciosa de segurança, enquanto esquecer de liberar uma rota pública
 * aparece imediatamente no primeiro teste.
 */

import { Injectable, Logger, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import {
  extractBearerToken,
  verifyAccessToken,
  TokenVerificationError,
  type TokenConfig,
} from '@atlas/auth';
import {
  AppError,
  ERROR_CODES,
  type AuthenticatedUser,
  type Permission,
  type Role,
} from '@atlas/shared';
import { EnvConfig } from '../../../config/env.config.js';
import { IS_PUBLIC_KEY } from '../../../common/decorators/index.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: EnvConfig,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();

    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      throw AppError.unauthenticated('Token de acesso ausente');
    }

    const jwt = this.config.jwt;
    const tokenConfig: TokenConfig = {
      accessSecret: jwt.accessSecret,
      refreshSecret: jwt.refreshSecret,
      accessTtl: jwt.accessTtl,
      refreshTtl: jwt.refreshTtl,
      issuer: jwt.issuer,
      audience: jwt.audience,
    };

    try {
      const payload = verifyAccessToken(token, tokenConfig);

      // O payload do token é a fonte da verdade da sessão. Consultar o
      // banco a cada requisição anularia a vantagem do JWT sem estado;
      // a revogação acontece no refresh (token de acesso dura 15 min).
      request.user = {
        id: payload.sub,
        email: payload.email,
        name: '',
        avatarUrl: null,
        role: payload.role as Role,
        permissions: payload.permissions as Permission[],
        gymId: payload.gymId ?? null,
        isActive: true,
      };

      return true;
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        throw new AppError(
          error.reason === 'expired' ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
          error.message,
          { status: 401 },
        );
      }
      throw AppError.unauthenticated('Falha ao validar o token');
    }
  }
}
