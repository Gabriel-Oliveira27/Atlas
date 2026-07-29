/**
 * Protocolo de sincronização dos dispositivos.
 *
 * O que o handoff pediu: push → pull fechando o ciclo, e conflito
 * virando registro em `SyncConflict` em vez de sumir. Somam-se aqui as
 * duas defesas que o payload de um cliente offline exige, porque é
 * exatamente onde um cliente hostil ataca.
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

const DEVICE = 'dispositivo-de-teste';

function hydrationChange(overrides: {
  entityId: string;
  userId: string;
  version?: number;
  amountMl?: number;
  operation?: 'CREATE' | 'UPDATE' | 'DELETE';
}) {
  const now = new Date().toISOString();

  return {
    entity: 'HydrationLog' as const,
    entityId: overrides.entityId,
    operation: overrides.operation ?? ('CREATE' as const),
    version: overrides.version ?? 1,
    payload: {
      userId: overrides.userId,
      amountMl: overrides.amountMl ?? 500,
      drinkType: 'WATER',
      consumedAt: now,
      dayKey: now.slice(0, 10),
    },
    occurredAt: now,
    originNode: 'dispositivo-de-teste',
  };
}

describe('push → pull', () => {
  it('o que sobe no push volta no pull', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const entityId = 'log-offline-0001';

    const push = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [hydrationChange({ entityId, userId: aluno.id })],
      },
    });

    expect(push.status).toBe(200);
    expect((push.body.data as { accepted: number }).accepted).toBe(1);

    const pull = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: aluno.accessToken,
      payload: { deviceId: DEVICE, lastPulledAt: null, entities: ['HydrationLog'] },
    });

    expect(pull.status).toBe(200);
    const changes = (pull.body.data as { changes: Array<{ entityId: string }> }).changes;
    expect(changes.map((change) => change.entityId)).toContain(entityId);
  });

  it('o cursor torna o pull incremental', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [hydrationChange({ entityId: 'log-antigo', userId: aluno.id })],
      },
    });

    const primeiro = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: aluno.accessToken,
      payload: { deviceId: DEVICE, lastPulledAt: null, entities: ['HydrationLog'] },
    });

    const cursor = (primeiro.body.data as { syncedAt: string }).syncedAt;

    const segundo = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: aluno.accessToken,
      payload: { deviceId: DEVICE, lastPulledAt: cursor, entities: ['HydrationLog'] },
    });

    // Nada mudou depois do cursor: o app não rebaixa a base inteira.
    expect((segundo.body.data as { changes: unknown[] }).changes).toHaveLength(0);
  });

  it('o pull entrega apenas os registros do próprio usuário', async () => {
    const academia = await createGym(context.prisma);
    const aluno = await createUserAndLogin(app, context.prisma, { gymId: academia });
    const colega = await createUser(context.prisma, { gymId: academia });

    await context.prisma.db.hydrationLog.create({
      data: {
        id: 'log-do-colega',
        userId: colega.id,
        amountMl: 300,
        consumedAt: new Date(),
        dayKey: new Date().toISOString().slice(0, 10),
      },
    });

    const pull = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: aluno.accessToken,
      payload: { deviceId: DEVICE, lastPulledAt: null, entities: ['HydrationLog'] },
    });

    const ids = (pull.body.data as { changes: Array<{ entityId: string }> }).changes.map(
      (change) => change.entityId,
    );

    expect(ids).not.toContain('log-do-colega');
  });
});

describe('conflito', () => {
  /**
   * Os testes de conflito usam `DailyActivity`, não `HydrationLog`.
   *
   * A hidratação é append-only (`MERGE_UNION`): dois dispositivos
   * registrando copos d'água não estão em desacordo, cada registro é um
   * fato novo — e por isso ela nunca gera conflito. `DailyActivity` é
   * `LAST_WRITE_WINS`: é um resumo do dia, e dois resumos diferentes do
   * MESMO dia são, aí sim, uma divergência real.
   */
  function activityChange(overrides: {
    entityId: string;
    userId: string;
    version?: number;
    activeMinutes?: number;
    operation?: 'CREATE' | 'UPDATE' | 'DELETE';
  }) {
    const now = new Date().toISOString();

    return {
      entity: 'DailyActivity' as const,
      entityId: overrides.entityId,
      operation: overrides.operation ?? ('CREATE' as const),
      version: overrides.version ?? 1,
      payload: {
        userId: overrides.userId,
        dayKey: now.slice(0, 10),
        hydrationGoalMl: 2450,
        activeMinutes: overrides.activeMinutes ?? 30,
      },
      occurredAt: now,
      originNode: 'dispositivo-de-teste',
    };
  }

  it('mesma versão vira registro em SyncConflict, com os dois lados', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const entityId = 'atividade-em-conflito';

    await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [activityChange({ entityId, userId: aluno.id, version: 1, activeMinutes: 30 })],
      },
    });

    // Outro dispositivo mandando a MESMA versão com valor diferente.
    const segundo = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: 'outro-dispositivo',
        lastPulledAt: null,
        changes: [
          activityChange({
            entityId,
            userId: aluno.id,
            version: 1,
            activeMinutes: 75,
            operation: 'UPDATE',
          }),
        ],
      },
    });

    expect(segundo.status).toBe(200);
    expect((segundo.body.data as { conflicts: unknown[] }).conflicts).toHaveLength(1);

    const registrados = await context.prisma.db.syncConflict.findMany({
      where: { entity: 'DailyActivity', entityId },
    });

    // O ponto do teste: o dado divergente ficou guardado, não sumiu.
    expect(registrados).toHaveLength(1);
    expect(registrados[0]?.localVersion).toBe(1);
    expect(registrados[0]?.resolved).toBe(false);
    expect(registrados[0]?.localPayload).toMatchObject({ activeMinutes: 75 });
    expect(registrados[0]?.cloudPayload).toMatchObject({ activeMinutes: 30 });
  });

  it('versão maior sobrescreve sem gerar conflito', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const entityId = 'atividade-atualizada';

    await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [activityChange({ entityId, userId: aluno.id, version: 1, activeMinutes: 30 })],
      },
    });

    const segundo = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [
          activityChange({
            entityId,
            userId: aluno.id,
            version: 2,
            activeMinutes: 90,
            operation: 'UPDATE',
          }),
        ],
      },
    });

    expect((segundo.body.data as { conflicts: unknown[] }).conflicts).toHaveLength(0);

    const salvo = await context.prisma.db.dailyActivity.findUniqueOrThrow({
      where: { id: entityId },
    });
    expect(salvo.activeMinutes).toBe(90);
  });

  it('hidratação é append-only: reenvio não sobrescreve nem gera conflito', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);
    const entityId = 'copo-reenviado';

    await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [hydrationChange({ entityId, userId: aluno.id, version: 1, amountMl: 500 })],
      },
    });

    const reenvio = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [
          hydrationChange({
            entityId,
            userId: aluno.id,
            version: 2,
            amountMl: 900,
            operation: 'UPDATE',
          }),
        ],
      },
    });

    expect((reenvio.body.data as { conflicts: unknown[] }).conflicts).toHaveLength(0);

    // O registro original permanece: é um fato do passado, não um
    // estado que se atualiza.
    const salvo = await context.prisma.db.hydrationLog.findUniqueOrThrow({
      where: { id: entityId },
    });
    expect(salvo.amountMl).toBe(500);
  });
});

