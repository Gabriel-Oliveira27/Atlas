import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

/**
 * Testes da API.
 *
 * Três decisões que não são preferência, são requisito:
 *
 *  • **SWC no lugar do esbuild.** O Nest resolve as dependências pelos
 *    tipos do construtor, que só existem em tempo de execução se o
 *    compilador emitir `design:paramtypes`. O esbuild (padrão do
 *    Vitest) NÃO emite — e o sintoma é confuso: os serviços sobem com
 *    todas as dependências `undefined`.
 *
 *  • **`singleFork`.** As suítes truncam tabelas; rodar em paralelo
 *    faria um arquivo apagar os dados do outro no meio do teste. É mais
 *    lento, e é a diferença entre um teste confiável e um que "às vezes
 *    passa".
 *
 *  • **`setupFiles`.** Roda antes dos imports do teste, que é onde as
 *    variáveis de ambiente precisam existir (ver `test/env.ts`).
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.e2e.test.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./test/env.ts'],
    globalSetup: ['./test/global-setup.ts'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    // Subir a app e aplicar bcrypt custo 12 leva tempo; o padrão de 5 s
    // falharia por impaciência, não por defeito.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
