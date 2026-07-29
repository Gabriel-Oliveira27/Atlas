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
import {
  changePasswordSchema,
  credentialsLoginSchema,
  firstAccessSchema,
  logoutSchema,
  refreshTokenSchema,
  registerSchema,
  type ChangePasswordInput,
  type CredentialsLoginInput,
  type FirstAccessInput,
  type RegisterInput,
} from '@atlas/validation';
import type { AuthenticatedUser, LoginResponse, OAuthProfile } from '@atlas/shared';
import { AppError } from '@atlas/shared';
import { CurrentUser, Public, ThrottleFamily } from '../../common/decorators/index.js';
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

  /**
   * Cadastro por credenciais.
   *
   * E-mail é obrigatório (é o canal de recuperação); CPF e telefone são
   * opcionais e, quando informados, passam a servir de login.
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ThrottleFamily('auth')
  @ApiOperation({ summary: 'Cria uma conta com e-mail, senha e, opcionalmente, CPF/telefone' })
  async register(
    @Body(zodBody(registerSchema)) body: RegisterInput,
    @Req() request: FastifyRequest,
  ): Promise<LoginResponse> {
    return this.authService.register(body, this.sessionContext(request, body.deviceId));
  }

  /**
   * Login por credenciais.
   *
   * `identifier` aceita e-mail, CPF ou telefone no MESMO campo — a API
   * descobre qual é. Ver `resolveLoginIdentifier` em @atlas/shared.
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ThrottleFamily('auth')
  @ApiOperation({ summary: 'Autentica por e-mail, CPF ou telefone + senha' })
  async login(
    @Body(zodBody(credentialsLoginSchema)) body: CredentialsLoginInput,
    @Req() request: FastifyRequest,
  ): Promise<LoginResponse> {
    return this.authService.loginWithCredentials(body, this.sessionContext(request, body.deviceId));
  }

  /**
   * Primeiro acesso: define a senha de uma conta que ainda não tem.
   *
   * Pública porque, por definição, quem chama ainda não consegue
   * autenticar. O que prova a posse é o código de ativação.
   */
  @Public()
  @Post('first-access')
  @HttpCode(HttpStatus.OK)
  @ThrottleFamily('auth')
  @ApiOperation({ summary: 'Primeiro acesso — define a senha com o código de ativação' })
  async firstAccess(
    @Body(zodBody(firstAccessSchema)) body: FirstAccessInput,
    @Req() request: FastifyRequest,
  ): Promise<LoginResponse> {
    return this.authService.firstAccess(body, this.sessionContext(request, body.deviceId));
  }

  /** Define a primeira senha ou troca a existente. */
  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ThrottleFamily('auth')
  @ApiOperation({ summary: 'Define ou altera a senha do usuário autenticado' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(changePasswordSchema)) body: ChangePasswordInput,
  ): Promise<void> {
    await this.authService.changePassword(user.id, body);
  }

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
  @ThrottleFamily('auth')
  @ApiOperation({ summary: 'Rotaciona o par de tokens' })
  async refresh(
    @Body(zodBody(refreshTokenSchema)) body: { refreshToken: string; deviceId?: string },
    @Req() request: FastifyRequest,
  ) {
    return this.authService.refresh(body.refreshToken, this.sessionContext(request, body.deviceId));
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

  /**
   * Informa ao front-end quais métodos de login estão disponíveis.
   *
   * A tela de login lê isto e monta os botões sozinha — é o que permite
   * ligar o Google OAuth depois sem tocar no front.
   */
  @Public()
  @Get('providers')
  @ApiOperation({ summary: 'Métodos de login habilitados' })
  providers(): {
    google: boolean;
    credentials: boolean;
    identifiers: Array<'email' | 'cpf' | 'phone'>;
    /** @deprecated Use `credentials`. Mantido para não quebrar clientes antigos. */
    email: boolean;
  } {
    return {
      google: this.config.google.isConfigured,
      credentials: true,
      identifiers: ['email', 'cpf', 'phone'],
      email: true,
    };
  }

  /** Contexto da sessão extraído da requisição — usado ao emitir tokens. */
  private sessionContext(
    request: FastifyRequest,
    deviceId?: string,
  ): { deviceId?: string; userAgent?: string; ipAddress?: string } {
    return {
      ...(deviceId ? { deviceId } : {}),
      ...(typeof request.headers['user-agent'] === 'string'
        ? { userAgent: request.headers['user-agent'] }
        : {}),
      ...(request.ip ? { ipAddress: request.ip } : {}),
    };
  }
}

export type { LoginResponse };
