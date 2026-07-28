// Preset ESLint para os apps Next.js (web e admin).
import base from './base.mjs';

export default [
  ...base,
  {
    files: ['**/*.tsx', '**/*.jsx'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      // Server Components podem ser assíncronos; React não reclama disso.
      '@typescript-eslint/no-misused-promises': 'off',
    },
  },
];
