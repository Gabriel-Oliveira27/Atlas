#!/usr/bin/env node
/**
 * Verifica se o ambiente local está pronto para rodar o Atlas.
 *
 * Roda antes de qualquer coisa e diz exatamente o que falta, em vez de
 * deixar o desenvolvedor descobrir por um erro de conexão no meio de
 * uma migration.
 *
 *   pnpm bootstrap
 */

import { execSync } from 'node:child_process';
import { existsSync, copyFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

let hasError = false;
let hasWarning = false;

function ok(message) {
  console.info(`  ✓ ${message}`);
}

function warn(message) {
  console.warn(`  ⚠ ${message}`);
  hasWarning = true;
}

function fail(message) {
  console.error(`  ✗ ${message}`);
  hasError = true;
}

function checkCommand(command, label, minimum) {
  try {
    const output = execSync(command, { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    ok(`${label}: ${output}`);
    return output;
  } catch {
    fail(`${label} não encontrado${minimum ? ` (mínimo: ${minimum})` : ''}`);
    return null;
  }
}

/** Testa se uma porta TCP está aceitando conexão. */
function checkPort(host, port, label) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const finish = (available) => {
      socket.destroy();
      resolve(available);
    };

    socket.setTimeout(2000);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  }).then((available) => {
    if (available) ok(`${label} respondendo em ${host}:${port}`);
    else warn(`${label} não respondeu em ${host}:${port} — rode "pnpm docker:up"`);
    return available;
  });
}

console.info('\n═══ Atlas — verificação do ambiente ═══\n');

console.info('Ferramentas:');
checkCommand('node --version', 'Node.js', 'v20');
checkCommand('pnpm --version', 'pnpm', '9');
checkCommand('docker --version', 'Docker');

console.info('\nArquivos de configuração:');

const rootEnv = join(repoRoot, '.env');
if (existsSync(rootEnv)) {
  ok('.env presente');
} else {
  const example = join(repoRoot, '.env.example');
  if (existsSync(example)) {
    copyFileSync(example, rootEnv);
    warn('.env criado a partir do .env.example — revise os valores');
  } else {
    fail('.env ausente e .env.example não encontrado');
  }
}

const dockerEnv = join(repoRoot, 'infra', 'docker', '.env');
if (existsSync(dockerEnv)) {
  ok('infra/docker/.env presente');
} else {
  const example = join(repoRoot, 'infra', 'docker', '.env.example');
  if (existsSync(example)) {
    copyFileSync(example, dockerEnv);
    warn('infra/docker/.env criado a partir do exemplo');
  } else {
    fail('infra/docker/.env ausente');
  }
}

console.info('\nConfigurações pendentes:');

if (existsSync(rootEnv)) {
  const content = readFileSync(rootEnv, 'utf8');

  const isBlank = (key) => {
    const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
    if (!match) return true;
    const value = match[1].trim().replace(/^["']|["']$/g, '');
    return value === '';
  };

  if (isBlank('DATABASE_URL_CLOUD')) {
    warn('DATABASE_URL_CLOUD vazio — sem failover nem sincronização com o Neon');
  } else {
    ok('Neon configurado');
  }

  if (isBlank('GOOGLE_CLIENT_ID') || isBlank('GOOGLE_CLIENT_SECRET')) {
    warn('Google OAuth não configurado — as rotas /auth/google ficam indisponíveis');
  } else {
    ok('Google OAuth configurado');
  }

  if (isBlank('CLOUDINARY_CLOUD_NAME')) {
    warn('Cloudinary não configurado — uploads de mídia indisponíveis');
  } else {
    ok('Cloudinary configurado');
  }
}

console.info('\nServiços (Docker):');
await checkPort('localhost', 5433, 'PostgreSQL');
await checkPort('localhost', 6379, 'Redis');
await checkPort('localhost', 5678, 'n8n');

console.info('\n───────────────────────────────────────');

if (hasError) {
  console.error('\n✗ Há problemas que impedem a execução. Resolva-os e rode novamente.\n');
  process.exit(1);
}

if (hasWarning) {
  console.warn('\n⚠ Ambiente utilizável, com pendências acima.\n');
} else {
  console.info('\n✓ Ambiente pronto.\n');
}

console.info('Próximos passos:');
console.info('  1. pnpm docker:up      (se os serviços não subiram)');
console.info('  2. pnpm db:migrate     (aplica as migrations no banco local)');
console.info('  3. pnpm db:seed        (popula papéis, exercícios e admin)');
console.info('  4. pnpm api:dev        (sobe a API em http://localhost:3333)\n');
