#!/usr/bin/env node
/**
 * Conserta entradas do outbox que apontam para o banco onde já estão.
 *
 * ── O que aconteceu ─────────────────────────────────────────────────
 * Até o ADR 008 o Postgres local era o principal, toda escrita nascia
 * nele, e os serviços gravavam `targetNode: CLOUD` fixo — o que estava
 * certo naquele mundo.
 *
 * Com o Neon como principal a escrita passou a cair no Neon, mas o
 * carimbo continuou dizendo CLOUD. Ou seja: a entrada mandava propagar
 * para o banco em que ela mesma estava. O `applyPending` filtra por
 * `targetNode`, então nada casava — nenhuma linha era aplicada, nenhum
 * erro aparecia, e a fila só crescia.
 *
 * O código já foi corrigido (`PrismaService.replicationTarget`). Este
 * script existe para o que ficou gravado errado no intervalo: essas
 * entradas continuam PENDING apontando para o lugar errado e não saem
 * de lá sozinhas.
 *
 * ── A regra ─────────────────────────────────────────────────────────
 * Uma entrada mora no banco onde a escrita aconteceu, e existe para
 * levar essa escrita ao OUTRO banco. Logo, entrada no banco X com
 * `targetNode = X` está errada e deve virar o outro nó.
 *
 * Na prática só o Neon deve ter linhas assim (o carimbo fixo era CLOUD),
 * mas a regra é aplicada aos dois lados: ela é a definição do campo, não
 * um remendo para um caso.
 *
 * ── Uso ─────────────────────────────────────────────────────────────
 *   node infra/scripts/recarimbar-outbox.mjs           simula, não grava
 *   node infra/scripts/recarimbar-outbox.mjs --apply   grava
 *
 * Simula por padrão de propósito: é escrita em dados de produção, e ver
 * a contagem por entidade antes custa dois segundos.
 *
 * Só toca entradas PENDING. SYNCED já foi aplicada; FAILED e CONFLICT
 * são justamente o que alguém precisa examinar, e mudar o destino delas
 * apagaria a pista do que houve.
 */

import { createRequire } from 'node:module';
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

/**
 * Carrega o Prisma Client gerado.
 *
 * Resolvido a partir de `packages/database` porque com pnpm o cliente
 * fica no diretório do pacote que o declara, e não na raiz.
 */
function loadPrismaClient() {
  try {
    const requireFrom = createRequire(join(databasePackage, 'package.json'));
    return requireFrom('@prisma/client').PrismaClient;
  } catch (error) {
    console.error('✗ Não foi possível carregar o Prisma Client.');
    console.error('  Rode `pnpm db:generate` antes.');
    console.error(`  Detalhe: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/** Um lado da operação: o banco, e qual nó ele é. */
async function inspecionar(PrismaClient, { rotulo, url, no, outro, aplicar }) {
  console.info(`\n─── ${rotulo} ───`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    // Entradas que mandam propagar para o próprio banco em que estão.
    const filtro = { status: 'PENDING', targetNode: no };

    const porEntidade = await prisma.changeLog.groupBy({
      by: ['entity'],
      where: filtro,
      _count: { _all: true },
    });

    const total = porEntidade.reduce((soma, linha) => soma + linha._count._all, 0);

    if (total === 0) {
      console.info(`✓ Nada fora do lugar (nenhuma entrada PENDING apontando para ${no}).`);
      return { total: 0, corrigidas: 0 };
    }

    console.info(`Encontradas ${total} entrada(s) apontando para ${no}, que é este mesmo banco:`);
    for (const linha of [...porEntidade].sort((a, b) => b._count._all - a._count._all)) {
      console.info(`  • ${linha.entity}: ${linha._count._all}`);
    }
    console.info(`Destino correto: ${outro}.`);

    if (!aplicar) {
      console.info('· Simulação — nada foi gravado. Use --apply para corrigir.');
      return { total, corrigidas: 0 };
    }

    const resultado = await prisma.changeLog.updateMany({
      where: filtro,
      data: { targetNode: outro },
    });

    console.info(`✓ ${resultado.count} entrada(s) recarimbada(s) para ${outro}.`);
    return { total, corrigidas: resultado.count };
  } catch (error) {
    console.error(`✗ ${rotulo}: ${error instanceof Error ? error.message : String(error)}`);
    return { total: 0, corrigidas: 0, falhou: true };
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

const aplicar = process.argv.includes('--apply');
const env = readEnvFile();
const PrismaClient = loadPrismaClient();

const localUrl = env.DATABASE_URL_LOCAL;
const cloudUrl = env.DATABASE_URL_CLOUD;

if (!localUrl && !cloudUrl) {
  console.error('✗ Nem DATABASE_URL_LOCAL nem DATABASE_URL_CLOUD estão no .env.');
  process.exit(1);
}

console.info(
  aplicar
    ? '► Modo APLICAR: as correções serão gravadas.'
    : '► Modo simulação: nada será gravado (use --apply para corrigir).',
);

const resultados = [];

if (localUrl) {
  resultados.push(
    await inspecionar(PrismaClient, {
      rotulo: 'Postgres local',
      url: localUrl,
      no: 'LOCAL',
      outro: 'CLOUD',
      aplicar,
    }),
  );
}

if (cloudUrl) {
  resultados.push(
    await inspecionar(PrismaClient, {
      rotulo: 'Neon',
      url: cloudUrl,
      no: 'CLOUD',
      outro: 'LOCAL',
      aplicar,
    }),
  );
}

const encontradas = resultados.reduce((soma, r) => soma + r.total, 0);
const corrigidas = resultados.reduce((soma, r) => soma + r.corrigidas, 0);
const houveFalha = resultados.some((r) => r.falhou);

console.info('\n─── Resumo ───');
console.info(`Fora do lugar: ${encontradas}`);
console.info(`Recarimbadas:  ${corrigidas}`);

if (encontradas > 0 && !aplicar) {
  console.info('\nRode de novo com --apply para gravar.');
}

if (corrigidas > 0) {
  console.info(
    '\nA próxima sincronização já leva essas entradas. Para não esperar a\n' +
      'janela agendada, dispare em POST /api/sync/trigger ou pela tela do painel.',
  );
}

// Um banco inalcançável não é "nada a fazer": sair 0 aqui esconderia que
// metade do trabalho não foi sequer verificada.
process.exit(houveFalha ? 1 : 0);
