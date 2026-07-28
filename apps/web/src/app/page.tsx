'use client';

/**
 * Home — a tela mais acessada do produto.
 *
 * Consome `GET /api/home`, que já devolve tudo agregado numa única
 * chamada. Fazer seis requisições aqui multiplicaria a latência de
 * abertura, que é o que o usuário mais percebe.
 */

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { ProgressRing } from '@/components/progress-ring';
import { QueryState } from '@/components/query-state';

interface HomeData {
  user: { name: string; avatarUrl: string | null; goal: string };
  hydration: {
    totalMl: number;
    goalMl: number;
    remainingMl: number;
    percentage: number;
    goalReached: boolean;
  };
  workout: {
    inProgress: boolean;
    session: { id: string; startedAt: string } | null;
    completedToday: boolean;
    countToday: number;
  };
  weight: { currentKg: number | null; targetKg: number | null; remainingKg: number | null };
  streak: number;
  weeklyProgress: Array<{
    dayKey: string;
    workoutCompleted: boolean;
    hydrationGoalMet: boolean;
    volumeLoad: number;
  }>;
  tips: Array<{ id: string; title: string; content: string; category: string | null }>;
  announcements: Array<{ id: string; title: string; content: string }>;
  lastWeeklyReport: { id: string; summary: string | null } | null;
  degraded: boolean;
}

const GOAL_LABEL: Record<string, string> = {
  HYPERTROPHY: 'Hipertrofia',
  FAT_LOSS: 'Perda de gordura',
  STRENGTH: 'Força',
  ENDURANCE: 'Resistência',
  HEALTH: 'Saúde',
  REHAB: 'Reabilitação',
};

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

export default function HomePage() {
  const query = useQuery({
    queryKey: ['home'],
    queryFn: () => api.get<HomeData>('/home'),
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-5 md:p-8">
        <QueryState query={query}>
          {(data) => (
            <>
              {data.degraded && (
                <div className="mb-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
                  Operando com o banco em nuvem (Neon). Suas alterações serão reconciliadas quando o
                  banco local voltar.
                </div>
              )}

              <header className="mb-7">
                <p className="text-sm text-ink-muted">Olá,</p>
                <h1 className="text-2xl font-semibold tracking-tight">{data.user.name}</h1>
                <p className="mt-1 text-xs text-ink-faint">
                  Objetivo: {GOAL_LABEL[data.user.goal] ?? data.user.goal}
                </p>
              </header>

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Hidratação */}
                <section className="card">
                  <h2 className="card-title">Hidratação de hoje</h2>
                  <div className="mt-4 flex items-center gap-5">
                    <ProgressRing percentage={data.hydration.percentage} />
                    <div>
                      <p className="stat">
                        {data.hydration.totalMl}
                        <span className="ml-1 text-base font-normal text-ink-faint">ml</span>
                      </p>
                      <p className="text-xs text-ink-muted">meta de {data.hydration.goalMl} ml</p>
                      <p className="mt-1 text-xs">
                        {data.hydration.goalReached ? (
                          <span className="text-positive">Meta atingida ✓</span>
                        ) : (
                          <span className="text-ink-faint">
                            faltam {data.hydration.remainingMl} ml
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <a
                    href="/hidratacao"
                    className="mt-4 inline-block text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Registrar consumo →
                  </a>
                </section>

                {/* Treino */}
                <section className="card">
                  <h2 className="card-title">Treino</h2>
                  <div className="mt-4">
                    {data.workout.inProgress ? (
                      <>
                        <p className="stat text-accent">Em andamento</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          Iniciado às{' '}
                          {data.workout.session
                            ? new Date(data.workout.session.startedAt).toLocaleTimeString('pt-BR', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })
                            : '—'}
                        </p>
                      </>
                    ) : data.workout.completedToday ? (
                      <>
                        <p className="stat text-positive">Concluído</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          {data.workout.countToday} sessão(ões) hoje
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="stat text-ink-faint">Sem treino</p>
                        <p className="mt-1 text-xs text-ink-muted">Nenhuma sessão hoje</p>
                      </>
                    )}
                  </div>
                </section>

                {/* Sequência */}
                <section className="card">
                  <h2 className="card-title">Sequência</h2>
                  <p className="stat mt-4">
                    {data.streak}
                    <span className="ml-1 text-base font-normal text-ink-faint">
                      {data.streak === 1 ? 'dia' : 'dias'}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">dias consecutivos treinando</p>
                </section>

                {/* Peso */}
                <section className="card">
                  <h2 className="card-title">Peso</h2>
                  <p className="stat mt-4">
                    {data.weight.currentKg ?? '—'}
                    {data.weight.currentKg && (
                      <span className="ml-1 text-base font-normal text-ink-faint">kg</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {data.weight.targetKg
                      ? `meta de ${data.weight.targetKg} kg`
                      : 'meta não definida'}
                  </p>
                </section>
              </div>

              {/* Progresso semanal */}
              <section className="card mt-4">
                <h2 className="card-title">Progresso da semana</h2>
                <div className="mt-4 flex justify-between gap-2">
                  {data.weeklyProgress.length === 0 ? (
                    <p className="text-sm text-ink-faint">Ainda sem registros nesta semana.</p>
                  ) : (
                    data.weeklyProgress.map((day) => {
                      const weekday = new Date(`${day.dayKey}T12:00:00`).getDay();
                      return (
                        <div key={day.dayKey} className="flex flex-1 flex-col items-center gap-1.5">
                          <span className="text-[10px] text-ink-faint">{WEEKDAYS[weekday]}</span>
                          <span
                            title={day.workoutCompleted ? 'Treinou' : 'Não treinou'}
                            className={`h-8 w-full rounded ${
                              day.workoutCompleted ? 'bg-accent' : 'bg-elevated'
                            }`}
                          />
                          <span
                            title={day.hydrationGoalMet ? 'Bateu a meta de água' : 'Abaixo da meta'}
                            className={`h-1.5 w-full rounded ${
                              day.hydrationGoalMet ? 'bg-positive' : 'bg-elevated'
                            }`}
                          />
                        </div>
                      );
                    })
                  )}
                </div>
                <p className="mt-3 text-[11px] text-ink-faint">
                  Barra superior: treino · Barra inferior: meta de água
                </p>
              </section>

              {/* Dicas */}
              {data.tips.length > 0 && (
                <section className="mt-4">
                  <h2 className="card-title mb-3">Dicas</h2>
                  <div className="space-y-3">
                    {data.tips.map((tip) => (
                      <article key={tip.id} className="card">
                        <h3 className="text-sm font-medium">{tip.title}</h3>
                        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{tip.content}</p>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </QueryState>
      </div>
    </AppShell>
  );
}
