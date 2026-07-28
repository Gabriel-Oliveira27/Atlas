import { defineConfig } from 'vitest/config';

/**
 * Configuração base do Vitest.
 *
 * Cada package herda esta configuração; testes ficam ao lado do código
 * (`*.test.ts`), o que mantém o teste visível para quem altera a função.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.config.*',
        '**/generated/**',
        // Módulos do Nest são wiring, não lógica.
        '**/*.module.ts',
      ],
    },
  },
});
