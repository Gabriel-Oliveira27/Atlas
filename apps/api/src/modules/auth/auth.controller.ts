/**
 * Rotas de autenticação.
 *
 * Fluxo do Google OAuth:
 *   GET /auth/google           → redireciona para o Google
 *   GET /auth/google/callback  → Google devolve aqui; emitimos os tokens
 *                                e redirecionamos para o web ou o app
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { logoutSchema, refreshTokenSchema } from '@atlas/validation';
import type { AuthenticatedUser, LoginResponse, OAuthProfile } from '@atlas/shared';
import { AppError } from '@atlas/shared';
import { CurrentUser, Public } from '../../common/decorators/index.js';
import { RawResponse } from '../../common/interceptors/response.interceptor.js';
import { zodBody } from '../../common/pipes/zod-validation.pipe.js';
import { EnvConfig } from '../../config/env.config.js';
import { AuthService } from './auth.service.js';

@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: EnvConfig,
  ) {}

  /** Início do fluxo — o Passport redireciona para o Google. */
  @Public()
  @Get('google')
  @UseGuards(AuthGuard('google'))
  @ApiOperation({ summary: 'Inicia o login com Google' })
  @ApiExcludeEndpoint()
  googleAuth(): void {
    // O guard cuida do redirecionamento; este corpo nunca executa.
  }

  /**
   * Callback do Google.
   *
   * Redireciona (em vez de responder JSON) porque quem chega aqui é o
   * NAVEGADOR do usuário, vindo do Google — não o código do front-end.
   * Os tokens seguem no fragmento da URL de destino.
   */
  @Public()
  @RawResponse()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  @ApiExcludeEndpoint()
  async googleCallback(
    @Req() request: FastifyRequest & { user?: OAuthProfile },
    @Res() reply: FastifyReply,
    @Query('platform') platform?: string,
  ): Promise<void> {
    const google = this.config.google;

    try {
      const profile = request.user;
      if (!profile) throw AppError.unauthenticated('Perfil do Google não recebido');

      const result = await this.authService.loginWithGoogle(profile, {
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });

      const base = platform === 'mobile' ? google.successRedirectMobile : google.successRedirectWeb;

      // Fragmento (#) em vez de query string: o fragmento não é enviado
      // ao servidor nem registrado em logs de acesso intermediários.
      const target =
        `${base}#access_token=${encodeURIComponent(result.tokens.accessToken)}` +
        `&refresh_token=${encodeURIComponent(result.tokens.refreshToken)}` +
        `&expires_in=${result.tokens.expiresIn}`;

      void reply.redirect(target, 302);
    } catch {
      void reply.redirect(google.failureRedirect, 302);
    }
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotaciona o par de tokens' })
  async refresh(
    @Body(zodBody(refreshTokenSchema)) body: { refreshToken: string; deviceId?: string },
    @Req() request: FastifyRequest,
  ) {
    return this.authService.refresh(body.refreshToken, {
      ...(body.deviceId ? { deviceId: body.deviceId } : {}),
      ...(typeof request.headers['user-agent'] === 'string'
        ? { userAgent: request.headers['user-agent'] }
        : {}),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Encerra a sessão' })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(logoutSchema)) body: { refreshToken?: string; allDevices: boolean },
  ): Promise<void> {
    await this.authService.logout(user.id, {
      ...(body.refreshToken ? { refreshToken: body.refreshToken } : {}),
      allDevices: body.allDevices,
    });
  }

  @Get('me')
  @ApiOperation({ summary: 'Dados da sessão atual' })
  me(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  /** Informa ao front-end quais métodos de login estão disponíveis. */
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Métodos de login habilitados' })
  providers(): { google: boolean; email: boolean } {
    return {
      google: this.config.google.isConfigured,
      // Login por e-mail está previsto no roadmap, ainda não habilitado.
      email: false,
    };
  }
}

export type { LoginResponse };
