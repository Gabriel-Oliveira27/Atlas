import type { Config } from 'tailwindcss';

/**
 * Identidade visual do painel — a MESMA do app.
 *
 * Duplicada aqui, e não importada de `apps/web`, porque um app não deve
 * depender do outro. Se a paleta virar tema de verdade (mais de dois
 * consumidores, ou tokens que mudam por academia), o lugar dela é um
 * package próprio — não um import cruzado entre aplicações.
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
