/**
 * Ambiente dos testes da API.
 *
 * Precisa ser importado ANTES de qualquer módulo do Nest: o
 * `app.module.ts` cria um `EnvConfig` no topo do arquivo, e `EnvConfig`
 * valida `process.env` no construtor. Um import fora de ordem derruba a
 * suíte inteira com "Configuração de ambiente inválida" — por isso este
 * arquivo entra como `setupFiles` do Vitest, e não como import comum.
 *
 * O banco é o `atlas_test`, SEPARADO do banco de desenvolvimento: os
 * testes truncam tabelas entre si, e apontar para `atlas` apagaria o
 * trabalho de quem estivesse usando o app.
 *
 * ── UMA execução por vez neste banco ────────────────────────────────
 * As suítes dão `TRUNCATE` no `beforeEach`. Duas execuções simultâneas
 * apontando para o MESMO banco apagam as linhas uma da outra no meio do
 * teste, e a falha é enganosa: um `P2025` ("Record to update not
 * found") no meio de um login que acabou de encontrar o usuário. Foi
 * exatamente esse o sintoma quando duas rodadas se cruzaram aqui.
 *
 * Se precisar rodar em paralelo (CI com matriz, duas branches ao mesmo
 * tempo), dê um banco a cada execução:
 *
 *   TEST_DATABASE_URL=postgresql://atlas:...@localhost:5433/atlas_test_2
 *
 * O `globalSetup` aplica as migrations no banco que esta variável
 * apontar, então basta criá-lo vazio antes.
 */

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://atlas:atlas_dev_password@localhost:5433/atlas_test?schema=public';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL_LOCAL = TEST_DATABASE_URL;
process.env.DATABASE_URL = TEST_DATABASE_URL;

// Sem nuvem nos testes: failover e reconciliação têm suíte própria e
// não podem disparar no meio de um teste de rota.
process.env.DATABASE_URL_CLOUD = '';
process.env.DATABASE_PRIMARY = 'LOCAL';

// Cron de sincronização e chamadas de IA ficam fora: um job disparando
// durante a suíte torna a falha não reproduzível.
process.env.SYNC_ENABLED = 'false';
process.env.AI_ENABLED = 'false';

process.env.JWT_ACCESS_SECRET = 'segredo-de-teste-access-0123456789';
process.env.JWT_REFRESH_SECRET = 'segredo-de-teste-refresh-0123456789';
process.env.JWT_ACCESS_TTL = '15m';
process.env.JWT_REFRESH_TTL = '30d';

process.env.LOG_LEVEL = 'fatal';
process.env.NODE_ID = 'test-node';

// Prefixo próprio no Redis: o rate limit dos testes não pode herdar
// contadores do ambiente de desenvolvimento (nem deixar os seus lá).
process.env.REDIS_PREFIX = `atlas-test-${process.pid}`;

export { TEST_DATABASE_URL };
