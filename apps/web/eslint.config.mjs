/**
 * ESLint do app web.
 *
 * O preset `next` existia mas nunca era aplicado: sem um config no
 * próprio app, o `eslint .` resolve o da raiz e as regras específicas
 * de JSX/Server Components ficam de fora.
 */
import nextConfig from '@atlas/config/eslint/next.mjs';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**', '.turbo/**', 'next-env.d.ts'],
  },
];
