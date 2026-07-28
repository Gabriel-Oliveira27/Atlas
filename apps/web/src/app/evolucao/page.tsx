'use client';

/**
 * Evolução — peso ao longo do tempo e volume por sessão.
 *
 * Os dois gráficos respondem a perguntas diferentes: o peso mostra a
 * tendência corporal; o volume mostra se o treino está progredindo. Ficam
 * em cards separados justamente para não induzir a compará-los num eixo
 * comum, que não existe entre kg de corpo e kg × reps.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { SessionListItem, UserProfile, WeightLogItem } from '@/lib/types';
import { formatDate, formatDuration, formatVolume, formatWeight } from '@/lib/format';
import { AppShell } from '@/components/app-shell';
import { BarChart, LineChart } from '@/components/charts';
import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/query-state';
import { IconPlus, IconScale } from '@/components/icons';

export default function EvolucaoPage() {
  const [weightOpen, setWeightOpen] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<UserProfile>('/users/me'),
  });

  const weightQuery = useQuery({
    queryKey: ['weight', 'history'],
    queryFn: () => api.get<WeightLogItem[]>('/users/me/weight/history'),
  });

  const sessionsQuery = useQuery({
    queryKey: ['workout', 'sessions'],
    queryFn: () => api.get<SessionListItem[]>('/workouts/sessions'),
  });

  const profile = profileQuery.data;

  // A API devolve o histórico do mais recente para o mais antigo; o
  // gráfico lê da esquerda (antigo) para a direita (recente).
  const weightPoints =
    weightQuery.data
      ?.slice()
      .reverse()
      .map((log) => ({ label: formatDate(log.measuredAt), value: log.weightKg })) ?? [];

  const volumeBars =
    sessionsQuery.data
      ?.filter((session) => session.status === 'COMPLETED' && session.totalVolumeLoad)
      .slice(0, 20)
      .reverse()
      .map((session) => ({
        label: formatDate(session.startedAt),
        value: session.totalVolumeLoad ?? 0,
      })) ?? [];

  const first = weightPoints[0]?.value;
  const last = weightPoints.at(-1)?.value;
  const delta = first !== undefined && last !== undefined ? last - first : null;

  return (
    <AppShell>
      <div className="mx-auto max-w-4xl p-5 md:p-8">
        <PageHeader
          title="Evolução"
          subtitle="Peso corporal e volume de treino"
          action={
            <button onClick={() => setWeightOpen(true)} className="btn-primary px-3.5 py-2 text-xs">
              <IconPlus size={14} />
              Peso
            </button>
          }
        />

        {/* ── Resumo ──────────────────────────────────────────── */}
        <div className="mb-5 grid gap-4 sm:grid-cols-3">
          <section className="card">
            <h2 className="card-title">Peso atual</h2>
            <p className="stat mt-3">
              {profile?.weightKg ? formatWeight(profile.weightKg) : '—'}
              {profile?.weightKg && (
                <span className="ml-1 text-base font-normal text-ink-faint">kg</span>
              )}
            </p>
            {delta !== null && Math.abs(delta) >= 0.1 && (
              <p
                className={`mt-1 text-xs font-medium ${delta < 0 ? 'text-positive' : 'text-warning'}`}
              >
                {delta > 0 ? '+' : ''}
                {formatWeight(delta)} kg desde o primeiro registro
              </p>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">Meta</h2>
            <p className="stat mt-3">
              {profile?.targetWeightKg ? formatWeight(profile.targetWeightKg) : '—'}
              {profile?.targetWeightKg && (
                <span className="ml-1 text-base font-normal text-ink-faint">kg</span>
              )}
            </p>
            <p className="mt-1 text-xs text-ink-muted">
              {profile?.targetWeightKg && profile.weightKg
                ? `faltam ${formatWeight(Math.abs(profile.weightKg - profile.targetWeightKg))} kg`
                : 'não definida'}
            </p>
          </section>

          <section className="card">
            <h2 className="card-title">IMC</h2>
            <p className="stat mt-3">{profile?.bmi ? profile.bmi.toFixed(1) : '—'}</p>
            <p className="mt-1 text-xs text-ink-muted">
              {profile?.bmi ? bmiLabel(profile.bmi) : 'informe altura e peso'}
            </p>
          </section>
        </div>

        {/* ── Gráfico de peso ─────────────────────────────────── */}
        <section className="card mb-4">
          <h2 className="card-title mb-4">Peso ao longo do tempo</h2>
          <QueryState
            query={weightQuery}
            variant="bare"
            isEmpty={(data) => data.length < 2}
            emptyMessage="Registre seu peso ao menos duas vezes para ver a tendência."
          >
            {() => <LineChart points={weightPoints} unit="kg" formatValue={formatWeight} />}
          </QueryState>
        </section>

        {/* ── Gráfico de volume ───────────────────────────────── */}
        <section className="card mb-4">
          <h2 className="card-title mb-1">Volume por sessão</h2>
          <p className="mb-4 text-xs text-ink-faint">
            Soma de séries × repetições × carga, sem aquecimento
          </p>
          <QueryState
            query={sessionsQuery}
            variant="bare"
            isEmpty={() => volumeBars.length === 0}
            emptyMessage="Finalize um treino para acompanhar o volume."
          >
            {() => <BarChart bars={volumeBars} unit="kg" />}
          </QueryState>
        </section>

        {/* ── Histórico de sessões ────────────────────────────── */}
        <section>
          <h2 className="card-title mb-3">Histórico de treinos</h2>
          <QueryState
            query={sessionsQuery}
            isEmpty={(data) => data.filter((s) => s.status !== 'IN_PROGRESS').length === 0}
            emptyMessage="Nenhuma sessão finalizada ainda."
          >
            {(sessions) => (
              <ul className="space-y-2">
                {sessions
                  .filter((session) => session.status !== 'IN_PROGRESS')
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
                        </p>
                        <p className="text-xs text-ink-faint">
                          {formatDate(session.startedAt)} · {session._count.sets} séries
                          {session.durationSeconds
                            ? ` · ${formatDuration(session.durationSeconds)}`
                            : ''}
                        </p>
                      </div>
                      {session.totalVolumeLoad ? (
                        <span className="shrink-0 text-sm font-medium tabular-nums text-accent">
                          {formatVolume(session.totalVolumeLoad)}
                        </span>
                      ) : (
                        <span className="shrink-0 text-[10px] uppercase text-warning">
                          abandonado
                        </span>
                      )}
                    </li>
                  ))}
              </ul>
            )}
          </QueryState>
        </section>
      </div>

      {weightOpen && (
        <WeightModal current={profile?.weightKg ?? null} onClose={() => setWeightOpen(false)} />
      )}
    </AppShell>
  );
}

