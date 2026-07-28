/**
 * Papéis (RBAC) do Atlas.
 *
 * Mantidos aqui — e não só no Prisma — porque o front-end precisa
 * decidir o que renderizar sem importar nada de servidor.
 */

export const ROLES = {
  /** Aluno: registra treinos, hidratação, acompanha evolução. */
  USER: 'USER',
  /** Administrador de uma academia: gerencia alunos, treinos e professores. */
  GYM_ADMIN: 'GYM_ADMIN',
  /** Professor vinculado a uma academia: cria e acompanha treinos. */
  PROFESSOR: 'PROFESSOR',
  /** Administrador geral da plataforma. */
  SUPER_ADMIN: 'SUPER_ADMIN',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ALL_ROLES: Role[] = Object.values(ROLES);

/**
 * Hierarquia de papéis: cada papel herda as permissões dos que
 * estão abaixo dele. Usado por `hasRoleAtLeast`.
 */
export const ROLE_HIERARCHY: Record<Role, number> = {
  [ROLES.USER]: 0,
  [ROLES.PROFESSOR]: 1,
  [ROLES.GYM_ADMIN]: 2,
  [ROLES.SUPER_ADMIN]: 3,
};

export function hasRoleAtLeast(role: Role, required: Role): boolean {
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[required];
}
