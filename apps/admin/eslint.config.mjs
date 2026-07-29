/**
 * ESLint do painel administrativo. Mesmo preset do app web.
 */
import nextConfig from '@atlas/config/eslint/next.mjs';

export default [
  ...nextConfig,
  {
    ignores: ['.next/**', 'node_modules/**', '.turbo/**', 'next-env.d.ts'],
  },
];
