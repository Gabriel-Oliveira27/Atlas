/**
 * ESLint do app web.
 *
 * O preset `next` cobre o código de `src/`. O que exige tratamento
 * próprio é `public/sw.js`: um service worker roda em outro escopo
 * global (`self`, `caches`, `fetch`), que a configuração base — pensada
 * para módulos Node/TS — não conhece, e acusaria `no-undef` em tudo.
 */
import next from '@atlas/config/eslint/next.mjs';

export default [
  ...next,
  {
    ignores: ['.next/**', 'next-env.d.ts'],
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        URL: 'readonly',
        Promise: 'readonly',
        console: 'readonly',
      },
    },
  },
];
