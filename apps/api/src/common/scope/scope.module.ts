import { Global, Module } from '@nestjs/common';
import { UserScopeService } from './user-scope.service.js';

/**
 * Global pelo mesmo motivo do `PrismaModule`: escopo é transversal, e
 * qualquer módulo que aceite um `userId` vindo do cliente precisa dele.
 */
@Global()
@Module({
  providers: [UserScopeService],
  exports: [UserScopeService],
})
export class ScopeModule {}
