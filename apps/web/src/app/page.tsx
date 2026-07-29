'use client';

/**
 * Home — a tela mais acessada do produto.
 *
 * Consome `GET /api/home`, que já devolve tudo agregado numa única
 * chamada. Fazer seis requisições aqui multiplicaria a latência de
 * abertura, que é o que o usuário mais percebe.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { dayKeyToDate, formatTime, formatWeight } from '@/lib/format';
import { AppShell } from '@/components/app-shell';
import { ProgressRing } from '@/components/progress-ring';
import { QueryState } from '@/components/query-state';
import {
  IconChevronRight,
  IconDroplet,
  IconDumbbell,
  IconFlame,
  IconPlay,
  IconScale,
} from '@/components/icons';

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

/** Saudação pelo horário — detalhe pequeno, mas a tela parece viva. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return 'Boa madrugada,';
  if (hour < 12) return 'Bom dia,';
  if (hour < 18) return 'Boa tarde,';
  return 'Boa noite,';
}

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
              {data.announcements.length > 0 && (
                <div className="mb-5 space-y-2">
                  {data.announcements.map((announcement) => (
                    <div
                      key={announcement.id}
                      className="rounded-lg border border-accent/25 bg-accent/10 p-3"
                    >
                      <p className="text-sm font-medium text-accent">{announcement.title}</p>
                      <p className="mt-0.5 text-sm leading-relaxed text-ink-muted">
                        {announcement.content}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <header className="mb-7">
                <p className="text-sm text-ink-muted">{greeting()}</p>
                <h1 className="text-2xl font-semibold tracking-tight">{data.user.name}</h1>
                <p className="mt-1 text-xs text-ink-faint">
                  Objetivo: {GOAL_LABEL[data.user.goal] ?? data.user.goal}
                </p>
              </header>

              {/* Sessão aberta tem prioridade sobre tudo na tela. */}
              {data.workout.inProgress && (
                <Link
                  href="/treino/sessao"
                  className="mb-4 flex items-center justify-between gap-4 rounded-card border border-accent/40 bg-gradient-to-r from-accent/15 to-transparent p-4 transition hover:border-accent"
                >
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-accent">
                      Treino em andamento
                    </p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      Iniciado às{' '}
                      {data.workout.session ? formatTime(data.workout.session.startedAt) : '—'} —
                      toque para retomar
                    </p>
                  </div>
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent text-base">
                    <IconPlay size={18} />
                  </span>
                </Link>
              )}

              <div className="grid gap-4 sm:grid-cols-2">
                {/* Hidratação */}
                <section className="card">
                  <h2 className="card-title flex items-center gap-1.5">
                    <IconDroplet size={13} />
                    Hidratação de hoje
                  </h2>
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
                  <Link
                    href="/hidratacao"
                    className="mt-4 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Registrar consumo
                    <IconChevronRight size={13} />
                  </Link>
                </section>

                {/* Treino */}
                <section className="card">
                  <h2 className="card-title flex items-center gap-1.5">
                    <IconDumbbell size={13} />
                    Treino
                  </h2>
                  <div className="mt-4">
                    {data.workout.inProgress ? (
                      <>
                        <p className="stat text-accent">Em andamento</p>
                        <p className="mt-1 text-xs text-ink-muted">
                          Iniciado às{' '}
                          {data.workout.session ? formatTime(data.workout.session.startedAt) : '—'}
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
                  <Link
                    href="/treino"
                    className="mt-4 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    {data.workout.inProgress ? 'Retomar treino' : 'Ir para o treino'}
                    <IconChevronRight size={13} />
                  </Link>
                </section>

                {/* Sequência */}
                <section className="card">
                  <h2 className="card-title flex items-center gap-1.5">
                    <IconFlame size={13} />
                    Sequência
                  </h2>
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
                  <h2 className="card-title flex items-center gap-1.5">
                    <IconScale size={13} />
                    Peso
                  </h2>
                  <p className="stat mt-4">
                    {data.weight.currentKg ? formatWeight(data.weight.currentKg) : '—'}
                    {data.weight.currentKg && (
                      <span className="ml-1 text-base font-normal text-ink-faint">kg</span>
                    )}
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    {data.weight.targetKg
                      ? `meta de ${formatWeight(data.weight.targetKg)} kg`
                      : 'meta não definida'}
                  </p>
                  <Link
                    href="/evolucao"
                    className="mt-4 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
                  >
                    Ver evolução
                    <IconChevronRight size={13} />
                  </Link>
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
                      const weekday = dayKeyToDate(day.dayKey).getDay();
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

              {/* Último relatório da IA */}
              {data.lastWeeklyReport?.summary && (
                <section className="card mt-4 border-accent/20">
                  <h2 className="card-title text-accent">Seu resumo da semana</h2>
                  <p className="mt-3 text-sm leading-relaxed text-ink-muted">
                    {data.lastWeeklyReport.summary}
                  </p>
                </section>
              )}

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
