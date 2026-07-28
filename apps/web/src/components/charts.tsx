'use client';

/**
 * Gráficos do Atlas — SVG puro, sem biblioteca.
 *
 * Todos são de série única (peso, volume, água), então: um matiz só, sem
 * legenda (o título do card nomeia a série), grade recessiva, rótulo
 * direto apenas no ponto ativo e tooltip ao passar o dedo/mouse. Texto
 * sempre em tons de tinta, nunca na cor da série.
 *
 * As cores vêm dos tokens `chart.*` (ver tailwind.config.ts) e não do
 * acento da interface — a justificativa está lá.
 */

import { useMemo, useRef, useState } from 'react';

const COLOR = {
  series: '#0284C7',
  positive: '#059669',
  highlight: '#38BDF8',
  grid: '#233149',
  surface: '#111C33',
  ink: '#64748B',
} as const;

interface Point {
  label: string;
  value: number;
}

const WIDTH = 600;
const HEIGHT = 180;
const PAD_X = 6;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;

function niceScale(min: number, max: number): { min: number; max: number } {
  if (min === max) {
    const delta = Math.max(1, Math.abs(min) * 0.05);
    return { min: min - delta, max: max + delta };
  }
  const padding = (max - min) * 0.12;
  return { min: min - padding, max: max + padding };
}

export function LineChart({
  points,
  unit,
  formatValue = (value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
}: {
  points: Point[];
  unit: string;
  formatValue?: (value: number) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    if (points.length === 0) return null;

    const values = points.map((point) => point.value);
    const scale = niceScale(Math.min(...values), Math.max(...values));
    const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
    const stepX = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 0;

    const coords = points.map((point, index) => ({
      x: PAD_X + (points.length > 1 ? index * stepX : (WIDTH - PAD_X * 2) / 2),
      y: PAD_TOP + plotHeight - ((point.value - scale.min) / (scale.max - scale.min)) * plotHeight,
    }));

    const line = coords.map(({ x, y }, i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
    const area = `${line} L${coords.at(-1)!.x},${HEIGHT - PAD_BOTTOM} L${coords[0]!.x},${HEIGHT - PAD_BOTTOM} Z`;

    return { coords, line, area, scale };
  }, [points]);

  if (!geometry || points.length === 0) return null;

  const { coords, line, area, scale } = geometry;
  const last = points.length - 1;
  const active = hover ?? last;

  function handlePointer(event: React.PointerEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const relative = ((event.clientX - rect.left) / rect.width) * WIDTH;
    const stepX = points.length > 1 ? (WIDTH - PAD_X * 2) / (points.length - 1) : 1;
    const index = Math.round((relative - PAD_X) / stepX);
    setHover(Math.max(0, Math.min(points.length - 1, index)));
  }

  return (
    <div ref={containerRef} className="relative">
      {/* Tooltip do ponto ativo */}
      <div
        className="pointer-events-none absolute -top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-elevated px-2 py-1 text-[11px] tabular-nums shadow-lg"
        style={{ left: `${(coords[active]!.x / WIDTH) * 100}%` }}
      >
        <span className="font-semibold">{formatValue(points[active]!.value)}</span>
        <span className="text-ink-faint"> {unit}</span>
        <span className="ml-1.5 text-ink-faint">{points[active]!.label}</span>
      </div>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Gráfico de ${unit}: ${points.length} registros, último ${formatValue(points[last]!.value)} ${unit}`}
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id="atlas-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={COLOR.series} stopOpacity="0.3" />
            <stop offset="100%" stopColor={COLOR.series} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grade recessiva: três linhas, sem eixo pesado */}
        {[0.25, 0.5, 0.75].map((fraction) => {
          const y = PAD_TOP + (HEIGHT - PAD_TOP - PAD_BOTTOM) * fraction;
          return (
            <line
              key={fraction}
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y}
              y2={y}
              stroke={COLOR.grid}
              strokeWidth="1"
              strokeDasharray="3 5"
            />
          );
        })}

        <path d={area} fill="url(#atlas-area)" />
        <path
          d={line}
          fill="none"
          stroke={COLOR.series}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Linha-guia e marcador do ponto ativo */}
        <line
          x1={coords[active]!.x}
          x2={coords[active]!.x}
          y1={PAD_TOP - 4}
          y2={HEIGHT - PAD_BOTTOM}
          stroke={COLOR.highlight}
          strokeOpacity="0.35"
          strokeWidth="1"
        />
        <circle
          cx={coords[active]!.x}
          cy={coords[active]!.y}
          r="5"
          fill={COLOR.highlight}
          stroke={COLOR.surface}
          strokeWidth="2"
        />

        {/* Rótulos de faixa nas pontas do eixo Y */}
        <text x={PAD_X} y={12} fill={COLOR.ink} fontSize="10">
          {formatValue(scale.max)}
        </text>
        <text x={PAD_X} y={HEIGHT - PAD_BOTTOM + 14} fill={COLOR.ink} fontSize="10">
          {formatValue(scale.min)}
        </text>

        {/* Primeiro e último rótulo do eixo X */}
        <text x={PAD_X + 40} y={HEIGHT - 4} fill={COLOR.ink} fontSize="10">
          {points[0]!.label}
        </text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 4} textAnchor="end" fill={COLOR.ink} fontSize="10">
          {points[last]!.label}
        </text>
      </svg>
    </div>
  );
}

export function BarChart({
  bars,
  unit,
  formatValue = (value) => value.toLocaleString('pt-BR', { maximumFractionDigits: 0 }),
  highlightGoal,
}: {
  bars: Point[];
  unit: string;
  formatValue?: (value: number) => string;
  /** Linha de meta opcional (ex.: meta diária de água). */
  highlightGoal?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);

  if (bars.length === 0) return null;

  const max = Math.max(...bars.map((bar) => bar.value), highlightGoal ?? 0, 1);
  const active = hover ?? bars.length - 1;

  return (
    <div>
      <p className="mb-2 text-[11px] tabular-nums text-ink-muted" aria-live="polite">
        <span className="font-semibold text-ink">{formatValue(bars[active]!.value)}</span>
        <span className="text-ink-faint"> {unit}</span>
        <span className="ml-1.5 text-ink-faint">{bars[active]!.label}</span>
      </p>

      <div className="relative">
        {highlightGoal !== undefined && (
          <div
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-faint/60"
            style={{ bottom: `${(highlightGoal / max) * 100}%` }}
            title={`Meta: ${formatValue(highlightGoal)} ${unit}`}
          />
        )}
        <div className="flex h-32 items-end gap-[3px]" onPointerLeave={() => setHover(null)}>
          {bars.map((bar, index) => {
            const met = highlightGoal !== undefined && bar.value >= highlightGoal;
            return (
              <button
                key={`${bar.label}-${index}`}
                type="button"
                onPointerEnter={() => setHover(index)}
                onFocus={() => setHover(index)}
                aria-label={`${bar.label}: ${formatValue(bar.value)} ${unit}`}
                className="group flex h-full flex-1 items-end"
              >
                <span
                  className={`block w-full rounded-t transition-colors ${
                    index === active
                      ? 'bg-chart-highlight'
                      : met
                        ? 'bg-chart-positive group-hover:bg-positive'
                        : 'bg-chart-series group-hover:bg-chart-highlight'
                  }`}
                  style={{ height: `${Math.max(3, (bar.value / max) * 100)}%` }}
                />
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-1 flex justify-between text-[10px] text-ink-faint">
        <span>{bars[0]!.label}</span>
        <span>{bars.at(-1)!.label}</span>
      </div>
    </div>
  );
}
