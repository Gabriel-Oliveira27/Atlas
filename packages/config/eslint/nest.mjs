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

      /**
       * DESLIGADA — e não é preferência de estilo.
       *
       * O Nest resolve as dependências pelos tipos do construtor, que
       * chegam ao runtime via `emitDecoratorMetadata`. `import type`
       * APAGA o import na compilação: o serviço injetado vira
       * `undefined` e a aplicação quebra ao subir.
       *
       * A regra enxerga `PrismaService` como "usado apenas como tipo"
       * porque só aparece na assinatura do construtor — e o `--fix`
       * dela converte em massa, derrubando a API inteira de uma vez.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
