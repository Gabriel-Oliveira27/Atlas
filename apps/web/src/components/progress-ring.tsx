/**
 * Anel de progresso da hidratação.
 *
 * SVG em vez de biblioteca de gráficos: é uma única forma, e trazer uma
 * dependência inteira para desenhar um círculo pesaria mais no bundle
 * do que o produto ganha.
 */

interface ProgressRingProps {
  percentage: number;
  size?: number;
  strokeWidth?: number;
}

export function ProgressRing({ percentage, size = 88, strokeWidth = 8 }: ProgressRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = circumference - (clamped / 100) * circumference;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        // Gira para o preenchimento começar no topo, não à direita.
        className="-rotate-90"
        role="img"
        aria-label={`${Math.round(clamped)}% da meta de água`}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          className="fill-none stroke-elevated"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={`fill-none transition-[stroke-dashoffset] duration-500 ${
            clamped >= 100 ? 'stroke-positive' : 'stroke-accent'
          }`}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums">
        {Math.round(clamped)}%
      </span>
    </div>
  );
}
