/**
 * Rate limit.
 *
 * Dois pontos, e o segundo é o que motivou este arquivo:
 *
 *  1. rotas de autenticação têm limite próprio, mais apertado;
 *  2. esse limite NÃO contamina o resto da API.
 *
 * O item 2 não é hipotético: na primeira versão, declarar o throttler
 * de IA (5/hora) no módulo fez a API inteira responder 429 depois de
 * cinco requisições, porque todo throttler declarado é avaliado em toda
 * rota. Ver a nota em `config/throttle.config.ts`.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { EnvConfig } from '../src/config/env.config.js';
import {
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

/**
 * Os limites vêm da MESMA fonte que a aplicação usa.
 *
 * Repetir os números aqui faria o teste passar depois de alguém mudar o
 * limite e esquecer da rota — ele estaria verificando o número antigo
 * contra si mesmo.
 */
const LIMITS = new EnvConfig().rateLimit.families;

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

describe('limite das rotas de autenticação', () => {
  it('bloqueia com 429 depois de estourar o limite', async () => {
    const user = await createUser(context.prisma);
    const tentativas = LIMITS.auth.limit + 1;

    let ultima = 0;
    for (let index = 0; index < tentativas; index += 1) {
      const response = await request(app, {
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: user.email, password: 'senha-errada-1' },
      });
      ultima = response.status;
    }

    expect(ultima).toBe(429);
  });

  it('o 429 sai no envelope do Atlas, com RATE_LIMITED e retryAfter', async () => {
    const user = await createUser(context.prisma);

    let corpo: Record<string, unknown> | undefined;
    for (let index = 0; index <= LIMITS.auth.limit; index += 1) {
      const response = await request(app, {
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: user.email, password: 'senha-errada-1' },
      });
      if (response.status === 429) corpo = response.body as unknown as Record<string, unknown>;
    }

    expect(corpo).toBeDefined();
    expect((corpo as { success: boolean }).success).toBe(false);
    expect((corpo as { error: { code: string } }).error.code).toBe('RATE_LIMITED');
    expect(
      (corpo as { error: { details?: { retryAfterSeconds?: number } } }).error.details
        ?.retryAfterSeconds,
    ).toBeGreaterThan(0);
  });
});

describe('isolamento entre famílias de limite', () => {
  it('estourar o limite de auth não bloqueia as rotas de leitura', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    for (let index = 0; index <= LIMITS.auth.limit; index += 1) {
      await request(app, {
        method: 'POST',
        url: '/auth/login',
        payload: { identifier: aluno.email, password: 'senha-errada-1' },
      });
    }

    const leitura = await request(app, {
      method: 'GET',
      url: '/users/me',
      token: aluno.accessToken,
    });

    expect(leitura.status).toBe(200);
  });

  it('o limite de IA (5/hora) não se aplica às demais rotas', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    // Mais requisições do que o limite de IA permitiria, numa rota que
    // não é de IA. Se o throttler de IA vazasse, isto viraria 429.
    for (let index = 0; index < LIMITS.ai.limit + 3; index += 1) {
      const response = await request(app, {
        method: 'GET',
        url: '/users/me',
        token: aluno.accessToken,
      });

      expect(response.status, `requisição ${index + 1}`).toBe(200);
    }
  });

  it('o limite de sync não se aplica às demais rotas', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    for (let index = 0; index < LIMITS.sync.limit + 3; index += 1) {
      const response = await request(app, {
        method: 'GET',
        url: '/exercises',
        token: aluno.accessToken,
      });

      expect(response.status, `requisição ${index + 1}`).toBe(200);
    }
  });
});

describe('contagem por usuário', () => {
  it('o limite de sync é por usuário, não pelo IP compartilhado', async () => {
    const primeiro = await createUserAndLogin(app, context.prisma);
    const segundo = await createUserAndLogin(app, context.prisma);

    // O primeiro esgota a cota dele.
    for (let index = 0; index <= LIMITS.sync.limit; index += 1) {
      await request(app, {
        method: 'POST',
        url: '/sync/pull',
        token: primeiro.accessToken,
        payload: { deviceId: 'dispositivo-1', lastPulledAt: null },
      });
    }

    const bloqueado = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: primeiro.accessToken,
      payload: { deviceId: 'dispositivo-1', lastPulledAt: null },
    });

    // O segundo chega do MESMO IP (é sempre 127.0.0.1 aqui) e passa:
    // é a prova de que a contagem segue o usuário do token.
    const liberado = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: segundo.accessToken,
      payload: { deviceId: 'dispositivo-2', lastPulledAt: null },
    });

    expect(bloqueado.status).toBe(429);
    expect(liberado.status).toBe(200);
  });
});
