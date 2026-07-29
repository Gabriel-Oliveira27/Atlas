/**
 * Contrato da API: envelope, paginação e idempotência.
 *
 * É o teste que congela o formato sobre o qual o front vai ser
 * construído. Se alguma rota parar de devolver `{ success, data, meta }`
 * ou de respeitar o teto de `pageSize`, isto quebra aqui — e não na
 * tela, semanas depois.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_PAGE_SIZE, ROLES } from '@atlas/shared';
import {
  createTestApp,
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

describe('envelope', () => {
  it('sucesso devolve { success, data, meta } com requestId', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    const response = await request(app, {
      method: 'GET',
      url: '/users/me',
      token: aluno.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toBeTruthy();
    expect(response.body.meta?.requestId).toBeTruthy();
    expect(response.body.meta?.timestamp).toBeTruthy();
  });

  it('erro devolve { success: false, error, meta } com código estável', async () => {
    const response = await request(app, { method: 'GET', url: '/users/me' });

    expect(response.status).toBe(401);
    expect(response.body.success).toBe(false);
    expect(response.body.error?.code).toBe('UNAUTHENTICATED');
    expect(response.body.meta?.requestId).toBeTruthy();
  });

  it('o requestId do envelope é o mesmo do header x-request-id', async () => {
    const response = await request(app, { method: 'GET', url: '/health' });

    expect(response.headers['x-request-id']).toBe(response.body.meta?.requestId);
  });

  it('honra o x-request-id de quem chamou', async () => {
    const enviado = 'correlacao-do-front-123';

    const response = await request(app, {
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': enviado },
    });

    expect(response.body.meta?.requestId).toBe(enviado);
    expect(response.headers['x-request-id']).toBe(enviado);
  });

  it('erro de validação lista os campos inválidos', async () => {
    const response = await request(app, {
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: '', password: '' },
    });

    expect(response.status).toBe(422);
    expect(response.body.error?.code).toBe('VALIDATION_ERROR');
    expect(response.body.error?.details?.issues).toBeInstanceOf(Array);
  });
});

describe('paginação', () => {
  /** Rotas de lista que o front vai consumir com scroll infinito. */
  const listRoutes = [
    '/workouts/plans',
    '/workouts/sessions',
    '/assessments',
    '/users/me/weight/history',
    '/hydration/history',
    '/ai/reports',
  ];

  it('toda rota de lista devolve meta.pagination', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.SUPER_ADMIN });

    for (const url of listRoutes) {
      const response = await request(app, { method: 'GET', url, token: aluno.accessToken });

      expect(response.status, `rota ${url}`).toBe(200);
      expect(Array.isArray(response.body.data), `rota ${url}`).toBe(true);
      expect(response.body.meta?.pagination, `rota ${url}`).toMatchObject({
        page: 1,
        pageSize: expect.any(Number),
        total: expect.any(Number),
        totalPages: expect.any(Number),
        hasNext: expect.any(Boolean),
        hasPrevious: expect.any(Boolean),
      });
    }
  });

  it('recusa pageSize acima do teto em vez de aceitar e derrubar a API', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.SUPER_ADMIN });

    for (const url of listRoutes) {
      const response = await request(app, {
        method: 'GET',
        url: `${url}?pageSize=100000`,
        token: aluno.accessToken,
      });

      expect(response.status, `rota ${url}`).toBe(422);
    }
  });

  it('aceita exatamente o teto', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    const response = await request(app, {
      method: 'GET',
      url: `/workouts/sessions?pageSize=${MAX_PAGE_SIZE}`,
      token: aluno.accessToken,
    });

    expect(response.status).toBe(200);
    expect(response.body.meta?.pagination).toMatchObject({ pageSize: MAX_PAGE_SIZE });
  });

  it('pagina de verdade: página 2 traz o restante', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    for (let index = 0; index < 5; index += 1) {
      await context.prisma.db.workoutLog.create({
        data: {
          userId: aluno.id,
          startedAt: new Date(Date.now() - index * 86_400_000),
          status: 'COMPLETED',
        },
      });
    }

    const primeira = await request(app, {
      method: 'GET',
      url: '/workouts/sessions?page=1&pageSize=2',
      token: aluno.accessToken,
    });
    const segunda = await request(app, {
      method: 'GET',
      url: '/workouts/sessions?page=2&pageSize=2',
      token: aluno.accessToken,
    });

    expect((primeira.body.data as unknown[]).length).toBe(2);
    expect((segunda.body.data as unknown[]).length).toBe(2);
    expect(primeira.body.meta?.pagination).toMatchObject({
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrevious: false,
    });
    expect(segunda.body.meta?.pagination).toMatchObject({ hasNext: true, hasPrevious: true });

    const idsPrimeira = (primeira.body.data as Array<{ id: string }>).map((row) => row.id);
    const idsSegunda = (segunda.body.data as Array<{ id: string }>).map((row) => row.id);
    expect(idsPrimeira.some((id) => idsSegunda.includes(id))).toBe(false);
  });
});

