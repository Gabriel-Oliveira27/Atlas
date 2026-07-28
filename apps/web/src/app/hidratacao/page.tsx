'use client';

/**
 * Hidratação.
 *
 * Atualização otimista: o anel se move assim que você toca no botão, sem
 * esperar a resposta. Entre séries, o usuário não deveria ficar olhando
 * para um spinner.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { HydrationDaySummary, HydrationHistoryDay, HydrationReminder } from '@/lib/types';
import { dayKeyToDate, formatDate, formatTime } from '@/lib/format';
import { AppShell } from '@/components/app-shell';
import { BarChart } from '@/components/charts';
import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { ProgressRing } from '@/components/progress-ring';
import { QueryState } from '@/components/query-state';
import { IconBell, IconCheck, IconDroplet, IconX } from '@/components/icons';

const QUICK_AMOUNTS = [200, 300, 500];

export default function HidratacaoPage() {
  const queryClient = useQueryClient();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const query = useQuery({
    queryKey: ['hydration', 'today'],
    queryFn: () => api.get<HydrationDaySummary>('/hydration/today'),
  });

  const historyQuery = useQuery({
    queryKey: ['hydration', 'history'],
    queryFn: () => api.get<HydrationHistoryDay[]>('/hydration/history?pageSize=30'),
  });

  const logMutation = useMutation({
    mutationFn: (amountMl: number) =>
      api.post('/hydration/logs', {
        amountMl,
        drinkType: 'WATER',
        consumedAt: new Date().toISOString(),
        // Idempotência: se a requisição for reenviada, a API devolve o
        // mesmo registro em vez de contar água duas vezes.
        clientGeneratedId: crypto.randomUUID(),
      }),

    onMutate: async (amountMl) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ['hydration', 'today'] });

      const previous = queryClient.getQueryData<HydrationDaySummary>(['hydration', 'today']);

      if (previous) {
        const totalMl = previous.totalMl + amountMl;
        queryClient.setQueryData<HydrationDaySummary>(['hydration', 'today'], {
          ...previous,
          totalMl,
          remainingMl: Math.max(0, previous.goalMl - totalMl),
          percentage:
            previous.goalMl > 0 ? Math.min(100, Math.round((totalMl / previous.goalMl) * 100)) : 0,
          goalReached: totalMl >= previous.goalMl,
        });
      }

      return { previous };
    },

    // Falhou: desfaz a atualização otimista para a tela não mentir.
    onError: (err, _amount, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['hydration', 'today'], context.previous);
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar.');
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['hydration'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/hydration/logs/${id}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['hydration'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Não foi possível remover o registro.'),
  });

  function handleCustom() {
    const amount = Number(custom);
    if (!Number.isFinite(amount) || amount < 10 || amount > 5000) {
      setError('Informe um valor entre 10 e 5000 ml.');
      return;
    }
    logMutation.mutate(amount);
    setCustom('');
  }

  const goalMl = query.data?.goalMl;

  // A API devolve do dia mais recente para o mais antigo; o gráfico lê
  // no sentido do tempo.
  const historyBars =
    historyQuery.data
      ?.slice()
      .reverse()
      .map((day) => ({ label: formatDate(dayKeyToDate(day.dayKey)), value: day.totalMl })) ?? [];

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-5 md:p-8">
        <PageHeader
          title="Hidratação"
          action={
            <button onClick={() => setReminderOpen(true)} className="btn-ghost px-3.5 py-2 text-xs">
              <IconBell size={14} />
              Lembretes
            </button>
          }
        />

        <QueryState query={query}>
          {(data) => (
            <>
              <section className="card flex items-center gap-6">
                <ProgressRing percentage={data.percentage} size={104} />
                <div>
                  <p className="stat">
                    {data.totalMl}
                    <span className="ml-1 text-base font-normal text-ink-faint">ml</span>
                  </p>
                  <p className="text-sm text-ink-muted">de {data.goalMl} ml</p>
                  <p className="mt-1 text-sm">
                    {data.goalReached ? (
                      <span className="flex items-center gap-1 text-positive">
                        <IconCheck size={14} />
                        Meta do dia atingida
                      </span>
                    ) : (
                      <span className="text-ink-faint">faltam {data.remainingMl} ml</span>
                    )}
                  </p>
                </div>
              </section>

              <section className="mt-4">
                <h2 className="card-title mb-3">Registrar</h2>
                <div className="grid grid-cols-3 gap-3">
                  {QUICK_AMOUNTS.map((amount) => (
                    <button
                      key={amount}
                      onClick={() => logMutation.mutate(amount)}
                      disabled={logMutation.isPending}
                      className="group rounded-card border border-border bg-surface py-5 text-center transition hover:border-accent hover:bg-elevated active:scale-[0.98] disabled:opacity-50"
                    >
                      <IconDroplet
                        size={18}
                        className="mx-auto mb-1 text-ink-faint transition group-hover:text-accent"
                      />
                      <span className="block text-xl font-semibold tabular-nums">{amount}</span>
                      <span className="text-xs text-ink-faint">ml</span>
                    </button>
                  ))}
                </div>

                <div className="mt-3 flex gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    value={custom}
                    onChange={(event) => setCustom(event.target.value)}
                    onKeyDown={(event) => event.key === 'Enter' && handleCustom()}
                    placeholder="Outro valor (ml)"
                    className="input flex-1"
                  />
                  <button
                    onClick={handleCustom}
                    disabled={logMutation.isPending || !custom}
                    className="btn-primary px-5"
                  >
                    Adicionar
                  </button>
                </div>

                {error && (
                  <p className="mt-2 rounded-lg border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
                    {error}
                  </p>
                )}
              </section>

              <section className="mt-6">
                <h2 className="card-title mb-3">Registros de hoje</h2>
                {data.entries.length === 0 ? (
                  <p className="card text-center text-sm text-ink-faint">
                    Nenhum registro ainda. Toque em um dos botões acima.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {[...data.entries].reverse().map((entry) => (
                      <li
                        key={entry.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-2.5"
                      >
                        <span className="text-sm font-medium tabular-nums">
                          {entry.amountMl} ml
                        </span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-ink-faint">
                            {formatTime(entry.consumedAt)}
                          </span>
                          <button
                            onClick={() => deleteMutation.mutate(entry.id)}
                            disabled={deleteMutation.isPending}
                            aria-label={`Remover registro de ${entry.amountMl} ml`}
                            className="grid h-7 w-7 place-items-center rounded-md text-ink-faint transition hover:bg-elevated hover:text-danger"
                          >
                            <IconX size={14} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </QueryState>

        {/* ── Histórico ───────────────────────────────────────── */}
        <section className="card mt-6">
          <h2 className="card-title mb-1">Últimos dias</h2>
          <p className="mb-4 text-xs text-ink-faint">
            A linha tracejada marca a meta diária; barras verdes bateram a meta
          </p>
          <QueryState
            query={historyQuery}
            variant="bare"
            isEmpty={() => historyBars.length === 0}
            emptyMessage="Ainda sem histórico. Registre água por alguns dias."
          >
            {() => <BarChart bars={historyBars} unit="ml" highlightGoal={goalMl} />}
          </QueryState>
        </section>
      </div>

      {reminderOpen && <ReminderModal onClose={() => setReminderOpen(false)} />}
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────

