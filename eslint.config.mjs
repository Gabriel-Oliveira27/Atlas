/**
 * Configuração ESLint raiz (flat config).
 * Cada app/package pode estender esta base com regras próprias.
 *
 * `@atlas/config` precisa estar declarado nas devDependencies da RAIZ,
 * não só nos packages: o pnpm só linka o que está declarado, e sem isso
 * este import quebra com `ERR_MODULE_NOT_FOUND` — em qualquer lint do
 * monorepo, porque todos resolvem este arquivo.
 */
import baseConfig from '@atlas/config/eslint/base.mjs';

export default [
  ...baseConfig,
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/coverage/**',
      'packages/database/generated/**',
    ],
  },
];
