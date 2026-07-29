/**
 * Infraestrutura dos testes de ponta a ponta da API.
 *
 * Sobe o `AppModule` REAL contra o Postgres de testes e responde às
 * requisições via `app.inject()` (o injetor do Fastify — sem socket,
 * sem porta, sem flakiness de rede). Guards globais, interceptors,
 * filtro de exceções e envelope passam todos pelo caminho de verdade:
 * é o único jeito de um teste de RBAC provar alguma coisa.
 *
 * Nada aqui é mock. Um teste de vazamento de dados entre academias
 * contra um Prisma falso provaria apenas que o falso foi bem escrito.
 */

import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { generateActivationCode, hashPassword } from '@atlas/auth';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, ROLES, type Role } from '@atlas/shared';
import { AppModule } from '../src/app.module.js';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter.js';
import { HttpMetricsInterceptor } from '../src/common/interceptors/http-metrics.interceptor.js';
import { ResponseInterceptor } from '../src/common/interceptors/response.interceptor.js';
import { PrismaService } from '../src/infra/prisma/prisma.service.js';
import { RedisService } from '../src/infra/redis/redis.service.js';

export const API_PREFIX = 'api';

export interface TestContext {
  app: NestFastifyApplication;
  prisma: PrismaService;
  redis: RedisService;
}

/**
 * Sobe a aplicação com a MESMA configuração global do `main.ts`.
 *
 * Duplicar essas linhas é ruim, e é deliberado: se o `main.ts` mudar e
 * este arquivo não, algum teste de envelope ou de erro quebra — que é
 * exatamente o alarme que se quer.
 */
export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({
      genReqId: (req: { headers: Record<string, string | string[] | undefined> }) => {
        const incoming = req.headers['x-request-id'];
        const requestId =
          (Array.isArray(incoming) ? incoming[0] : incoming)?.slice(0, 128) || randomUUID();
        req.headers['x-request-id'] = requestId;
        return requestId;
      },
    }),
    { logger: false },
  );

  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalInterceptors(new HttpMetricsInterceptor(), new ResponseInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, prisma: app.get(PrismaService), redis: app.get(RedisService) };
}

/**
 * Zera os contadores de rate limit deste processo de teste.
 *
 * Sem isto, o limite de autenticação (10/min) estoura no meio da suíte
 * e todo teste seguinte falha com 429 — um resultado que diz respeito
 * ao teste anterior, não ao que está sendo verificado.
 *
 * Usa uma conexão CRUA, sem `keyPrefix`. Com o prefixo ligado, o
 * ioredis aplica (ou não, dependendo do comando) o prefixo no padrão do
 * `KEYS` e de novo nos argumentos do `DEL` — e o resultado é apagar
 * nada, em silêncio. Aqui os nomes completos são montados à mão e não
 * há ambiguidade.
 */
export async function resetRateLimit(redis: RedisService): Promise<void> {
  const prefix = redis.client.options.keyPrefix ?? '';
  const raw = new Redis(redis.connectionOptions);

  try {
    const keys = await raw.keys(`${prefix}throttle:*`);
    if (keys.length > 0) await raw.del(...keys);
  } finally {
    raw.disconnect();
  }
}

/**
 * Zera os dados entre testes preservando o schema.
 *
 * `TRUNCATE ... CASCADE` em vez de `deleteMany` por tabela: é uma
 * ordem só, não depende de acertar a ordem das chaves estrangeiras e
 * não quebra quando o schema ganha uma tabela nova.
 */
export async function resetDatabase(prisma: PrismaService): Promise<void> {
  const tables = await prisma.db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);

  await seedRolesAndPermissions(prisma);
}

/**
 * Papéis e permissões — a base mínima de qualquer teste.
 *
 * Sem isto, criar um usuário falha por chave estrangeira e todo teste
 * de RBAC morre antes de testar RBAC.
 */