describe('idempotência das escritas', () => {
  it('hidratação: o mesmo clientGeneratedId não duplica', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const payload = { amountMl: 500, clientGeneratedId: 'copo-offline-1' };

    const primeira = await request(app, {
      method: 'POST',
      url: '/hydration/logs',
      token: aluno.accessToken,
      payload,
    });
    const repetida = await request(app, {
      method: 'POST',
      url: '/hydration/logs',
      token: aluno.accessToken,
      payload,
    });

    expect((primeira.body.data as { id: string }).id).toBe(
      (repetida.body.data as { id: string }).id,
    );

    const total = await context.prisma.db.hydrationLog.count({ where: { userId: aluno.id } });
    expect(total).toBe(1);
  });

  it('sessão de treino: o mesmo clientGeneratedId não abre duas', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const payload = { clientGeneratedId: 'sessao-offline-1' };

    const primeira = await request(app, {
      method: 'POST',
      url: '/workouts/sessions',
      token: aluno.accessToken,
      payload,
    });
    const repetida = await request(app, {
      method: 'POST',
      url: '/workouts/sessions',
      token: aluno.accessToken,
      payload,
    });

    expect(primeira.status).toBe(201);
    expect((primeira.body.data as { id: string }).id).toBe(
      (repetida.body.data as { id: string }).id,
    );
  });

  it('série: o retry da fila offline não vira série extra', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    const grupo = await context.prisma.db.muscleGroup.create({
      data: { name: 'Pernas', slug: `pernas-${Date.now()}` },
    });
    const exercicio = await context.prisma.db.exercise.create({
      data: {
        name: 'Agachamento',
        slug: `agachamento-${Date.now()}`,
        execution: 'Passo a passo',
        muscleGroupId: grupo.id,
      },
    });

    const sessao = await request(app, {
      method: 'POST',
      url: '/workouts/sessions',
      token: aluno.accessToken,
      payload: {},
    });
    const sessaoId = (sessao.body.data as { id: string }).id;

    const payload = {
      exerciseId: exercicio.id,
      setNumber: 1,
      reps: 10,
      weightKg: 80,
      clientGeneratedId: 'serie-offline-1',
    };

    const primeira = await request(app, {
      method: 'POST',
      url: `/workouts/sessions/${sessaoId}/sets`,
      token: aluno.accessToken,
      payload,
    });
    const repetida = await request(app, {
      method: 'POST',
      url: `/workouts/sessions/${sessaoId}/sets`,
      token: aluno.accessToken,
      payload,
    });

    expect((primeira.body.data as { id: string }).id).toBe(
      (repetida.body.data as { id: string }).id,
    );

    const total = await context.prisma.db.setLog.count({ where: { workoutLogId: sessaoId } });
    expect(total).toBe(1);
  });

  it('avaliação: o reenvio devolve a mesma avaliação', async () => {
    const professor = await createUserAndLogin(app, context.prisma, { role: ROLES.PROFESSOR });
    const payload = {
      weightKg: 82,
      heightCm: 178,
      clientGeneratedId: 'avaliacao-offline-1',
    };

    const primeira = await request(app, {
      method: 'POST',
      url: '/assessments',
      token: professor.accessToken,
      payload,
    });
    const repetida = await request(app, {
      method: 'POST',
      url: '/assessments',
      token: professor.accessToken,
      payload,
    });

    expect((primeira.body.data as { id: string }).id).toBe(
      (repetida.body.data as { id: string }).id,
    );

    const total = await context.prisma.db.assessment.count({ where: { userId: professor.id } });
    expect(total).toBe(1);
  });
});
