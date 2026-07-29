import { Logger, Module, type Provider } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { EnvConfig } from '../../config/env.config.js';
import { AuthController } from './auth.controller.js';
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
 * O `dev-login` foi REMOVIDO.
 *
 * Ele existia para dar uma sessão de SUPER_ADMIN sem senha enquanto não
 * havia login de verdade. Agora há: `POST /auth/login` aceita e-mail,
 * CPF ou telefone com senha, e o administrador do seed já nasce com
 * uma. Não recrie a rota — se precisar de acesso local, use o seed.
 */
@Module({
  imports: [PassportModule.register({ session: false })],
  controllers: [AuthController],
  providers: [EnvConfig, AuthService, ...buildStrategyProviders()],
  exports: [AuthService],
})
export class AuthModule {}
