/**
 * Serviço de autenticação.
 *
 * Fluxo: Google OAuth → usuário no banco → par de tokens.
 *
 * O refresh token é ROTATIVO: cada uso emite um novo par e invalida o
 * anterior. Se um token já usado reaparecer, presume-se roubo e toda a
 * família daquele dispositivo é revogada — o atacante e a vítima são
 * desconectados, e a vítima percebe o problema.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  extractBearerToken,
  hashRefreshToken,
  permissionsForRole,
  signTokenPair,
  verifyRefreshToken,
  TokenVerificationError,
  type TokenConfig,
} from '@atlas/auth';
import {
  AppError,
  ERROR_CODES,
  ROLES,
  type AuthTokens,
  type AuthenticatedUser,
  type LoginResponse,
  type OAuthProfile,
  type Permission,
  type Role,
} from '@atlas/shared';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

interface SessionContext {
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {}

  private get tokenConfig(): TokenConfig {
    const jwt = this.config.jwt;
    return {
      accessSecret: jwt.accessSecret,
      refreshSecret: jwt.refreshSecret,
      accessTtl: jwt.accessTtl,
      refreshTtl: jwt.refreshTtl,
      issuer: jwt.issuer,
      audience: jwt.audience,
    };
  }

  /**
   * Login (ou cadastro) por Google.
   *
   * Vincula pelo E-MAIL quando já existe conta: um usuário criado pelo
   * administrador da academia precisa conseguir entrar com o Google sem
   * gerar um segundo cadastro duplicado.
   */
  async loginWithGoogle(profile: OAuthProfile, context: SessionContext): Promise<LoginResponse> {
    if (!profile.emailVerified) {
      throw new AppError(
        ERROR_CODES.OAUTH_FAILED,
        'A conta Google precisa ter o e-mail verificado',
        { status: 401 },
      );
    }

    const db = this.prisma.db;

    const existingAccount = await db.oAuthAccount.findUnique({
      where: {
        provider_providerAccountId: {
          provider: profile.provider,
          providerAccountId: profile.providerAccountId,
        },
      },
      include: { user: { include: { role: true, memberships: { where: { isActive: true } } } } },
    });

    let user = existingAccount?.user ?? null;

    if (!user) {
      const byEmail = await db.user.findUnique({
        where: { email: profile.email },
        include: { role: true, memberships: { where: { isActive: true } } },
      });

      if (byEmail) {
        // Conta pré-cadastrada: apenas vincula o provedor.
        await db.oAuthAccount.create({
          data: {
            userId: byEmail.id,
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
            email: profile.email,
          },
        });
        user = byEmail;
      } else {
        user = await this.createUserFromOAuth(profile);
      }
    }

    if (!user.isActive || user.deletedAt) {
      throw new AppError(ERROR_CODES.USER_INACTIVE, 'Esta conta está inativa', { status: 403 });
    }

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const authenticated = this.toAuthenticatedUser(user);
    const tokens = await this.issueTokens(authenticated, context);

    return { user: authenticated, tokens };
  }

  private async createUserFromOAuth(profile: OAuthProfile) {
    const db = this.prisma.db;

    const role = await db.role.findUniqueOrThrow({ where: { name: ROLES.USER } });

    return db.user.create({
      data: {
        email: profile.email,
        name: profile.name,
        roleId: role.id,
        ...(profile.avatarUrl ? { avatarUrl: profile.avatarUrl } : {}),
        originNode: this.config.nodeId,
        oauthAccounts: {
          create: {
            provider: profile.provider,
            providerAccountId: profile.providerAccountId,
            email: profile.email,
          },
        },
      },
      include: { role: true, memberships: { where: { isActive: true } } },
    });
  }

  /** Emite o par de tokens e persiste o hash do refresh. */
  async issueTokens(user: AuthenticatedUser, context: SessionContext): Promise<AuthTokens> {
    const tokens = signTokenPair(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        permissions: user.permissions,
        ...(user.gymId ? { gymId: user.gymId } : {}),
        ...(context.deviceId ? { deviceId: context.deviceId } : {}),
      },
      this.tokenConfig,
    );

    await this.prisma.db.refreshToken.create({
      data: {
        userId: user.id,
        // Somente o hash é gravado: um vazamento do banco não entrega
        // tokens utilizáveis.
        tokenHash: hashRefreshToken(tokens.refreshToken),
        jti: tokens.refreshJti,
        expiresAt: tokens.refreshExpiresAt,
        ...(context.deviceId ? { deviceId: context.deviceId } : {}),
        ...(context.userAgent ? { userAgent: context.userAgent } : {}),
        ...(context.ipAddress ? { ipAddress: context.ipAddress } : {}),
      },
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Rotaciona o refresh token.
   *
   * Reuso de um token já rotacionado é tratado como comprometimento:
   * revoga tudo daquele dispositivo em vez de apenas negar a requisição.
   */
  async refresh(refreshToken: string, context: SessionContext): Promise<AuthTokens> {
    let payload;
    try {
      payload = verifyRefreshToken(refreshToken, this.tokenConfig);
    } catch (error) {
      if (error instanceof TokenVerificationError) {
        throw new AppError(
          error.reason === 'expired' ? ERROR_CODES.TOKEN_EXPIRED : ERROR_CODES.TOKEN_INVALID,
          error.message,
          { status: 401 },
        );
      }
      throw error;
    }

    const db = this.prisma.db;
    const stored = await db.refreshToken.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
    });

    if (!stored) {
      throw new AppError(ERROR_CODES.TOKEN_INVALID, 'Refresh token desconhecido', { status: 401 });
    }

    if (stored.revokedAt) {
      // Token válido criptograficamente, mas já revogado = reuso.
      this.logger.warn(
        { userId: stored.userId, deviceId: stored.deviceId },
        'Reuso de refresh token detectado — revogando a sessão do dispositivo.',
      );

      await this.revokeDeviceTokens(stored.userId, stored.deviceId, 'reuse-detected');

      throw new AppError(
        ERROR_CODES.REFRESH_TOKEN_REUSED,
        'Sessão encerrada por segurança. Entre novamente.',
        { status: 401 },
      );
    }

    if (stored.expiresAt < new Date()) {
      throw new AppError(ERROR_CODES.TOKEN_EXPIRED, 'Refresh token expirado', { status: 401 });
    }

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      include: { role: true, memberships: { where: { isActive: true } } },
    });

    if (!user || !user.isActive || user.deletedAt) {
      throw new AppError(ERROR_CODES.USER_INACTIVE, 'Conta inativa', { status: 403 });
    }

    const authenticated = this.toAuthenticatedUser(user);
    const tokens = await this.issueTokens(authenticated, {
      ...context,
      deviceId: context.deviceId ?? stored.deviceId ?? undefined,
    });

    // Marca o antigo como rotacionado, encadeando com o novo.
    await db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), revokedReason: 'rotated' },
    });

    return tokens;
  }

  /** Encerra a sessão — deste dispositivo ou de todos. */
  async logout(
    userId: string,
    options: { refreshToken?: string; allDevices?: boolean },
  ): Promise<void> {
    const db = this.prisma.db;

    if (options.allDevices) {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout-all' },
      });
      return;
    }

    if (options.refreshToken) {
      await db.refreshToken.updateMany({
        where: { tokenHash: hashRefreshToken(options.refreshToken), revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'logout' },
      });
    }
  }

  private async revokeDeviceTokens(
    userId: string,
    deviceId: string | null,
    reason: string,
  ): Promise<void> {
    await this.prisma.db.refreshToken.updateMany({
      where: {
        userId,
        ...(deviceId ? { deviceId } : {}),
        revokedAt: null,
      },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** Resolve o usuário a partir do header Authorization (usado no guard). */
  async resolveFromHeader(authorization: string | undefined): Promise<string | null> {
    return extractBearerToken(authorization);
  }

  private toAuthenticatedUser(user: {
    id: string;
    email: string;
    name: string;
    avatarUrl: string | null;
    isActive: boolean;
    role: { name: string };
    memberships?: Array<{ gymId: string }>;
  }): AuthenticatedUser {
    const role = user.role.name as Role;

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role,
      permissions: permissionsForRole(role) as Permission[],
      gymId: user.memberships?.[0]?.gymId ?? null,
      isActive: user.isActive,
    };
  }
}
