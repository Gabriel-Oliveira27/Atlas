#!/usr/bin/env node
/**
 * Aplica as migrations nos DOIS bancos (local e Neon).
 *
 * Os bancos precisam ter estrutura idêntica — a reconciliação compara
 * registros campo a campo, e uma coluna faltando de um lado quebraria a
 * sincronização em produção, não no deploy.
 *
 *   node infra/scripts/migrate-both.mjs
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const databasePackage = join(repoRoot, 'packages', 'database');

/** Lê o `.env` da raiz sem depender de nenhuma biblioteca. */
function readEnvFile() {
  const envPath = join(repoRoot, '.env');

  if (!existsSync(envPath)) {
    console.error('✗ Arquivo .env não encontrado na raiz do projeto.');
    console.error('  Copie o .env.example para .env e preencha os valores.');
    process.exit(1);
  }

  const env = {};

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();

    // Remove aspas que envolvem a connection string.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function migrate(label, databaseUrl, shadowUrl) {
  console.info(`\n─── ${label} ───`);

  try {
    execSync('npx prisma migrate deploy --schema prisma/schema.prisma', {
      cwd: databasePackage,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL_LOCAL: databaseUrl,
        ...(shadowUrl ? { SHADOW_DATABASE_URL: shadowUrl } : {}),
      },
    });

    console.info(`✓ ${label}: migrations aplicadas.`);
    return true;
  } catch {
    console.error(`✗ ${label}: falha ao aplicar as migrations.`);
    return false;
  }
}

const env = readEnvFile();

const localUrl = env.DATABASE_URL_LOCAL;
const cloudUrl = env.DATABASE_URL_CLOUD;

if (!localUrl) {
  console.error('✗ DATABASE_URL_LOCAL não está definido no .env.');
  process.exit(1);
}

console.info('═══ Atlas — migrations nos dois bancos ═══');

const localOk = migrate('Banco LOCAL (Docker)', localUrl, env.SHADOW_DATABASE_URL);

let cloudOk = true;

if (cloudUrl) {
  // O Neon gerencia o shadow database sozinho; passar um do local
  // faria o Prisma tentar criar tabelas no lugar errado.
  cloudOk = migrate('Banco NUVEM (Neon)', cloudUrl, undefined);
} else {
  console.warn('\n⚠ DATABASE_URL_CLOUD não configurado — apenas o banco local foi migrado.');
  console.warn('  Sem o Neon não há failover nem sincronização com a nuvem.');
}

if (!localOk || !cloudOk) {
  console.error('\n✗ Nem todos os bancos foram migrados com sucesso.');
  process.exit(1);
}

console.info('\n✓ Concluído.\n');
