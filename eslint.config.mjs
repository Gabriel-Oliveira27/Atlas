/**
 * Configuração ESLint raiz (flat config).
 * Cada app/package pode estender esta base com regras próprias.
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
