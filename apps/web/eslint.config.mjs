/**
 * ESLint do app web.
 *
 * O preset `next` existia mas nunca era aplicado: sem um config no
 * próprio app, o `eslint .` resolve o da raiz e as regras específicas
 * de JSX/Server Components ficam de fora.
 *
 * O que exige tratamento à parte é `public/sw.js`: um service worker
 * roda em outro escopo global (`self`, `caches`, `fetch`), que a
 * configuração base — pensada para módulos Node/TS — não conhece, e
 * acusaria `no-undef` em tudo.
 */
import nextConfig from '@atlas/config/eslint/next.mjs';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**', '.turbo/**', 'next-env.d.ts'],
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
