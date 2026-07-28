// Preset ESLint para a API NestJS.
import base from './base.mjs';

export default [
  ...base,
  {
    rules: {
      // Decorators do Nest declaram parâmetros que o TS não "vê" sendo usados.
      '@typescript-eslint/no-unused-vars': ['error', { args: 'none', varsIgnorePattern: '^_' }],
      // Interfaces vazias são idiomáticas em DTOs/portas do domínio.
      '@typescript-eslint/no-empty-object-type': 'off',
      // O Nest usa injeção por classe; classes só com construtor são normais.
      '@typescript-eslint/no-extraneous-class': 'off',
    },
  },
];
