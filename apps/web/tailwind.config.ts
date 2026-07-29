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

        /**
         * Marcas de gráfico. Tons próprios, mais fechados que o acento da
         * interface: sobre fundo escuro, os passos claros ficam fora da
         * faixa de luminosidade legível (OKLCH L 0.48–0.67) e dois deles
         * lado a lado não se separam o suficiente para daltonismo. Este
         * par foi validado (ΔE 16,1 protan · contraste ≥ 3:1). O acento
         * claro fica reservado ao ponto/barra em destaque — realce é
         * estado, e ali o brilho é justamente o que se quer.
         */
        chart: {
          series: '#0284C7',
          positive: '#059669',
          highlight: '#38BDF8',
          grid: '#233149',
        },

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
