'use client';

/**
 * Hub de treino.
 *
 * Três estados possíveis, em ordem de prioridade:
 *   1. Sessão aberta → o card de retomada domina a tela (é o que o
 *      usuário veio fazer).
 *   2. Plano ativo → dias do plano com "Iniciar".
 *   3. Sem plano → treino livre e histórico.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { OpenSession, SessionListItem, WorkoutPlan } from '@/lib/types';
import { formatDate, formatDuration, formatVolume } from '@/lib/format';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/query-state';
import { IconChevronRight, IconDumbbell, IconList, IconPlay } from '@/components/icons';

const WEEKDAY_SHORT = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

const SPLIT_LABEL: Record<string, string> = {
  ABC: 'Divisão ABC',
  ABCD: 'Divisão ABCD',
  ABCDE: 'Divisão ABCDE',
  UPPER_LOWER: 'Superior / Inferior',
  PUSH_PULL_LEGS: 'Push · Pull · Legs',
  FULL_BODY: 'Corpo inteiro',
  PERIODIZED: 'Periodizado',
  CUSTOM: 'Personalizado',
};

export default function TreinoPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [startError, setStartError] = useState<string | null>(null);

  const openQuery = useQuery({
    queryKey: ['workout', 'open'],
    queryFn: () => api.get<OpenSession | null>('/workouts/sessions/open'),
  });

  const planQuery = useQuery({
    queryKey: ['workout', 'plan-active'],
    queryFn: () => api.get<WorkoutPlan | null>('/workouts/plans/active'),
    staleTime: 5 * 60_000,
  });

  const sessionsQuery = useQuery({
    queryKey: ['workout', 'sessions'],
    queryFn: () => api.get<SessionListItem[]>('/workouts/sessions'),
  });

  const startMutation = useMutation({
    mutationFn: (day: { workoutDayId?: string; workoutPlanId?: string }) =>
      api.post<OpenSession>('/workouts/sessions', {
        ...day,
        startedAt: new Date().toISOString(),
        clientGeneratedId: crypto.randomUUID(),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workout'] });
      router.push('/treino/sessao');
    },
    onError: (error) => {
      // Já existe sessão aberta: em vez de mostrar erro, leva para ela.
      if (error instanceof ApiError && error.code === 'WORKOUT_SESSION_ALREADY_OPEN') {
        router.push('/treino/sessao');
        return;
      }
      setStartError(
        error instanceof ApiError ? error.message : 'Não foi possível iniciar o treino.',
      );
    },
  });

  const open = openQuery.data;
  const today = new Date().getDay();

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-5 md:p-8">
        <PageHeader
          title="Treino"
          action={
            <Link href="/exercicios" className="btn-ghost text-xs">
              <IconList size={15} />
              Catálogo
            </Link>
          }
        />

        {/* ── Sessão em andamento ─────────────────────────────── */}
        {open && (
          <Link
            href="/treino/sessao"
            className="mb-5 flex items-center justify-between gap-4 rounded-card border border-accent/40 bg-gradient-to-r from-accent/15 to-transparent p-5 transition hover:border-accent"
          >
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-accent">
                Em andamento
              </p>
              <p className="mt-1 text-lg font-semibold">
                {open.workoutDay
                  ? `Treino ${open.workoutDay.label}${open.workoutDay.name ? ` · ${open.workoutDay.name}` : ''}`
                  : 'Treino livre'}
              </p>
              <p className="mt-0.5 text-xs text-ink-muted">
                {open.sets.length} série(s) registrada(s) — toque para retomar
              </p>
            </div>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent text-base">
              <IconPlay size={20} />
            </span>
          </Link>
        )}

        {startError && (
          <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            {startError}
          </p>
        )}

        {/* ── Plano ativo ─────────────────────────────────────── */}
        <QueryState query={planQuery}>
          {(plan) =>
            plan ? (
              <section className="mb-6">
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="card-title">{plan.name}</h2>
                  <span className="text-[11px] text-ink-faint">
                    {SPLIT_LABEL[plan.split] ?? plan.split}
                  </span>
                </div>

                <div className="space-y-3">
                  {plan.days.map((day) => {
                    const suggestedToday = day.weekdays.includes(today);
                    const totalSets = day.exercises.reduce((sum, item) => sum + item.sets, 0);
                    return (
                      <article
                        key={day.id}
                        className={`card flex items-center justify-between gap-4 ${
                          suggestedToday ? 'border-accent/40' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-elevated text-sm font-bold text-accent">
                              {day.label}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">
                                {day.name ?? `Treino ${day.label}`}
                              </p>
                              <p className="text-xs text-ink-faint">
                                {day.exercises.length} exercício(s) · {totalSets} séries
                                {day.weekdays.length > 0 &&
                                  ` · ${day.weekdays.map((d) => WEEKDAY_SHORT[d]).join(', ')}`}
                              </p>
                            </div>
                          </div>
                          {suggestedToday && (
                            <p className="mt-1.5 text-[11px] font-medium text-accent">
                              Sugerido para hoje
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() =>
                            startMutation.mutate({ workoutDayId: day.id, workoutPlanId: plan.id })
                          }
                          disabled={startMutation.isPending || Boolean(open)}
                          className="btn-primary shrink-0 px-3.5 py-2 text-xs"
                          title={open ? 'Finalize a sessão aberta antes' : undefined}
                        >
                          <IconPlay size={14} />
                          Iniciar
                        </button>
                      </article>
                    );
                  })}
                </div>
              </section>
            ) : (
              <section className="card mb-6 text-center">
                <IconDumbbell size={28} className="mx-auto text-ink-faint" />
                <p className="mt-2 text-sm font-medium">Nenhum plano ativo</p>
                <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">
                  Peça um plano ao seu professor, ou treine livre registrando exercícios do
                  catálogo.
                </p>
              </section>
            )
          }
        </QueryState>

        {/* ── Treino livre ────────────────────────────────────── */}
        {!open && (
          <button
            onClick={() => startMutation.mutate({})}
            disabled={startMutation.isPending}
            className="btn-ghost mb-8 w-full justify-center"
          >
            <IconPlay size={15} />
            {startMutation.isPending ? 'Iniciando…' : 'Começar treino livre'}
          </button>
        )}

        {/* ── Histórico ───────────────────────────────────────── */}
        <section>
          <h2 className="card-title mb-3">Sessões recentes</h2>
          <QueryState
            query={sessionsQuery}
            isEmpty={(data) => data.filter((s) => s.status !== 'IN_PROGRESS').length === 0}
            emptyMessage="Nenhuma sessão finalizada ainda. Bora começar?"
          >
            {(sessions) => (
              <ul className="space-y-2">
                {sessions
                  .filter((session) => session.status !== 'IN_PROGRESS')
                  .slice(0, 10)
                  .map((session) => (
                    <li
                      key={session.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {session.workoutDay
                            ? `Treino ${session.workoutDay.label}${session.workoutDay.name ? ` · ${session.workoutDay.name}` : ''}`
                            : 'Treino livre'}
                          {session.status === 'ABANDONED' && (
                            <span className="ml-2 text-[10px] uppercase text-warning">
                              abandonado
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink-faint">
                          {formatDate(session.startedAt)} · {session._count.sets} séries
                          {session.durationSeconds
                            ? ` · ${formatDuration(session.durationSeconds)}`
                            : ''}
                          {session.totalVolumeLoad
                            ? ` · ${formatVolume(session.totalVolumeLoad)}`
                            : ''}
                        </p>
                      </div>
                      {session.rating && (
                        <span className="shrink-0 text-xs text-warning">
                          {'★'.repeat(session.rating)}
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </QueryState>
        </section>

        <Link
          href="/evolucao"
          className="mt-4 inline-flex items-center gap-1 text-xs text-accent underline-offset-2 hover:underline"
        >
          Ver evolução completa
          <IconChevronRight size={13} />
        </Link>
      </div>
    </AppShell>
  );
}
