import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLES } from '@atlas/shared';
import { canAccessGym, canAccessUserData, hasPermission, permissionsForRole } from './rbac.js';

const aluno = {
  userId: 'user-1',
  role: ROLES.USER,
  permissions: permissionsForRole(ROLES.USER),
  gymId: 'gym-1',
};

const professor = {
  userId: 'prof-1',
  role: ROLES.PROFESSOR,
  permissions: permissionsForRole(ROLES.PROFESSOR),
  gymId: 'gym-1',
};

const superAdmin = {
  userId: 'admin-1',
  role: ROLES.SUPER_ADMIN,
  permissions: permissionsForRole(ROLES.SUPER_ADMIN),
  gymId: null,
};

describe('permissões por papel', () => {
  it('o aluno pode registrar treino, mas não criar', () => {
    expect(hasPermission(aluno, PERMISSIONS.WORKOUT_LOG)).toBe(true);
    expect(hasPermission(aluno, PERMISSIONS.WORKOUT_CREATE)).toBe(false);
  });

  it('o professor pode criar e atribuir treinos', () => {
    expect(hasPermission(professor, PERMISSIONS.WORKOUT_CREATE)).toBe(true);
    expect(hasPermission(professor, PERMISSIONS.WORKOUT_ASSIGN)).toBe(true);
  });

  it('só o administrador geral bloqueia academias', () => {
    expect(hasPermission(aluno, PERMISSIONS.GYM_BLOCK)).toBe(false);
    expect(hasPermission(professor, PERMISSIONS.GYM_BLOCK)).toBe(false);
    expect(hasPermission(superAdmin, PERMISSIONS.GYM_BLOCK)).toBe(true);
  });
});

describe('canAccessGym', () => {
  it('permite acesso à própria academia', () => {
    expect(canAccessGym(professor, 'gym-1')).toBe(true);
  });

  it('bloqueia academia de terceiros', () => {
    expect(canAccessGym(professor, 'gym-2')).toBe(false);
  });

  it('o administrador geral atravessa qualquer academia', () => {
    expect(canAccessGym(superAdmin, 'gym-9')).toBe(true);
  });
});

describe('canAccessUserData', () => {
  it('o usuário sempre acessa os próprios dados', () => {
    expect(canAccessUserData(aluno, { userId: 'user-1', gymId: 'gym-1' })).toBe(true);
  });

  it('um aluno não acessa dados de outro aluno', () => {
    expect(canAccessUserData(aluno, { userId: 'user-2', gymId: 'gym-1' })).toBe(false);
  });

  it('o professor acessa alunos da mesma academia', () => {
    expect(canAccessUserData(professor, { userId: 'user-1', gymId: 'gym-1' })).toBe(true);
  });

  it('o professor NÃO acessa alunos de outra academia', () => {
    expect(canAccessUserData(professor, { userId: 'user-9', gymId: 'gym-2' })).toBe(false);
  });

  it('staff sem academia definida não tem escopo sobre ninguém', () => {
    const semAcademia = { ...professor, gymId: null };
    expect(canAccessUserData(semAcademia, { userId: 'user-1', gymId: 'gym-1' })).toBe(false);
  });

  it('o administrador geral acessa qualquer usuário', () => {
    expect(canAccessUserData(superAdmin, { userId: 'user-9', gymId: 'gym-9' })).toBe(true);
  });
});