function bmiLabel(bmi: number): string {
  if (bmi < 18.5) return 'abaixo do peso';
  if (bmi < 25) return 'faixa saudável';
  if (bmi < 30) return 'sobrepeso';
  return 'obesidade';
}

// ────────────────────────────────────────────────────────────────

function WeightModal({ current, onClose }: { current: number | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(current ? String(current) : '');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (weightKg: number) =>
      api.post('/users/me/weight', { weightKg, measuredAt: new Date().toISOString() }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['weight'] });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      onClose();
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar o peso.');
    },
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const weight = Number(value.replace(',', '.'));

    // Mesma faixa do schema da API (weightKgSchema): erra aqui e o
    // usuário descobre antes de gastar uma ida à rede.
    if (!Number.isFinite(weight) || weight < 20 || weight > 400) {
      setError('Informe um peso entre 20 e 400 kg.');
      return;
    }

    setError(null);
    mutation.mutate(weight);
  }

  return (
    <Modal title="Registrar peso" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p className="mb-4 text-sm text-ink-muted">
          Um registro por dia — pesar de novo hoje substitui o valor anterior.
        </p>

        <label className="label" htmlFor="peso">
          Peso (kg)
        </label>
        <div className="flex items-center gap-2">
          <IconScale size={20} className="shrink-0 text-ink-faint" />
          <input
            id="peso"
            autoFocus
            type="text"
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="00,0"
            className="input text-center text-lg font-semibold tabular-nums"
          />
        </div>

        {error && <p className="mt-2 text-xs text-danger">{error}</p>}

        <button
          type="submit"
          disabled={mutation.isPending}
          className="btn-primary mt-4 w-full justify-center"
        >
          {mutation.isPending ? 'Salvando…' : 'Salvar'}
        </button>
      </form>
    </Modal>
  );
}
