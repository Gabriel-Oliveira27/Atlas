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
  hashPassword,
  hashRefreshToken,
  needsRehash,
  permissionsForRole,
  signTokenPair,
  verifyActivationCode,
  verifyPassword,
  verifyRefreshToken,
  TokenVerificationError,
  type TokenConfig,
} from '@atlas/auth';
import {
  AppError,
  ERROR_CODES,
  LOGIN_IDENTIFIER,
  ROLES,
  candidateIdentifiers,
  type AuthTokens,
  type AuthenticatedUser,
  type LoginResponse,
  type OAuthProfile,
  type Permission,
  type Role,
} from '@atlas/shared';
import type {
  ChangePasswordInput,
  CredentialsLoginInput,
  FirstAccessInput,
  RegisterInput,
} from '@atlas/validation';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';

interface SessionContext {
  deviceId?: string;
  userAgent?: string;
  ipAddress?: string;
}

/**
 * Hash bcrypt de uma senha que ninguém tem.
 *
 * Serve só para dar trabalho ao processador quando o identificador
 * informado não existe: sem ele, "conta inexistente" responderia em
 * microssegundos e "senha errada" em ~250 ms, e essa diferença é
 * suficiente para enumerar quem tem conta no Atlas.
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.4WuIu3XPS3eBhLzQzT8sVvGWCLLGMJm';

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

  /**
   * Cadastro por credenciais.
   *
   * E-mail, CPF e telefone são únicos. Checamos os três ANTES de gravar
   * para devolver o código do campo exato — deixar o banco recusar
   * daria só "violação de unicidade", e o formulário não saberia qual
   * campo destacar.
   */
  async register(input: RegisterInput, context: SessionContext): Promise<LoginResponse> {
    const db = this.prisma.db;

    await this.assertIdentifiersAvailable({
      email: input.email,
      ...(input.cpf ? { cpf: input.cpf } : {}),
      ...(input.phone ? { phone: input.phone } : {}),
    });

    const role = await db.role.findUniqueOrThrow({ where: { name: ROLES.USER } });
    const passwordHash = await hashPassword(input.password);

    const user = await db.user.create({
      data: {
        email: input.email,
        name: input.name,
        roleId: role.id,
        passwordHash,
        ...(input.cpf ? { cpf: input.cpf } : {}),
        ...(input.phone ? { phone: input.phone } : {}),
        lastLoginAt: new Date(),
        originNode: this.config.nodeId,
      },
      include: { role: true, memberships: { where: { isActive: true } } },
    });

    const authenticated = this.toAuthenticatedUser(user);
    const tokens = await this.issueTokens(authenticated, context);

    return { user: authenticated, tokens };
  }

  /**
   * Login por e-mail, CPF ou telefone.
   *
   * Toda falha devolve a MESMA resposta (`INVALID_CREDENTIALS`), e o
   * hash é verificado mesmo quando o usuário não existe: distinguir
   * "conta inexistente" de "senha errada" — por código ou por tempo de
   * resposta — entrega ao atacante a lista de quem tem conta aqui.
   *
   * A única exceção é a conta que entrou por Google e nunca definiu
   * senha: aí o código específico é o que permite à tela dizer "entre
   * com o Google" em vez de deixar a pessoa tentando senhas que não
   * existem.
   */
  async loginWithCredentials(
    input: CredentialsLoginInput,
    context: SessionContext,
  ): Promise<LoginResponse> {
    const candidates = candidateIdentifiers(input.identifier);
    const db = this.prisma.db;

    const user = candidates.length
      ? await db.user.findFirst({
          where: {
            deletedAt: null,
            OR: candidates.map((candidate) => {
              if (candidate.type === LOGIN_IDENTIFIER.EMAIL) return { email: candidate.value };
              if (candidate.type === LOGIN_IDENTIFIER.CPF) return { cpf: candidate.value };
              return { phone: candidate.value };
            }),
          },
          include: { role: true, memberships: { where: { isActive: true } } },
        })
      : null;

    // Comparação contra um hash descartável quando não há usuário: o
    // custo do bcrypt é pago nos dois caminhos, então o tempo de
    // resposta não denuncia a existência da conta.
    const matches = await verifyPassword(input.password, user?.passwordHash ?? DUMMY_HASH);

    if (!user || !user.passwordHash) {
      // Conta sem senha tem duas histórias diferentes, e a tela precisa
      // saber qual é: uma manda o usuário para o Google, a outra para o
      // primeiro acesso. Um código genérico deixaria a pessoa presa.
      if (user && !user.passwordHash) {
        const hasGoogle = await db.oAuthAccount.findFirst({
          where: { userId: user.id },
          select: { id: true },
        });

        if (hasGoogle) {
          throw new AppError(
            ERROR_CODES.PASSWORD_NOT_SET,
            'Esta conta entra com o Google. Defina uma senha em Configurações se quiser entrar sem ele.',
            { status: 409 },
          );
        }

        throw new AppError(
          ERROR_CODES.FIRST_ACCESS_REQUIRED,
          'Primeiro acesso: crie sua senha usando o código de ativação.',
          { status: 409 },
        );
      }
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Credenciais inválidas', { status: 401 });
    }

    if (!matches) {
      throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Credenciais inválidas', { status: 401 });
    }

    if (!user.isActive) {
      throw new AppError(ERROR_CODES.USER_INACTIVE, 'Esta conta está inativa', { status: 403 });
    }

    // Rehash oportunista: quando o custo do bcrypt subir, as senhas
    // migram sozinhas no próximo login, sem pedir nada ao usuário.
    const passwordHash = needsRehash(user.passwordHash)
      ? await hashPassword(input.password)
      : undefined;

    await db.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), ...(passwordHash ? { passwordHash } : {}) },
    });

    const authenticated = this.toAuthenticatedUser(user);
    const tokens = await this.issueTokens(authenticated, context);

    return { user: authenticated, tokens };
  }

  /**
   * Primeiro acesso — define a senha e já devolve a sessão.
   *
   * A conta existe e nunca teve senha. Três coisas precisam ser
   * verdadeiras, e as três falham com o MESMO erro: identificador
   * conhecido, conta ainda sem senha, código de ativação válido e
   * dentro do prazo. Códigos distintos diriam ao atacante em qual das
   * três ele acertou.
   *
   * O código é de uso único: some assim que a senha é definida.
   */
  async firstAccess(input: FirstAccessInput, context: SessionContext): Promise<LoginResponse> {
    const candidates = candidateIdentifiers(input.identifier);
    const db = this.prisma.db;

    const user = candidates.length
      ? await db.user.findFirst({
          where: {
            deletedAt: null,
            OR: candidates.map((candidate) => {
              if (candidate.type === LOGIN_IDENTIFIER.EMAIL) return { email: candidate.value };
              if (candidate.type === LOGIN_IDENTIFIER.CPF) return { cpf: candidate.value };
              return { phone: candidate.value };
            }),
          },
          include: { role: true, memberships: { where: { isActive: true } } },
        })
      : null;

    // Devolve o erro em vez de lançar de dentro de um helper: assim o
    // `throw` fica visível no fluxo e o TypeScript consegue estreitar
    // `user` para não-nulo depois da primeira checagem.
    const invalid = (): AppError =>
      new AppError(
        ERROR_CODES.ACTIVATION_CODE_INVALID,
        'Código de ativação inválido ou expirado.',
        { status: 401 },
      );

    // O código é verificado mesmo sem usuário, para o tempo de resposta
    // não denunciar quais identificadores existem.
    const codeMatches = verifyActivationCode(
      input.activationCode,
      user?.activationCodeHash ?? null,
    );

    if (!user || !codeMatches) throw invalid();
    if (user.passwordHash) throw invalid();
    if (!user.activationExpiresAt || user.activationExpiresAt < new Date()) throw invalid();
    if (!user.isActive) {
      throw new AppError(ERROR_CODES.USER_INACTIVE, 'Esta conta está inativa', { status: 403 });
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(input.newPassword),
        // Uso único: o código morre aqui.
        activationCodeHash: null,
        activationExpiresAt: null,
        lastLoginAt: new Date(),
        version: { increment: 1 },
      },
      include: { role: true, memberships: { where: { isActive: true } } },
    });

    this.logger.log({ userId: user.id }, 'Primeiro acesso concluído — senha definida.');

    const authenticated = this.toAuthenticatedUser(updated);
    const tokens = await this.issueTokens(authenticated, context);

    return { user: authenticated, tokens };
  }

  /**
   * Define ou troca a senha do próprio usuário.
   *
   * Quem já tem senha precisa informar a atual: sem essa confirmação,
   * um access token roubado (15 minutos de validade) viraria posse
   * definitiva da conta.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const db = this.prisma.db;

    const user = await db.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { id: true, passwordHash: true },
    });

    if (!user) throw AppError.notFound('Usuário', userId);

    if (user.passwordHash) {
      const valid =
        Boolean(input.currentPassword) &&
        (await verifyPassword(input.currentPassword as string, user.passwordHash));

      if (!valid) {
        throw new AppError(ERROR_CODES.INVALID_CREDENTIALS, 'Senha atual incorreta', {
          status: 401,
        });
      }
    }

    await db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(input.newPassword), version: { increment: 1 } },
    });

    if (input.revokeOtherSessions) {
      await db.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokedReason: 'password-changed' },
      });
    }
  }

  /**
   * Garante que e-mail, CPF e telefone ainda não pertencem a outra
   * conta. `excludeUserId` permite reusar isto na edição de perfil.
   */
  async assertIdentifiersAvailable(
    identifiers: { email?: string; cpf?: string; phone?: string },
    excludeUserId?: string,
  ): Promise<void> {
    const db = this.prisma.db;

    const checks: Array<{
      where: { email: string } | { cpf: string } | { phone: string };
      code: (typeof ERROR_CODES)[
        'EMAIL_ALREADY_REGISTERED' | 'CPF_ALREADY_REGISTERED' | 'PHONE_ALREADY_REGISTERED'];
      field: string;
      message: string;
    }> = [];

    if (identifiers.email) {
      checks.push({
        where: { email: identifiers.email },
        code: ERROR_CODES.EMAIL_ALREADY_REGISTERED,
        field: 'email',
        message: 'Este e-mail já está cadastrado',
      });
    }
    if (identifiers.cpf) {
      checks.push({
        where: { cpf: identifiers.cpf },
        code: ERROR_CODES.CPF_ALREADY_REGISTERED,
        field: 'cpf',
        message: 'Este CPF já está cadastrado',
      });
    }
    if (identifiers.phone) {
      checks.push({
        where: { phone: identifiers.phone },
        code: ERROR_CODES.PHONE_ALREADY_REGISTERED,
        field: 'phone',
        message: 'Este telefone já está cadastrado',
      });
    }

    for (const check of checks) {
      const existing = await db.user.findFirst({
        where: { ...check.where, ...(excludeUserId ? { id: { not: excludeUserId } } : {}) },
        select: { id: true },
      });

      if (existing) {
        throw new AppError(check.code, check.message, {
          status: 409,
          details: { field: check.field },
        });
      }
    }
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