/** "1h30" em vez de "1.5 hora(s)" — ninguém lê intervalo em decimal. */
function formatInterval(minutes: number): string {
  if (minutes < 60) return `${minutes} minutos`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h${rest}`;
}

function ReminderModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['hydration', 'reminder'],
    queryFn: () => api.get<HydrationReminder | null>('/hydration/reminder'),
  });

  const [form, setForm] = useState<{
    enabled: boolean;
    startTime: string;
    endTime: string;
    intervalMinutes: number;
    skipWhenGoalReached: boolean;
  } | null>(null);

  // Preenche o formulário na primeira leitura, mantendo o que o usuário
  // já tiver mexido depois disso.
  const state = form ?? {
    enabled: query.data?.enabled ?? true,
    startTime: query.data?.startTime ?? '08:00',
    endTime: query.data?.endTime ?? '22:00',
    intervalMinutes: query.data?.intervalMinutes ?? 120,
    skipWhenGoalReached: query.data?.skipWhenGoalReached ?? true,
  };

  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.put('/hydration/reminder', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['hydration', 'reminder'] });
      onClose();
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar os lembretes.'),
  });

  return (
    <Modal title="Lembretes de água" onClose={onClose}>
      <div className="space-y-4">
        <label className="flex items-center justify-between gap-4">
          <span className="text-sm">Lembretes ativos</span>
          <button
            role="switch"
            aria-checked={state.enabled}
            aria-label="Lembretes ativos"
            onClick={() => setForm({ ...state, enabled: !state.enabled })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              state.enabled ? 'bg-accent' : 'bg-elevated'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-base transition-[left] ${
                state.enabled ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="inicio">
              Começa às
            </label>
            <input
              id="inicio"
              type="time"
              value={state.startTime}
              onChange={(event) => setForm({ ...state, startTime: event.target.value })}
              className="input tabular-nums"
            />
          </div>
          <div>
            <label className="label" htmlFor="fim">
              Termina às
            </label>
            <input
              id="fim"
              type="time"
              value={state.endTime}
              onChange={(event) => setForm({ ...state, endTime: event.target.value })}
              className="input tabular-nums"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="intervalo">
            Intervalo entre lembretes
          </label>
          <select
            id="intervalo"
            value={state.intervalMinutes}
            onChange={(event) => setForm({ ...state, intervalMinutes: Number(event.target.value) })}
            className="input"
          >
            {[30, 45, 60, 90, 120, 180, 240].map((minutes) => (
              <option key={minutes} value={minutes}>
                {formatInterval(minutes)}
              </option>
            ))}
          </select>
        </div>

        <label className="flex items-center justify-between gap-4">
          <span className="min-w-0 text-sm">
            Parar ao bater a meta
            <span className="block text-xs text-ink-faint">
              Não lembra mais depois de atingir o objetivo do dia
            </span>
          </span>
          <button
            role="switch"
            aria-checked={state.skipWhenGoalReached}
            aria-label="Parar ao bater a meta"
            onClick={() => setForm({ ...state, skipWhenGoalReached: !state.skipWhenGoalReached })}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${
              state.skipWhenGoalReached ? 'bg-accent' : 'bg-elevated'
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-base transition-[left] ${
                state.skipWhenGoalReached ? 'left-[22px]' : 'left-0.5'
              }`}
            />
          </button>
        </label>

        {error && <p className="text-xs text-danger">{error}</p>}

        <p className="text-xs leading-relaxed text-ink-faint">
          As notificações são entregues pelo aplicativo Android. No navegador, esta configuração
          fica salva e passa a valer quando você instalar o app.
        </p>

        <button
          onClick={() => mutation.mutate(state)}
          disabled={mutation.isPending}
          className="btn-primary w-full justify-center"
        >
          {mutation.isPending ? 'Salvando…' : 'Salvar lembretes'}
        </button>
      </div>
    </Modal>
  );
}
