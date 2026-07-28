/**
 * Contratos de autenticação compartilhados entre API, web e mobile.
 */

import type { Permission } from '../constants/permissions.js';
import type { Role } from '../constants/roles.js';

/** Conteúdo do JWT de acesso. */
export interface AccessTokenPayload {
  /** ID do usuário (subject). */
  sub: string;
  email: string;
  role: Role;
  permissions: Permission[];
  /** Academia ativa no contexto da sessão, quando houver. */
  gymId?: string;
  /** Dispositivo que originou a sessão — usado para revogação seletiva. */
  deviceId?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

/**
 * Conteúdo do refresh token.
 *
 * `jti` identifica esta emissão específica. A rotação grava o `jti`
 * usado; se o mesmo `jti` reaparecer, é sinal de token roubado e toda
 * a família de tokens do dispositivo é revogada (detecção de reuso).
 */
export interface RefreshTokenPayload {
  sub: string;
  jti: string;
  deviceId?: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Segundos até o access token expirar. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: Role;
  permissions: Permission[];
  gymId: string | null;
  isActive: boolean;
}

export interface LoginResponse {
  user: AuthenticatedUser;
  tokens: AuthTokens;
}

/** Perfil normalizado devolvido pelo provedor OAuth. */
export interface OAuthProfile {
  provider: 'google';
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  name: string;
  avatarUrl?: string;
}
