/**
 * ESLint da API.
 *
 * Sem este arquivo, o `eslint src` resolveria a config da RAIZ, que usa
 * o preset base — e o base exige `import type` em imports usados só
 * como tipo. Numa aplicação Nest isso apagaria os imports das classes
 * injetadas e derrubaria a injeção de dependência em runtime. Ver a
 * nota em `packages/config/eslint/nest.mjs`.
 */
import nestConfig from '@atlas/config/eslint/nest.mjs';

export default [
  ...nestConfig,
  {
    ignores: ['dist/**', 'node_modules/**', '.turbo/**'],
  },
];
