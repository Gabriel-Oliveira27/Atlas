/**
 * Decorators compartilhados da API.
 */

import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser, Permission, Role } from '@atlas/shared';

export const IS_PUBLIC_KEY = 'atlas:is-public';
export const ROLES_KEY = 'atlas:roles';
export const PERMISSIONS_KEY = 'atlas:permissions';
export const THROTTLE_FAMILY_KEY = 'atlas:throttle-family';

/**
 * Marca a rota como pública.
 *
 * O `JwtAuthGuard` é global — o padrão é exigir autenticação. Abrir uma
 * rota é a exceção e precisa ser explícito, para que ninguém exponha um
 * endpoint por esquecer de adicionar o guard.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

/** Exige que o usuário tenha um dos papéis informados. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator =>
  SetMetadata(ROLES_KEY, roles);

/** Exige TODAS as permissões informadas. */
export const RequirePermissions = (
  ...permissions: Permission[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Coloca a rota sob um limite de requisição específico.
 *
 * Sem isto a rota fica no limite padrão (leituras em geral). Ver
 * `config/throttle.config.ts` — inclusive a nota sobre por que NÃO
 * basta declarar o throttler no módulo.
 */
export const ThrottleFamily = (family: 'auth' | 'sync' | 'ai'): MethodDecorator & ClassDecorator =>
  SetMetadata(THROTTLE_FAMILY_KEY, family);

/** Injeta o usuário autenticado: `@CurrentUser() user: AuthenticatedUser`. */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthenticatedUser | undefined, context: ExecutionContext) => {
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) return undefined;
    return data ? user[data] : user;
  },
);

/** Injeta o identificador de dispositivo enviado no header. */
export const DeviceId = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<FastifyRequest>();
  return request.headers['x-atlas-device-id'] as string | undefined;
});
