/**
 * Permissões granulares do Atlas.
 *
 * O RBAC trabalha em dois níveis: o papel (`Role`) define o alcance
 * geral e a permissão define a ação exata. Guards da API checam
 * permissão; a UI usa as mesmas constantes para esconder ações.
 *
 * Convenção: `recurso:ação`, com `:any` quando a ação atravessa o
 * escopo do próprio usuário/academia.
 */

import { ROLES, type Role } from './roles.js';

export const PERMISSIONS = {
  // Perfil próprio
  PROFILE_READ: 'profile:read',
  PROFILE_UPDATE: 'profile:update',

  // Treinos
  WORKOUT_READ: 'workout:read',
  WORKOUT_LOG: 'workout:log',
  WORKOUT_CREATE: 'workout:create',
  WORKOUT_ASSIGN: 'workout:assign',

  // Hidratação
  HYDRATION_READ: 'hydration:read',
  HYDRATION_LOG: 'hydration:log',

  // Avaliações
  ASSESSMENT_READ: 'assessment:read',
  ASSESSMENT_CREATE: 'assessment:create',
  ASSESSMENT_READ_ANY: 'assessment:read:any',

  // Exercícios (catálogo global)
  EXERCISE_READ: 'exercise:read',
  EXERCISE_MANAGE: 'exercise:manage',

  // Usuários
  USER_READ_ANY: 'user:read:any',
  USER_MANAGE: 'user:manage',

  // Academias
  GYM_READ: 'gym:read',
  GYM_MANAGE: 'gym:manage',
  GYM_MANAGE_ANY: 'gym:manage:any',
  GYM_BLOCK: 'gym:block',

  // Plataforma
  LOG_READ: 'log:read',
  SYNC_READ: 'sync:read',
  SYNC_TRIGGER: 'sync:trigger',
  WORKFLOW_MANAGE: 'workflow:manage',
  AI_REQUEST: 'ai:request',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS: Permission[] = Object.values(PERMISSIONS);

/** Permissões concedidas a cada papel. Fonte da verdade do seed do banco. */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [ROLES.USER]: [
    PERMISSIONS.PROFILE_READ,
    PERMISSIONS.PROFILE_UPDATE,
    PERMISSIONS.WORKOUT_READ,
    PERMISSIONS.WORKOUT_LOG,
    PERMISSIONS.HYDRATION_READ,
    PERMISSIONS.HYDRATION_LOG,
    PERMISSIONS.ASSESSMENT_READ,
    PERMISSIONS.EXERCISE_READ,
    PERMISSIONS.GYM_READ,
  ],

  [ROLES.PROFESSOR]: [
    PERMISSIONS.PROFILE_READ,
    PERMISSIONS.PROFILE_UPDATE,
    PERMISSIONS.WORKOUT_READ,
    PERMISSIONS.WORKOUT_LOG,
    PERMISSIONS.WORKOUT_CREATE,
    PERMISSIONS.WORKOUT_ASSIGN,
    PERMISSIONS.HYDRATION_READ,
    PERMISSIONS.HYDRATION_LOG,
    PERMISSIONS.ASSESSMENT_READ,
    PERMISSIONS.ASSESSMENT_CREATE,
    PERMISSIONS.ASSESSMENT_READ_ANY,
    PERMISSIONS.EXERCISE_READ,
    PERMISSIONS.USER_READ_ANY,
    PERMISSIONS.GYM_READ,
  ],

  [ROLES.GYM_ADMIN]: [
    PERMISSIONS.PROFILE_READ,
    PERMISSIONS.PROFILE_UPDATE,
    PERMISSIONS.WORKOUT_READ,
    PERMISSIONS.WORKOUT_LOG,
    PERMISSIONS.WORKOUT_CREATE,
    PERMISSIONS.WORKOUT_ASSIGN,
    PERMISSIONS.HYDRATION_READ,
    PERMISSIONS.HYDRATION_LOG,
    PERMISSIONS.ASSESSMENT_READ,
    PERMISSIONS.ASSESSMENT_CREATE,
    PERMISSIONS.ASSESSMENT_READ_ANY,
    PERMISSIONS.EXERCISE_READ,
    PERMISSIONS.USER_READ_ANY,
    PERMISSIONS.USER_MANAGE,
    PERMISSIONS.GYM_READ,
    PERMISSIONS.GYM_MANAGE,
    PERMISSIONS.AI_REQUEST,
  ],

  // O administrador geral recebe tudo.
  [ROLES.SUPER_ADMIN]: ALL_PERMISSIONS,
};
