'use client';

/**
 * Detalhe do exercício: execução passo a passo, músculos por papel,
 * erros comuns, dicas e o perfil de estímulo que diferencia o catálogo.
 */

import { useQuery } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { ExerciseDetail } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/query-state';

const DIFFICULTY: Record<string, { label: string; className: string }> = {
  BEGINNER: { label: 'Iniciante', className: 'bg-positive/15 text-positive' },
  INTERMEDIATE: { label: 'Intermediário', className: 'bg-warning/15 text-warning' },
  ADVANCED: { label: 'Avançado', className: 'bg-danger/15 text-danger' },
};

const STIMULUS_LABEL: Array<{ key: keyof ExerciseDetail['stimulus']; label: string }> = [
  { key: 'hypertrophy', label: 'Hipertrofia' },
  { key: 'strength', label: 'Força' },
  { key: 'endurance', label: 'Resistência' },
  { key: 'mechanicalTension', label: 'Tensão mecânica' },
  { key: 'caloricExpenditure', label: 'Gasto calórico' },
  { key: 'stability', label: 'Estabilidade' },
];

export default function ExercicioDetalhePage() {
  const params = useParams<{ id: string }>();

  const query = useQuery({
    queryKey: ['exercise', params.id],
    queryFn: () => api.get<ExerciseDetail>(`/exercises/${params.id}`),
    staleTime: 10 * 60_000,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-3xl p-5 md:p-8">
        <QueryState query={query}>
          {(exercise) => {
            const difficulty = DIFFICULTY[exercise.difficulty];
            const gif = exercise.media.find((media) => media.type === 'GIF') ?? exercise.media[0];

            return (
              <>
                <PageHeader
                  title={exercise.name}
                  subtitle={`${exercise.muscleGroup.name}${
                    exercise.muscleSubGroup ? ` · ${exercise.muscleSubGroup.name}` : ''
                  }`}
                  backHref="/exercicios"
                />

                <div className="mb-5 flex flex-wrap gap-2">
                  {difficulty && (
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${difficulty.className}`}
                    >
                      {difficulty.label}
                    </span>
                  )}
                  {exercise.mechanic && (
                    <span className="rounded-full bg-elevated px-2.5 py-1 text-[11px] text-ink-muted">
                      {exercise.mechanic === 'COMPOUND' ? 'Composto' : 'Isolado'}
                    </span>
                  )}
                  {exercise.equipment.map((item) => (
                    <span
                      key={item.equipment.id}
                      className="rounded-full bg-elevated px-2.5 py-1 text-[11px] text-ink-muted"
                    >
                      {item.equipment.name}
                    </span>
                  ))}
                </div>

                {gif && (
                  <div className="card mb-4 overflow-hidden p-0">
                    {/* `img` cru em vez de next/image: a mídia vem do Cloudinary
                        com dimensões variáveis e já otimizada na origem — passar
                        pelo otimizador do Next só adicionaria um salto. */}
                    <img
                      src={gif.url}
                      alt={`Execução: ${exercise.name}`}
                      className="max-h-80 w-full bg-elevated object-contain"
                    />
                  </div>
                )}

                {exercise.description && (
                  <p className="mb-4 text-sm leading-relaxed text-ink-muted">
                    {exercise.description}
                  </p>
                )}

                <section className="card mb-4">
                  <h2 className="card-title">Como executar</h2>
                  <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">
                    {exercise.execution}
                  </p>
                </section>

                {/* Músculos por papel */}
                <section className="card mb-4">
                  <h2 className="card-title">Músculos trabalhados</h2>
                  <div className="mt-3 space-y-2.5 text-sm">
                    {(
                      [
                        ['Primários', exercise.musclesByRole.primary],
                        ['Secundários', exercise.musclesByRole.secondary],
                        ['Estabilizadores', exercise.musclesByRole.stabilizer],
                      ] as const
                    ).map(([label, muscles]) =>
                      muscles.length > 0 ? (
                        <div key={label} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="w-32 shrink-0 text-xs text-ink-faint">{label}</span>
                          <span className="flex flex-wrap gap-1.5">
                            {muscles.map((muscle) => (
                              <span
                                key={muscle.id}
                                className="rounded bg-elevated px-2 py-0.5 text-xs"
                              >
                                {muscle.name}
                              </span>
                            ))}
                          </span>
                        </div>
                      ) : null,
                    )}
                  </div>
                </section>

                {/* Perfil de estímulo */}
                <section className="card mb-4">
                  <h2 className="card-title">Perfil de estímulo</h2>
                  <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                    {STIMULUS_LABEL.map(({ key, label }) => {
                      const value = exercise.stimulus[key];
                      return (
                        <div key={key} className="flex items-center gap-3">
                          <span className="w-32 shrink-0 text-xs text-ink-muted">{label}</span>
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${(value / 5) * 100}%` }}
                            />
                          </div>
                          <span className="w-7 shrink-0 text-right text-xs tabular-nums text-ink-faint">
                            {value}/5
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {exercise.commonMistakes.length > 0 && (
                  <section className="card mb-4 border-danger/20">
                    <h2 className="card-title text-danger">Erros comuns</h2>
                    <ul className="mt-3 space-y-2">
                      {exercise.commonMistakes.map((mistake) => (
                        <li key={mistake} className="flex gap-2 text-sm leading-relaxed">
                          <span aria-hidden className="text-danger">
                            ✕
                          </span>
                          {mistake}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                {exercise.tips.length > 0 && (
                  <section className="card border-positive/20">
                    <h2 className="card-title text-positive">Dicas</h2>
                    <ul className="mt-3 space-y-2">
                      {exercise.tips.map((tip) => (
                        <li key={tip} className="flex gap-2 text-sm leading-relaxed">
                          <span aria-hidden className="text-positive">
                            ✓
                          </span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </>
            );
          }}
        </QueryState>
      </div>
    </AppShell>
  );
}
