/**
 * RBAC e escopo por academia.
 *
 * É o teste que o handoff chamou de "o que impede vazamento de dados
 * entre academias". Duas perguntas diferentes, ambas cobertas aqui:
 *
 *   1. este papel pode executar esta ação?   (permissão)
 *   2. sobre QUEM ele pode executar?         (escopo)
 *
 * A segunda é a que faltava: o guard global só respondia a primeira.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ROLES } from '@atlas/shared';
import {
  createGym,
  createTestApp,
  createUser,
  createUserAndLogin,
  request,
  resetDatabase,
  resetRateLimit,
  type TestContext,
} from './harness.js';

let context: TestContext;
let app: NestFastifyApplication;

beforeAll(async () => {
  context = await createTestApp();
  app = context.app;
});

afterAll(async () => {
  await context.app.close();
});

beforeEach(async () => {
  await resetDatabase(context.prisma);
  await resetRateLimit(context.redis);
});

describe('permissão — o aluno não alcança rotas de administração', () => {
  it('GET /users devolve 403 para papel USER', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.USER });

    const response = await request(app, {
      method: 'GET',
      url: '/users',
      token: aluno.accessToken,
    });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('INSUFFICIENT_PERMISSIONS');
  });

  it('GET /sync/status devolve 403 para papel USER', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.USER });

    const response = await request(app, {
      method: 'GET',
      url: '/sync/status',
      token: aluno.accessToken,
    });

    expect(response.status).toBe(403);
  });

  it('POST /assessments devolve 403 para papel USER', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.USER });

    const response = await request(app, {
      method: 'POST',
      url: '/assessments',
      token: aluno.accessToken,
      payload: { weightKg: 80, heightCm: 180 },
    });

    expect(response.status).toBe(403);
  });

  it('o SUPER_ADMIN alcança as mesmas rotas', async () => {
    const admin = await createUserAndLogin(app, context.prisma, { role: ROLES.SUPER_ADMIN });

    const usuarios = await request(app, {
      method: 'GET',
      url: '/users',
      token: admin.accessToken,
    });
    const sync = await request(app, {
      method: 'GET',
      url: '/sync/status',
      token: admin.accessToken,
    });

    expect(usuarios.status).toBe(200);
    expect(sync.status).toBe(200);
  });
});

describe('escopo — um admin não enxerga aluno de outra academia', () => {
  it('GET /users lista só a própria academia', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const adminA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.GYM_ADMIN,
      gymId: academiaA,
    });
    const alunoA = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaA });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const response = await request(app, {
      method: 'GET',
      url: '/users',
      token: adminA.accessToken,
    });

    expect(response.status).toBe(200);
    const ids = (response.body.data as Array<{ id: string }>).map((row) => row.id);

    expect(ids).toContain(alunoA.id);
    expect(ids).not.toContain(alunoB.id);
  });

  it('GET /users/:id de aluno de outra academia devolve 403', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const adminA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.GYM_ADMIN,
      gymId: academiaA,
    });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const response = await request(app, {
      method: 'GET',
      url: `/users/${alunoB.id}`,
      token: adminA.accessToken,
    });

    expect(response.status).toBe(403);
  });

  it('o aluno da própria academia é acessível', async () => {
    const academia = await createGym(context.prisma);

    const admin = await createUserAndLogin(app, context.prisma, {
      role: ROLES.GYM_ADMIN,
      gymId: academia,
    });
    const aluno = await createUser(context.prisma, { role: ROLES.USER, gymId: academia });

    const response = await request(app, {
      method: 'GET',
      url: `/users/${aluno.id}`,
      token: admin.accessToken,
    });

    expect(response.status).toBe(200);
    expect((response.body.data as { id: string }).id).toBe(aluno.id);
  });

  it('o SUPER_ADMIN atravessa academias', async () => {
    const academiaB = await createGym(context.prisma, 'Academia B');

    const admin = await createUserAndLogin(app, context.prisma, { role: ROLES.SUPER_ADMIN });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const response = await request(app, {
      method: 'GET',
      url: `/users/${alunoB.id}`,
      token: admin.accessToken,
    });

    expect(response.status).toBe(200);
  });
});

describe('escopo em avaliações — o buraco que existia', () => {
  it('professor NÃO cria avaliação para aluno de outra academia', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const professorA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.PROFESSOR,
      gymId: academiaA,
    });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const response = await request(app, {
      method: 'POST',
      url: '/assessments',
      token: professorA.accessToken,
      payload: { userId: alunoB.id, weightKg: 80, heightCm: 180 },
    });

    expect(response.status).toBe(403);

    // E nada foi gravado: o 403 tem que vir ANTES da escrita.
    const total = await context.prisma.db.assessment.count({ where: { userId: alunoB.id } });
    expect(total).toBe(0);
  });

  it('professor cria avaliação para aluno da própria academia', async () => {
    const academia = await createGym(context.prisma);

    const professor = await createUserAndLogin(app, context.prisma, {
      role: ROLES.PROFESSOR,
      gymId: academia,
    });
    const aluno = await createUser(context.prisma, { role: ROLES.USER, gymId: academia });

    const response = await request(app, {
      method: 'POST',
      url: '/assessments',
      token: professor.accessToken,
      payload: { userId: aluno.id, weightKg: 80, heightCm: 180 },
    });

    expect(response.status).toBe(201);

    const gravada = await context.prisma.db.assessment.findFirstOrThrow({
      where: { userId: aluno.id },
    });
    // O autor é o professor, não o avaliado — e vem do token, não do corpo.
    expect(gravada.assessedById).toBe(professor.id);
  });

  it('professor NÃO lê avaliação de aluno de outra academia', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const professorA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.PROFESSOR,
      gymId: academiaA,
    });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const avaliacao = await context.prisma.db.assessment.create({
      data: { userId: alunoB.id, assessedAt: new Date(), weightKg: 70, heightCm: 170, bmi: 24.2 },
    });

    const porId = await request(app, {
      method: 'GET',
      url: `/assessments/${avaliacao.id}`,
      token: professorA.accessToken,
    });

    const porLista = await request(app, {
      method: 'GET',
      url: `/assessments?userId=${alunoB.id}`,
      token: professorA.accessToken,
    });

    expect(porId.status).toBe(403);
    expect(porLista.status).toBe(403);
  });
});

describe('escopo em treinos', () => {
  it('professor NÃO lista sessões de aluno de outra academia', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const professorA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.PROFESSOR,
      gymId: academiaA,
    });
    const alunoB = await createUser(context.prisma, { role: ROLES.USER, gymId: academiaB });

    const response = await request(app, {
      method: 'GET',
      url: `/workouts/sessions?userId=${alunoB.id}`,
      token: professorA.accessToken,
    });

    expect(response.status).toBe(403);
  });

  it('o aluno só vê as próprias sessões, mesmo pedindo as de outro', async () => {
    const academia = await createGym(context.prisma);

    const aluno = await createUserAndLogin(app, context.prisma, {
      role: ROLES.USER,
      gymId: academia,
    });
    const colega = await createUser(context.prisma, { role: ROLES.USER, gymId: academia });

    await context.prisma.db.workoutLog.create({
      data: { userId: colega.id, startedAt: new Date(), status: 'COMPLETED' },
    });

    const response = await request(app, {
      method: 'GET',
      url: `/workouts/sessions?userId=${colega.id}`,
      token: aluno.accessToken,
    });

    // Aluno não é staff: o escopo nega mesmo dentro da mesma academia.
    expect(response.status).toBe(403);
  });
});

describe('escopo no catálogo de exercícios', () => {
  it('exercício exclusivo de outra academia não é legível nem pelo id', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');
    const academiaB = await createGym(context.prisma, 'Academia B');

    const grupo = await context.prisma.db.muscleGroup.create({
      data: { name: 'Peito', slug: `peito-${Date.now()}` },
    });

    const exclusivoB = await context.prisma.db.exercise.create({
      data: {
        name: 'Exercício da Academia B',
        slug: `exclusivo-b-${Date.now()}`,
        execution: 'Passo a passo',
        muscleGroupId: grupo.id,
        gymId: academiaB,
      },
    });

    const alunoA = await createUserAndLogin(app, context.prisma, {
      role: ROLES.USER,
      gymId: academiaA,
    });

    const response = await request(app, {
      method: 'GET',
      url: `/exercises/${exclusivoB.id}`,
      token: alunoA.accessToken,
    });

    expect(response.status).toBe(404);
  });

  it('o catálogo global segue visível para todos', async () => {
    const academiaA = await createGym(context.prisma, 'Academia A');

    const grupo = await context.prisma.db.muscleGroup.create({
      data: { name: 'Costas', slug: `costas-${Date.now()}` },
    });

    const global = await context.prisma.db.exercise.create({
      data: {
        name: 'Remada',
        slug: `remada-${Date.now()}`,
        execution: 'Passo a passo',
        muscleGroupId: grupo.id,
      },
    });

    const aluno = await createUserAndLogin(app, context.prisma, {
      role: ROLES.USER,
      gymId: academiaA,
    });

    const response = await request(app, {
      method: 'GET',
      url: `/exercises/${global.id}`,
      token: aluno.accessToken,
    });

    expect(response.status).toBe(200);
  });
});
