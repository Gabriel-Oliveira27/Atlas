#!/usr/bin/env node
/**
 * Libera um e-mail duplicado entre os dois bancos.
 *
 * ── O problema ──────────────────────────────────────────────────────
 * O seed rodou separadamente no Postgres local e no Neon. O `cuid` é
 * aleatório, então a MESMA pessoa ficou com ids diferentes nos dois
 * lados — `admin@atlas.local` é `cms45pn0y...` no local e
 * `cms427z0n...` no Neon.
 *
 * A sincronização tenta criar a linha do local no Neon e bate no
 * `UNIQUE(email)`. A entrada volta para a fila, falha igual na próxima
 * execução, e tudo que depende daquele usuário cai junto por chave
 * estrangeira. Foi o que segurou 21 alterações.
 *
 * ── O que este script faz, e o que ele NÃO faz ──────────────────────
 * Ele NÃO apaga o usuário do destino. A linha do Neon tinha 1
 * `HydrationLog` que não existe no local — apagar levaria esse registro
 * junto, e dado que só existe de um lado não se recupera.
 *
 * Em vez disso, ele APOSENTA a linha perdedora: troca o e-mail por uma
 * variante marcada e desliga `isActive`. Isso libera a constraint, a
 * sincronização passa a criar a linha correta, e o que estava preso
 * continua existindo para ser inspecionado ou mesclado com calma.
 *
 * Reversível: basta devolver o e-mail original se a decisão mudar.
 *
 * A alteração é feita direto no banco, sem passar pelo outbox — de
 * propósito. Uma entrada de ChangeLog aqui propagaria a aposentadoria
 * para o outro lado, que é exatamente o oposto do que queremos.
 *
 * ── Uso ─────────────────────────────────────────────────────────────
 *   node infra/scripts/resolver-email-duplicado.mjs <email>
 *   node infra/scripts/resolver-email-duplicado.mjs <email> --apply
 *
 * Simula por padrão: é escrita em dados de produção.
 */

import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const databasePackage = join(repoRoot, 'packages', 'database');

function readEnvFile() {
  const envPath = join(repoRoot, '.env');

  if (!existsSync(envPath)) {
    console.error('✗ Arquivo .env não encontrado na raiz do projeto.');
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

function loadPrismaClient() {
  try {
    const requireFrom = createRequire(join(databasePackage, 'package.json'));
    return requireFrom('@prisma/client').PrismaClient;
  } catch (error) {
    console.error('✗ Não foi possível carregar o Prisma Client. Rode `pnpm db:generate`.');
    console.error(`  ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** Conta o que depende do usuário, para a decisão não ser às cegas. */
async function contarDependencias(prisma, userId) {
  const alvos = [
    ['workoutLog', prisma.workoutLog],
    ['hydrationLog', prisma.hydrationLog],
    ['weightLog', prisma.weightLog],
    ['assessment', prisma.assessment],
    ['workoutPlan', prisma.workoutPlan],
    ['notification', prisma.notification],
    ['gymMembership', prisma.gymMembership],
    ['aiJob', prisma.aiJob],
    ['deviceToken', prisma.deviceToken],
  ];

  const linhas = [];

  for (const [nome, delegate] of alvos) {
    if (!delegate) continue;
    try {
      const n = await delegate.count({ where: { userId } });
      if (n > 0) linhas.push(`${nome}=${n}`);
    } catch {
      // Um modelo sem `userId` não é erro — só não conta.
    }
  }

  return linhas;
}

const email = process.argv[2];
const aplicar = process.argv.includes('--apply');

if (!email || email.startsWith('--')) {
  console.error('Uso: node infra/scripts/resolver-email-duplicado.mjs <email> [--apply]');
  process.exit(1);
}

const env = readEnvFile();
const PrismaClient = loadPrismaClient();

if (!env.DATABASE_URL_LOCAL || !env.DATABASE_URL_CLOUD) {
  console.error('✗ DATABASE_URL_LOCAL e DATABASE_URL_CLOUD precisam estar no .env.');
  process.exit(1);
}

const local = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL_LOCAL } } });
const cloud = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL_CLOUD } } });

try {
  const [noLocal, noCloud] = await Promise.all([
    local.user.findUnique({ where: { email } }),
    cloud.user.findUnique({ where: { email } }),
  ]);

  console.info(`\n─── ${email} ───`);
  console.info(`LOCAL: ${noLocal ? noLocal.id : '(não existe)'}`);
  console.info(`NEON:  ${noCloud ? noCloud.id : '(não existe)'}`);

  if (!noLocal || !noCloud) {
    console.info('\n✓ Não há duplicidade: o e-mail existe em no máximo um dos bancos.');
    process.exit(0);
  }

  if (noLocal.id === noCloud.id) {
    console.info('\n✓ Mesmo id nos dois bancos — não há conflito a resolver.');
    process.exit(0);
  }

  const dependencias = await contarDependencias(cloud, noCloud.id);

  console.info('\nOs ids divergem. A linha do LOCAL é a que deve vencer:');
  console.info('é ela que a sincronização está tentando propagar.');
  console.info(
    `\nDependências da linha do Neon: ${dependencias.length ? dependencias.join(', ') : 'nenhuma'}`,
  );

  const emailAposentado = email.replace('@', `+conflito-${noCloud.id.slice(-6)}@`);

  console.info('\nAÇÃO: aposentar a linha do Neon');
  console.info(`  email    ${email}  →  ${emailAposentado}`);
  console.info('  isActive true  →  false');
  console.info('\nNada é apagado: o que depende dela continua existindo.');

  if (!aplicar) {
    console.info('\n· Simulação — nada foi gravado. Use --apply para executar.');
    process.exit(0);
  }

  await cloud.user.update({
    where: { id: noCloud.id },
    data: { email: emailAposentado, isActive: false },
  });

  console.info(`\n✓ Linha do Neon aposentada como ${emailAposentado}.`);
  console.info('A próxima sincronização já consegue criar a linha correta.');
  console.info('Para não esperar a janela: POST /api/sync/trigger, ou a tela do painel.');
} finally {
  await Promise.allSettled([local.$disconnect(), cloud.$disconnect()]);
}