describe('payload hostil', () => {
  it('rejeita alteração cujo payload aponta para outro usuário', async () => {
    const academia = await createGym(context.prisma);
    const atacante = await createUserAndLogin(app, context.prisma, { gymId: academia });
    const vitima = await createUser(context.prisma, { gymId: academia });

    const push = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: atacante.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [hydrationChange({ entityId: 'invasao-1', userId: vitima.id })],
      },
    });

    expect((push.body.data as { accepted: number }).accepted).toBe(0);
    expect((push.body.data as { rejected: unknown[] }).rejected).toHaveLength(1);
  });

  it('rejeita sobrescrever registro EXISTENTE de outro usuário', async () => {
    const academia = await createGym(context.prisma);
    const atacante = await createUserAndLogin(app, context.prisma, { gymId: academia });
    const vitima = await createUser(context.prisma, { gymId: academia });

    const registroDaVitima = await context.prisma.db.hydrationLog.create({
      data: {
        id: 'registro-da-vitima',
        userId: vitima.id,
        amountMl: 250,
        consumedAt: new Date(),
        dayKey: new Date().toISOString().slice(0, 10),
      },
    });

    // O truque: `entityId` aponta para o registro da vítima, mas o
    // payload declara o atacante como dono. A primeira checagem passa —
    // é a checagem contra o registro já gravado que precisa barrar.
    const push = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: atacante.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [
          hydrationChange({
            entityId: registroDaVitima.id,
            userId: atacante.id,
            version: 99,
            amountMl: 9999,
            operation: 'UPDATE',
          }),
        ],
      },
    });

    expect((push.body.data as { rejected: Array<{ code: string }> }).rejected[0]?.code).toBe(
      'FORBIDDEN',
    );

    const intacto = await context.prisma.db.hydrationLog.findUniqueOrThrow({
      where: { id: registroDaVitima.id },
    });
    expect(intacto.userId).toBe(vitima.id);
    expect(intacto.amountMl).toBe(250);
  });

  it('rejeita entidade fora da allowlist na validação de entrada', async () => {
    const aluno = await createUserAndLogin(app, context.prisma);

    const push = await request(app, {
      method: 'POST',
      url: '/sync/push',
      token: aluno.accessToken,
      payload: {
        deviceId: DEVICE,
        lastPulledAt: null,
        changes: [
          {
            entity: 'Role',
            entityId: 'qualquer',
            operation: 'UPDATE',
            version: 1,
            payload: { name: 'SUPER_ADMIN' },
            occurredAt: new Date().toISOString(),
            originNode: 'dispositivo',
          },
        ],
      },
    });

    expect(push.status).toBe(422);
    expect(push.body.error?.code).toBe('VALIDATION_ERROR');
  });
});

describe('permissões das rotas de sync', () => {
  it('push e pull são do próprio usuário — qualquer papel usa', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.USER });

    const pull = await request(app, {
      method: 'POST',
      url: '/sync/pull',
      token: aluno.accessToken,
      payload: { deviceId: DEVICE, lastPulledAt: null },
    });

    expect(pull.status).toBe(200);
  });

  it('trigger exige permissão de operação', async () => {
    const aluno = await createUserAndLogin(app, context.prisma, { role: ROLES.USER });

    const response = await request(app, {
      method: 'POST',
      url: '/sync/trigger',
      token: aluno.accessToken,
      payload: { direction: 'BIDIRECTIONAL' },
    });

    expect(response.status).toBe(403);
  });
});
