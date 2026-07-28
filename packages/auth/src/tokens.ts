/**
 * Emissão e verificação de tokens JWT.
 *
 * Estratégia:
 *  - Access token curto (15 min por padrão), sem estado no servidor.
 *  - Refresh token longo (30 dias), COM estado: o hash é gravado em
 *    `RefreshToken`. Isso permite revogar sessões e detectar reuso.
 *  - Rotação: cada refresh gera um novo par e invalida o anterior.
 *    Se um `jti` já usado reaparecer, presume-se roubo de token e
 *    toda a família daquele dispositivo é revogada.
 */

import { createHash, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type {
  AccessTokenPayload,
  AuthTokens,
  Permission,
  RefreshTokenPayload,
  Role,
} from '@atlas/shared';

export interface TokenConfig {
  accessSecret: string;
  refreshSecret: string;
  /** Formato aceito pelo jsonwebtoken: "15m", "30d", "1h"… */
  accessTtl: string;
  refreshTtl: string;
  issuer: string;
  audience: string;
}

export interface AccessTokenClaims {
  userId: string;
  email: string;
  role: Role;
  permissions: Permission[];
  gymId?: string;
  deviceId?: string;
}

/** Emite o access token (curto, sem estado). */
export function signAccessToken(claims: AccessTokenClaims, config: TokenConfig): string {
  return jwt.sign(
    {
      email: claims.email,
      role: claims.role,
      permissions: claims.permissions,
      ...(claims.gymId ? { gymId: claims.gymId } : {}),
      ...(claims.deviceId ? { deviceId: claims.deviceId } : {}),
    },
    config.accessSecret,
    {
      subject: claims.userId,
      expiresIn: config.accessTtl,
      issuer: config.issuer,
      audience: config.audience,
    } as jwt.SignOptions,
  );
}

export interface SignedRefreshToken {
  token: string;
  /** Identificador desta emissão — gravado no banco para rotação/reuso. */
  jti: string;
  expiresAt: Date;
}

/** Emite o refresh token. O `jti` deve ser persistido pelo chamador. */
export function signRefreshToken(
  params: { userId: string; deviceId?: string },
  config: TokenConfig,
): SignedRefreshToken {
  const jti = randomUUID();

  const token = jwt.sign(
    { ...(params.deviceId ? { deviceId: params.deviceId } : {}) },
    config.refreshSecret,
    {
      subject: params.userId,
      jwtid: jti,
      expiresIn: config.refreshTtl,
      issuer: config.issuer,
      audience: config.audience,
    } as jwt.SignOptions,
  );

  const decoded = jwt.decode(token) as { exp: number };

  return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
}

/** Emite o par completo de tokens. */
export function signTokenPair(
  claims: AccessTokenClaims,
  config: TokenConfig,
): AuthTokens & {
  refreshJti: string;
  refreshExpiresAt: Date;
} {
  const accessToken = signAccessToken(claims, config);
  const refresh = signRefreshToken({ userId: claims.userId, deviceId: claims.deviceId }, config);
  const decoded = jwt.decode(accessToken) as { exp: number; iat: number };

  return {
    accessToken,
    refreshToken: refresh.token,
    expiresIn: decoded.exp - decoded.iat,
    tokenType: 'Bearer',
    refreshJti: refresh.jti,
    refreshExpiresAt: refresh.expiresAt,
  };
}

export class TokenVerificationError extends Error {
  constructor(
    message: string,
    readonly reason: 'expired' | 'invalid',
  ) {
    super(message);
    this.name = 'TokenVerificationError';
  }
}

export function verifyAccessToken(token: string, config: TokenConfig): AccessTokenPayload {
  try {
    return jwt.verify(token, config.accessSecret, {
      issuer: config.issuer,
      audience: config.audience,
    }) as AccessTokenPayload;
  } catch (error) {
    throw toVerificationError(error, 'acesso');
  }
}

export function verifyRefreshToken(token: string, config: TokenConfig): RefreshTokenPayload {
  try {
    return jwt.verify(token, config.refreshSecret, {
      issuer: config.issuer,
      audience: config.audience,
    }) as RefreshTokenPayload;
  } catch (error) {
    throw toVerificationError(error, 'atualização');
  }
}

function toVerificationError(error: unknown, kind: string): TokenVerificationError {
  if (error instanceof jwt.TokenExpiredError) {
    return new TokenVerificationError(`Token de ${kind} expirado`, 'expired');
  }
  return new TokenVerificationError(`Token de ${kind} inválido`, 'invalid');
}

/**
 * Hash do refresh token para armazenamento.
 *
 * Guardamos apenas o hash: se o banco vazar, os tokens não são
 * utilizáveis. SHA-256 basta aqui (diferente de senha) porque o
 * token já é aleatório e de alta entropia — não é força-bruteável.
 */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Extrai o token de um header `Authorization: Bearer <token>`. */
export function extractBearerToken(authorizationHeader: string | undefined): string | null {
  if (!authorizationHeader) return null;
  const [scheme, token] = authorizationHeader.split(' ');
  if (!scheme || !token || scheme.toLowerCase() !== 'bearer') return null;
  return token.trim() || null;
}