export async function seedRolesAndPermissions(prisma: PrismaService): Promise<void> {
  const db = prisma.db;

  await db.permission.createMany({
    data: ALL_PERMISSIONS.map((code) => ({ code })),
    skipDuplicates: true,
  });

  const permissions = await db.permission.findMany({ select: { id: true, code: true } });
  const permissionIdByCode = new Map(permissions.map((row) => [row.code, row.id]));

  for (const roleName of Object.values(ROLES)) {
    const role = await db.role.upsert({
      where: { name: roleName },
      update: {},
      create: { name: roleName },
    });

    await db.rolePermission.createMany({
      data: ROLE_PERMISSIONS[roleName]
        .map((code) => permissionIdByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((permissionId) => ({ roleId: role.id, permissionId })),
      skipDuplicates: true,
    });
  }
}

export interface CreatedUser {
  id: string;
  email: string;
  password: string;
  role: Role;
  gymId: string | null;
  /** Presente apenas quando a conta foi criada aguardando ativação. */
  activationCode?: string;
}

let sequence = 0;

/**
 * Hashes reaproveitados entre testes.
 *
 * O bcrypt custo 12 leva ~250 ms por chamada — de propósito, é o que o
 * torna caro de atacar. Como quase todo usuário de teste usa a mesma
 * senha, hashear uma vez por senha distinta corta minutos da suíte sem
 * enfraquecer nada: o hash é real e a verificação no login continua
 * sendo a de produção.
 */
const hashCache = new Map<string, Promise<string>>();

function cachedHash(password: string): Promise<string> {
  const existing = hashCache.get(password);
  if (existing) return existing;

  const created = hashPassword(password);
  hashCache.set(password, created);
  return created;
}

/** Academia com nome/slug únicos por chamada. */
export async function createGym(prisma: PrismaService, name = 'Academia'): Promise<string> {
  sequence += 1;
  const gym = await prisma.db.gym.create({
    data: { name: `${name} ${sequence}`, slug: `academia-${sequence}-${randomUUID().slice(0, 8)}` },
  });

  return gym.id;
}

/**
 * Usuário com senha utilizável no login real.
 *
 * O hash é o de verdade (bcrypt), não um placeholder: os testes de
 * autenticação passam pelo mesmo caminho que a produção.
 */
export async function createUser(
  prisma: PrismaService,
  options: {
    role?: Role;
    gymId?: string | null;
    email?: string;
    password?: string;
    cpf?: string;
    phone?: string;
    isActive?: boolean;
    /** Cria a conta SEM senha, com código de ativação — primeiro acesso. */
    pendingActivation?: boolean;
    /** Ativação já vencida, para exercitar a expiração. */
    activationExpiresAt?: Date;
  } = {},
): Promise<CreatedUser> {
  sequence += 1;

  const role = options.role ?? ROLES.USER;
  const email = options.email ?? `usuario${sequence}-${randomUUID().slice(0, 6)}@atlas.test`;
  const password = options.password ?? 'senha-de-teste-1';

  const roleRow = await prisma.db.role.findUniqueOrThrow({ where: { name: role } });
  const activation = options.pendingActivation ? generateActivationCode() : null;

  const user = await prisma.db.user.create({
    data: {
      email,
      name: `Usuário ${sequence}`,
      roleId: roleRow.id,
      ...(activation
        ? {
            activationCodeHash: activation.hash,
            activationExpiresAt: options.activationExpiresAt ?? activation.expiresAt,
          }
        : { passwordHash: await cachedHash(password) }),
      isActive: options.isActive ?? true,
      ...(options.cpf ? { cpf: options.cpf } : {}),
      ...(options.phone ? { phone: options.phone } : {}),
      ...(options.gymId
        ? { memberships: { create: { gymId: options.gymId, isActive: true } } }
        : {}),
    },
  });

  return {
    id: user.id,
    email,
    password,
    role,
    gymId: options.gymId ?? null,
    ...(activation ? { activationCode: activation.code } : {}),
  };
}

export interface ApiEnvelope<T = unknown> {
  status: number;
  body: {
    success: boolean;
    data?: T;
    error?: { code: string; message: string; details?: Record<string, unknown> };
    meta?: { timestamp: string; requestId: string; pagination?: Record<string, unknown> };
  };
  headers: Record<string, unknown>;
}

/** Requisição HTTP contra a app, já com o envelope decodificado. */
export async function request(
  app: NestFastifyApplication,
  options: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    url: string;
    token?: string;
    payload?: unknown;
    headers?: Record<string, string>;
  },
): Promise<ApiEnvelope> {
  const response = await app.inject({
    method: options.method,
    url: `/${API_PREFIX}${options.url}`,
    ...(options.payload !== undefined ? { payload: options.payload as object } : {}),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
  });

  let body: ApiEnvelope['body'];
  try {
    body = response.body ? JSON.parse(response.body) : { success: response.statusCode < 400 };
  } catch {
    body = { success: false, error: { code: 'RESPOSTA_NAO_JSON', message: response.body } };
  }

  return { status: response.statusCode, body, headers: response.headers };
}

/** Autentica e devolve o par de tokens emitido. */
export async function login(
  app: NestFastifyApplication,
  identifier: string,
  password: string,
  deviceId?: string,
): Promise<{ accessToken: string; refreshToken: string }> {
  const response = await request(app, {
    method: 'POST',
    url: '/auth/login',
    payload: { identifier, password, ...(deviceId ? { deviceId } : {}) },
  });

  if (response.status !== 200) {
    throw new Error(`Login falhou (${response.status}): ${JSON.stringify(response.body)}`);
  }

  const data = response.body.data as { tokens: { accessToken: string; refreshToken: string } };
  return data.tokens;
}

/** Atalho: cria o usuário e já devolve o access token dele. */
export async function createUserAndLogin(
  app: NestFastifyApplication,
  prisma: PrismaService,
  options: Parameters<typeof createUser>[1] = {},
): Promise<CreatedUser & { accessToken: string; refreshToken: string }> {
  const user = await createUser(prisma, options);
  const tokens = await login(app, user.email, user.password);

  return { ...user, ...tokens };
}
