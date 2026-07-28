'use client';

/**
 * Hidratação — a tela funcional do protótipo.
 *
 * Registra de verdade na API. Usa atualização otimista: o anel se move
 * assim que você toca no botão, sem esperar a resposta. Entre séries, o
 * usuário não deveria ficar olhando para um spinner.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { ProgressRing } from '@/components/progress-ring';
import { QueryState } from '@/components/query-state';

interface DaySummary {
  dayKey: string;
  totalMl: number;
  goalMl: number;
  remainingMl: number;
  percentage: number;
  goalReached: boolean;
  entries: Array<{ id: string; amountMl: number; drinkType: string; consumedAt: string }>;
}

const QUICK_AMOUNTS = [200, 300, 500];

export default function HidratacaoPage() {
  const queryClient = useQueryClient();
  const [custom, setCustom] = useState('');
  const [error, setError] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['hydration', 'today'],
    queryFn: () => api.get<DaySummary>('/hydration/today'),
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

      const previous = queryClient.getQueryData<DaySummary>(['hydration', 'today']);

      if (previous) {
        const totalMl = previous.totalMl + amountMl;
        queryClient.setQueryData<DaySummary>(['hydration', 'today'], {
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
      void queryClient.invalidateQueries({ queryKey: ['hydration', 'today'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
    },
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

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-5 md:p-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Hidratação</h1>

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
                      <span className="text-positive">Meta do dia atingida ✓</span>
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
                      className="rounded-card border border-border bg-surface py-5 text-center transition hover:border-accent hover:bg-elevated disabled:opacity-50"
                    >
                      <span className="block text-xl font-semibold">{amount}</span>
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
                    className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-ink-faint focus:border-accent"
                  />
                  <button
                    onClick={handleCustom}
                    disabled={logMutation.isPending || !custom}
                    className="rounded-lg bg-accent px-4 text-sm font-medium text-base disabled:opacity-50"
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
                        className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-2.5"
                      >
                        <span className="text-sm font-medium tabular-nums">
                          {entry.amountMl} ml
                        </span>
                        <span className="text-xs text-ink-faint tabular-nums">
                          {new Date(entry.consumedAt).toLocaleTimeString('pt-BR', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </QueryState>
      </div>
    </AppShell>
  );
}
