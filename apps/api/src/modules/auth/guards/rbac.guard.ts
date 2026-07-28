/**
 * Guard de autorização (RBAC) — também global.
 *
 * Roda depois do `JwtAuthGuard`, então já existe `request.user`.
 * Rotas sem `@Roles()` nem `@RequirePermissions()` passam: o controle
 * de acesso é declarado na própria rota, ao lado do código que protege.
 */

import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { hasAllPermissions } from '@atlas/auth';
import {
  AppError,
  ERROR_CODES,
  type AuthenticatedUser,
  type Permission,
  type Role,
} from '@atlas/shared';
import { PERMISSIONS_KEY, ROLES_KEY, IS_PUBLIC_KEY } from '../../../common/decorators/index.js';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles?.length && !requiredPermissions?.length) return true;

    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    const user = request.user;

    if (!user) throw AppError.unauthenticated();

    if (requiredRoles?.length && !requiredRoles.includes(user.role)) {
      throw AppError.forbidden('Seu perfil não tem acesso a este recurso');
    }

    if (requiredPermissions?.length) {
      const subject = {
        userId: user.id,
        role: user.role,
        permissions: user.permissions,
        gymId: user.gymId,
      };

      if (!hasAllPermissions(subject, requiredPermissions)) {
        throw new AppError(
          ERROR_CODES.INSUFFICIENT_PERMISSIONS,
          'Permissão insuficiente para esta ação',
          { status: 403, details: { required: requiredPermissions } },
        );
      }
    }

    return true;
  }
}
