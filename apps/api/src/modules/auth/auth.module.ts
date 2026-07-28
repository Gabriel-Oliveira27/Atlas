import { Logger, Module, type Provider, type Type } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EnvConfig } from '../../config/env.config.js';
import { AuthController } from './auth.controller.js';
import { DevLoginController } from './dev-login.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleStrategy } from './strategies/google.strategy.js';

/**
 * A estratégia do Google só é registrada quando há credenciais.
 *
 * Sem esta checagem, subir a API em uma máquina recém-clonada quebraria
 * no boot — o Passport valida `clientID` na construção. Assim o Atlas
 * sobe, e o log diz exatamente o que configurar.
 */
function buildStrategyProviders(): Provider[] {
  const logger = new Logger('AuthModule');
  const config = new EnvConfig();

  if (!config.google.isConfigured) {
    logger.warn(
      'Google OAuth não configurado (GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET ausentes) — ' +
        'as rotas /auth/google ficam indisponíveis.',
    );
    return [];
  }

  return [GoogleStrategy];
}

/**
 * Primeira trava do dev-login: fora de `development`, o controller nem
 * é registrado — a rota não existe no roteador.
 */
function buildControllers(): Type<unknown>[] {
  const config = new EnvConfig();

  if (config.all.NODE_ENV === 'development') {
    return [AuthController, DevLoginController];
  }

  return [AuthController];
}

@Module({
  imports: [PassportModule.register({ session: false })],
  controllers: buildControllers(),
  providers: [EnvConfig, AuthService, ...buildStrategyProviders()],
  exports: [AuthService],
})
export class AuthModule {}
