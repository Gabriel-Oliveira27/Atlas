/**
 * Login de DESENVOLVIMENTO.
 *
 * ⚠️ Existe para permitir usar o Atlas antes de o Google OAuth estar
 * configurado. Emite um par de tokens válido para um usuário do seed,
 * sem senha e sem provedor externo.
 *
 * ── Por que isto não é um buraco de segurança ───────────────────────
 * Três travas independentes, e basta UMA falhar para a rota sumir:
 *
 *   1. O módulo só registra este controller quando `NODE_ENV` é
 *      `development` (ver `auth.module.ts`) — em produção a rota nem
 *      existe no roteador.
 *   2. O próprio handler revalida `NODE_ENV` a cada chamada.
 *   3. O usuário precisa existir no banco e estar ativo.
 *
 * Redundância proposital: uma trava só bastaria, mas o custo de errar
 * aqui é entregar sessão de administrador para qualquer um.
 *
 * REMOVER quando o Google OAuth estiver configurado.
 */

import { Body, Controller, HttpCode, HttpStatus, Logger, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { permissionsForRole } from '@atlas/auth';
import {
  AppError,
  ERROR_CODES,
  type AuthenticatedUser,
  type LoginResponse,
  type Permission,
  type Role,
} from '@atlas/shared';
import { Public } from '../../common/decorators/index.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { EnvConfig } from '../../config/env.config.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { AuthService } from './auth.service.js';

const devLoginSchema = z.object({
  /** E-mail de um usuário existente. Padrão: o admin criado pelo seed. */
  email: z.string().email().default('admin@atlas.local'),
});

@ApiTags('Autenticação')
@Controller('auth')
export class DevLoginController {
  private readonly logger = new Logger(DevLoginController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly config: EnvConfig,
  ) {
    this.logger.warn(
      'Rota /auth/dev-login ATIVA (apenas em desenvolvimento). ' +
        'Configure o Google OAuth e remova este controller antes de publicar.',
    );
  }

  @Public()
  @Post('dev-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '[DEV] Emite tokens para um usuário do seed, sem OAuth',
    description:
      'Disponível apenas quando NODE_ENV=development. Use enquanto o Google OAuth não estiver configurado.',
  })
  async devLogin(
    @Body(zodBody(devLoginSchema)) body: { email: string },
    @Req() request: FastifyRequest,
  ): Promise<LoginResponse> {
    // Segunda trava: revalida em tempo de execução, mesmo que alguém
    // registre o controller por engano em outro ambiente.
    if (this.config.all.NODE_ENV !== 'development') {
      throw AppError.notFound('Rota');
    }

    const user = await this.prisma.db.user.findFirst({
      where: { email: body.email, deletedAt: null },
      include: {
        role: true,
        memberships: { where: { isActive: true }, select: { gymId: true } },
      },
    });

    if (!user) {
      throw new AppError(
        ERROR_CODES.INVALID_CREDENTIALS,
        `Usuário ${body.email} não existe. Rode "pnpm db:seed" para criar o administrador.`,
        { status: 404 },
      );
    }

    if (!user.isActive) {
      throw new AppError(ERROR_CODES.USER_INACTIVE, 'Conta inativa', { status: 403 });
    }

    const role = user.role.name as Role;

    const authenticated: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      role,
      permissions: permissionsForRole(role) as Permission[],
      gymId: user.memberships[0]?.gymId ?? null,
      isActive: user.isActive,
    };

    const tokens = await this.authService.issueTokens(authenticated, {
      deviceId: 'dev-login',
      ...(typeof request.headers['user-agent'] === 'string'
        ? { userAgent: request.headers['user-agent'] }
        : {}),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });

    this.logger.warn(`[DEV] Sessão emitida para ${user.email} sem autenticação.`);

    return { user: authenticated, tokens };
  }
}
