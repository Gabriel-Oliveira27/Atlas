/**
 * Clientes Prisma do Atlas — banco local e banco na nuvem.
 *
 * O schema é único; o que muda é a `url` do datasource em runtime.
 * Ambos os clientes são singletons: em desenvolvimento o hot-reload
 * recriaria uma conexão a cada alteração de arquivo e esgotaria o pool
 * do Postgres, por isso guardamos a instância em `globalThis`.
 */

import { PrismaClient } from '@prisma/client';
import { DATABASE_NODE, type DatabaseNode } from '@atlas/shared';

export type { PrismaClient } from '@prisma/client';
export * from '@prisma/client';

export interface DatabaseClientOptions {
  localUrl: string;
  /** Ausente = Neon não configurado; o sistema opera somente com o local. */
  cloudUrl?: string;
  logQueries?: boolean;
}

/** Cache entre recargas do módulo (evita esgotar o pool em dev). */
const globalForPrisma = globalThis as unknown as {
  atlasLocalClient?: PrismaClient;
  atlasCloudClient?: PrismaClient | null;
};

function buildClient(url: string, logQueries: boolean): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: logQueries
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'stdout', level: 'warn' },
          { emit: 'stdout', level: 'error' },
        ]
      : [{ emit: 'stdout', level: 'error' }],
  });
}

/**
 * Cliente do banco LOCAL — secundário desde o ADR 008, e ainda assim o
 * datasource do schema: é dele que saem migrations e `prisma generate`.
 */
export function getLocalClient(options: DatabaseClientOptions): PrismaClient {
  if (!globalForPrisma.atlasLocalClient) {
    globalForPrisma.atlasLocalClient = buildClient(options.localUrl, options.logQueries ?? false);
  }
  return globalForPrisma.atlasLocalClient;
}

/**
 * Cliente do banco na NUVEM (Neon).
 * Devolve `null` quando `DATABASE_URL_CLOUD` não está configurado — nesse
 * caso o Atlas funciona apenas com o banco local, sem failover.
 */
export function getCloudClient(options: DatabaseClientOptions): PrismaClient | null {
  if (globalForPrisma.atlasCloudClient === undefined) {
    globalForPrisma.atlasCloudClient = options.cloudUrl
      ? buildClient(options.cloudUrl, options.logQueries ?? false)
      : null;
  }
  return globalForPrisma.atlasCloudClient;
}

export interface DatabaseClients {
  local: PrismaClient;
  cloud: PrismaClient | null;
}

export function createDatabaseClients(options: DatabaseClientOptions): DatabaseClients {
  return {
    local: getLocalClient(options),
    cloud: getCloudClient(options),
  };
}

/**
 * Testa se um cliente responde, com timeout.
 *
 * O timeout é essencial: sem ele, um Postgres inacessível deixaria a
 * requisição pendurada até o timeout de TCP do sistema operacional
 * (dezenas de segundos) em vez de cair para o Neon em poucos segundos.
 */
export async function pingDatabase(
  client: PrismaClient,
  timeoutMs = 3000,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const startedAt = Date.now();

  try {
    await Promise.race([
      client.$queryRaw`SELECT 1`,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Tempo esgotado ao verificar o banco')), timeoutMs),
      ),
    ]);

    return { ok: true, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Fecha as conexões — usado no shutdown gracioso da API. */
export async function disconnectAll(): Promise<void> {
  await Promise.allSettled([
    globalForPrisma.atlasLocalClient?.$disconnect(),
    globalForPrisma.atlasCloudClient?.$disconnect(),
  ]);
}

export { DATABASE_NODE, type DatabaseNode };
