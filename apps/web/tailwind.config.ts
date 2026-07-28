import type { Config } from 'tailwindcss';

/**
 * Identidade visual do Atlas.
 *
 * Paleta escura por decisão de uso: o app é consultado na academia,
 * muitas vezes em ambiente com pouca luz e com o celular na mão entre
 * séries. Fundo escuro com um acento de alta saturação dá leitura rápida
 * sem ofuscar.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Superfícies, do fundo para o primeiro plano.
        base: '#0B1120',
        surface: '#111C33',
        elevated: '#18253F',
        border: '#233149',

        // Acento — usado em progresso, ações e destaque.
        accent: {
          DEFAULT: '#38BDF8',
          strong: '#0EA5E9',
          soft: '#7DD3FC',
        },

        // Semântica de estado.
        positive: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171',

        // Texto.
        ink: '#F1F5F9',
        'ink-muted': '#94A3B8',
        'ink-faint': '#64748B',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        card: '1rem',
      },
    },
  },
  plugins: [],
};

export default config;
