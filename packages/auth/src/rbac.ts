/**
 * Autorização baseada em papéis e permissões (RBAC).
 *
 * Dois níveis complementares:
 *  1. Papel  — alcance geral (USER, PROFESSOR, GYM_ADMIN, SUPER_ADMIN)
 *  2. Permissão — a ação exata (`workout:create`, `gym:block`…)
 *
 * Guards da API checam permissão; o papel entra em regras de escopo
 * (ex.: um GYM_ADMIN só administra a própria academia).
 */

import { ROLES, ROLE_PERMISSIONS, hasRoleAtLeast, type Permission, type Role } from '@atlas/shared';

export interface AuthorizationSubject {
  userId: string;
  role: Role;
  permissions: Permission[];
  /** Academia à qual o usuário está vinculado, quando houver. */
  gymId?: string | null;
}

/** true se o sujeito possui a permissão. */
export function hasPermission(subject: AuthorizationSubject, permission: Permission): boolean {
  return subject.permissions.includes(permission);
}

/** true se possui TODAS as permissões exigidas. */
export function hasAllPermissions(
  subject: AuthorizationSubject,
  permissions: Permission[],
): boolean {
  return permissions.every((permission) => hasPermission(subject, permission));
}

/** true se possui ao menos UMA das permissões. */
export function hasAnyPermission(
  subject: AuthorizationSubject,
  permissions: Permission[],
): boolean {
  return permissions.some((permission) => hasPermission(subject, permission));
}

/** Permissões concedidas a um papel — usado no seed e ao emitir tokens. */
export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function isSuperAdmin(subject: AuthorizationSubject): boolean {
  return subject.role === ROLES.SUPER_ADMIN;
}

/**
 * Regra de escopo por academia.
 *
 * O SUPER_ADMIN atravessa qualquer academia. Os demais só operam
 * dentro da própria — é o que impede que o admin de uma academia
 * enxergue ou altere alunos de outra.
 */
export function canAccessGym(subject: AuthorizationSubject, gymId: string): boolean {
  if (isSuperAdmin(subject)) return true;
  return subject.gymId === gymId;
}

/**
 * Regra de escopo por usuário.
 *
 * O próprio usuário sempre acessa seus dados. Professores e admins
 * acessam os dados de alunos da MESMA academia. Fora disso, negado.
 */
export function canAccessUserData(
  subject: AuthorizationSubject,
  target: { userId: string; gymId?: string | null },
): boolean {
  if (subject.userId === target.userId) return true;
  if (isSuperAdmin(subject)) return true;

  const isStaff = hasRoleAtLeast(subject.role, ROLES.PROFESSOR);
  if (!isStaff) return false;

  // Staff sem academia definida não tem escopo sobre ninguém.
  if (!subject.gymId || !target.gymId) return false;

  return subject.gymId === target.gymId;
}

export { hasRoleAtLeast };
