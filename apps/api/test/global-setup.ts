/**
 * Preparação única do banco de testes.
 *
 * Aplica as migrations no `atlas_test` antes de qualquer suíte rodar.
 * `migrate deploy` (e não `db push`) de propósito: assim os testes
 * exercitam exatamente o schema que vai para produção, e uma migration
 * quebrada falha aqui em vez de no deploy.
 */

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const databasePackage = resolve(here, '../../../packages/database');

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://atlas:atlas_dev_password@localhost:5433/atlas_test?schema=public';

/**
 * Caminho do CLI do Prisma resolvido como MÓDULO, não como binário.
 *
 * Chamar `npx`/`prisma.cmd` direto quebra no Windows (`spawnSync
 * EINVAL`: o Node se recusa a executar `.cmd` sem shell, e usar shell
 * traz problema de escape de caminho com espaço). Executar o JS com o
 * próprio Node é portátil e não depende de PATH.
 */
function resolvePrismaCli(): string {
  const requireFrom = createRequire(resolve(databasePackage, 'package.json'));
  return requireFrom.resolve('prisma/build/index.js');
}

export async function setup(): Promise<void> {
  execFileSync(
    process.execPath,
    [resolvePrismaCli(), 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
    {
      cwd: databasePackage,
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_URL_LOCAL: TEST_DATABASE_URL,
      },
    },
  );
}
