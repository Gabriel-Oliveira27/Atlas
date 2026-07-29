'use client';

/**
 * Execução da sessão de treino — a tela usada com o celular na mão,
 * entre séries. As decisões de UI seguem disso:
 *
 *   • Registrar uma série é UM toque (o formulário vem pré-preenchido
 *     com a última carga do exercício ou a meta do plano).
 *   • O cronômetro de descanso dispara sozinho ao registrar e vibra ao
 *     terminar (quando o aparelho suporta).
 *   • A escrita é otimista: a série entra na lista antes da resposta.
 *
 * Funciona tanto para sessão guiada por plano (prescrição do dia) quanto
 * para treino livre (exercícios adicionados do catálogo na hora).
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type {
  ExerciseListItem,
  OpenSession,
  PlanExercise,
  SetLog,
  SetTechnique,
  WorkoutPlan,
} from '@/lib/types';
import { formatClock } from '@/lib/format';
import { AppShell } from '@/components/app-shell';
import { Modal } from '@/components/modal';
import { QueryState } from '@/components/query-state';
import {
  IconCheck,
  IconChevronLeft,
  IconPlus,
  IconSearch,
  IconTimer,
  IconX,
} from '@/components/icons';

const TECHNIQUE_LABEL: Record<SetTechnique, string> = {
  NORMAL: '',
  SUPERSET: 'Supersérie',
  BISET: 'Bi-set',
  TRISET: 'Tri-set',
  GIANT_SET: 'Série gigante',
  DROPSET: 'Dropset',
  REST_PAUSE: 'Rest-pause',
  CLUSTER: 'Cluster',
  PYRAMID: 'Pirâmide',
  ISOMETRIC: 'Isometria',
};

const DEFAULT_REST_SECONDS = 90;

/** Exercício exibido na sessão: prescrição do plano ou adição livre. */
interface SessionExercise {
  exerciseId: string;
  name: string;
  muscleGroup: string;
  prescription: PlanExercise | null;
}

interface RestTimer {
  endsAt: number;
  totalSeconds: number;
}

export default function SessaoPage() {
  const router = useRouter();

  const openQuery = useQuery({
    queryKey: ['workout', 'open'],
    queryFn: () => api.get<OpenSession | null>('/workouts/sessions/open'),
  });

  const planQuery = useQuery({
    queryKey: ['workout', 'plan-active'],
    queryFn: () => api.get<WorkoutPlan | null>('/workouts/plans/active'),
    staleTime: 5 * 60_000,
  });

  const session = openQuery.data;

  // Sem sessão aberta não há o que executar — volta para o hub.
  useEffect(() => {
    if (openQuery.isSuccess && !session) router.replace('/treino');
  }, [openQuery.isSuccess, session, router]);

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-5 md:p-8">
        <QueryState query={openQuery}>
          {(data) => (data ? <SessionRunner session={data} plan={planQuery.data ?? null} /> : null)}
        </QueryState>
      </div>
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────

function SessionRunner({ session, plan }: { session: OpenSession; plan: WorkoutPlan | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [rest, setRest] = useState<RestTimer | null>(null);
  const [restRemaining, setRestRemaining] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Exercícios adicionados na hora (treino livre / extra). Persistidos em
   * sessionStorage por sessão: um F5 no meio do treino não pode apagar a
   * lista do usuário.
   */
  const storageKey = `atlas.session-extras.${session.id}`;
  const [extras, setExtras] = useState<SessionExercise[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = window.sessionStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as SessionExercise[]) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    window.sessionStorage.setItem(storageKey, JSON.stringify(extras));
  }, [extras, storageKey]);

  // Dia prescrito desta sessão, quando ela veio de um plano.
  const planDay = useMemo(
    () => plan?.days.find((day) => day.id === session.workoutDayId) ?? null,
    [plan, session.workoutDayId],
  );

  const exercises = useMemo<SessionExercise[]>(() => {
    const fromPlan: SessionExercise[] =
      planDay?.exercises.map((item) => ({
        exerciseId: item.exerciseId,
        name: item.exercise.name,
        muscleGroup: item.exercise.muscleGroup.name,
        prescription: item,
      })) ?? [];

    const planIds = new Set(fromPlan.map((item) => item.exerciseId));
    return [...fromPlan, ...extras.filter((item) => !planIds.has(item.exerciseId))];
  }, [planDay, extras]);

  const setsByExercise = useMemo(() => {
    const map = new Map<string, SetLog[]>();
    for (const set of session.sets) {
      const list = map.get(set.exerciseId) ?? [];
      list.push(set);
      map.set(set.exerciseId, list);
    }
    return map;
  }, [session.sets]);

  // Exercício "atual": o primeiro com menos séries feitas que o prescrito.
  const currentExerciseId = useMemo(() => {
    for (const item of exercises) {
      const done = (setsByExercise.get(item.exerciseId) ?? []).filter((s) => !s.isWarmup).length;
      const target = item.prescription?.sets ?? 0;
      if (target === 0 || done < target) return item.exerciseId;
    }
    return exercises[0]?.exerciseId ?? null;
  }, [exercises, setsByExercise]);

  const activeId = expandedId ?? currentExerciseId;

  // ── Cronômetros ───────────────────────────────────────────────

  useEffect(() => {
    const startedAt = new Date(session.startedAt).getTime();
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [session.startedAt]);

  useEffect(() => {
    if (!rest) return;

    const tick = () => {
      const remaining = Math.ceil((rest.endsAt - Date.now()) / 1000);
      setRestRemaining(Math.max(0, remaining));
      if (remaining <= 0) {
        setRest(null);
        // Aviso tátil de fim de descanso — ignorado onde não há suporte.
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([180, 90, 180]);
        }
      }
    };

    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [rest]);

  const startRest = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setRest({ endsAt: Date.now() + seconds * 1000, totalSeconds: seconds });
  }, []);

  // ── Registro de série (otimista) ──────────────────────────────

  const logSetMutation = useMutation({
    mutationFn: (input: {
      exerciseId: string;
      setNumber: number;
      reps: number;
      weightKg: number;
      technique: SetTechnique;
      rpe?: number;
      isWarmup: boolean;
      restSeconds: number;
    }) =>
      api.post<SetLog>(`/workouts/sessions/${session.id}/sets`, {
        ...input,
        completedAt: new Date().toISOString(),
      }),

    onMutate: async (input) => {
      setError(null);
      await queryClient.cancelQueries({ queryKey: ['workout', 'open'] });
      const previous = queryClient.getQueryData<OpenSession>(['workout', 'open']);

      if (previous) {
        const optimistic: SetLog = {
          id: `otimista-${Date.now()}`,
          exerciseId: input.exerciseId,
          setNumber: input.setNumber,
          reps: input.reps,
          weightKg: input.weightKg,
          technique: input.technique,
          rpe: input.rpe ?? null,
          rir: null,
          isWarmup: input.isWarmup,
          completedAt: new Date().toISOString(),
          notes: null,
        };
        queryClient.setQueryData<OpenSession>(['workout', 'open'], {
          ...previous,
          sets: [...previous.sets, optimistic],
        });
      }

      return { previous };
    },

    onError: (err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['workout', 'open'], context.previous);
      }
      setError(err instanceof ApiError ? err.message : 'Não foi possível registrar a série.');
    },

    onSuccess: (_data, input) => {
      // Aquecimento não conta descanso cheio; série válida dispara o timer.
      if (!input.isWarmup) startRest(input.restSeconds);
    },

    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['workout', 'open'] });
    },
  });

  // ── Finalização ───────────────────────────────────────────────

  const finishMutation = useMutation({
    mutationFn: (input: { status: 'COMPLETED' | 'ABANDONED'; rating?: number; notes?: string }) =>
      api.post<{ totalVolumeLoad: number | null; durationSeconds: number | null }>(
        `/workouts/sessions/${session.id}/finish`,
        { ...input, finishedAt: new Date().toISOString() },
      ),
    onSuccess: () => {
      window.sessionStorage.removeItem(storageKey);
      void queryClient.invalidateQueries({ queryKey: ['workout'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      router.replace('/treino');
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível finalizar.');
      setFinishOpen(false);
    },
  });

  const totalSetsDone = session.sets.filter((set) => !set.isWarmup).length;

  return (
    <>
      {/* ── Cabeçalho da sessão ─────────────────────────────── */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <button
            onClick={() => router.push('/treino')}
            aria-label="Voltar"
            className="-ml-2 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            <IconChevronLeft size={20} />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {session.workoutDay
                ? `Treino ${session.workoutDay.label}${session.workoutDay.name ? ` · ${session.workoutDay.name}` : ''}`
                : 'Treino livre'}
            </h1>
            <p className="text-xs tabular-nums text-ink-muted">
              {formatClock(elapsed)} · {totalSetsDone} série(s)
            </p>
          </div>
        </div>
        <button
          onClick={() => setFinishOpen(true)}
          className="btn-primary shrink-0 px-3.5 py-2 text-xs"
        >
          <IconCheck size={14} />
          Finalizar
        </button>
      </header>

      {error && (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </p>
      )}

      {/* ── Lista de exercícios ─────────────────────────────── */}
      {exercises.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm font-medium">Treino livre</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-muted">
            Adicione exercícios do catálogo e registre suas séries.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {exercises.map((item) => (
            <ExerciseCard
              key={item.exerciseId}
              item={item}
              sets={setsByExercise.get(item.exerciseId) ?? []}
              expanded={activeId === item.exerciseId}
              onToggle={() => setExpandedId(activeId === item.exerciseId ? '' : item.exerciseId)}
              onLogSet={(values) => logSetMutation.mutate(values)}
              pending={logSetMutation.isPending}
            />
          ))}
        </div>
      )}

      <button onClick={() => setPickerOpen(true)} className="btn-ghost mt-4 w-full justify-center">
        <IconPlus size={15} />
        Adicionar exercício
      </button>

      {/* ── Cronômetro de descanso ──────────────────────────── */}
      {rest && (
        <div className="bottom-tabbar fixed inset-x-0 z-30">
          <div className="mx-auto flex max-w-2xl items-center gap-3 border-t border-accent/30 bg-elevated/95 px-5 py-3 backdrop-blur md:rounded-t-2xl md:border-x">
            <IconTimer size={18} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-ink-muted">Descanso</span>
                <span className="text-lg font-semibold tabular-nums text-accent">
                  {formatClock(restRemaining)}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{ width: `${(restRemaining / rest.totalSeconds) * 100}%` }}
                />
              </div>
            </div>
            <button
              onClick={() => setRest(null)}
              className="shrink-0 rounded-lg border border-border px-2.5 py-1.5 text-xs text-ink-muted transition hover:bg-surface"
            >
              Pular
            </button>
          </div>
        </div>
      )}

      {/* ── Modais ──────────────────────────────────────────── */}
      {finishOpen && (
        <FinishModal
          onClose={() => setFinishOpen(false)}
          onFinish={(input) => finishMutation.mutate(input)}
          pending={finishMutation.isPending}
          totalSets={totalSetsDone}
        />
      )}

      {pickerOpen && (
        <ExercisePicker
          onClose={() => setPickerOpen(false)}
          onSelect={(exercise) => {
            setExtras((current) =>
              current.some((item) => item.exerciseId === exercise.id)
                ? current
                : [
                    ...current,
                    {
                      exerciseId: exercise.id,
                      name: exercise.name,
                      muscleGroup: exercise.muscleGroup.name,
                      prescription: null,
                    },
                  ],
            );
            setExpandedId(exercise.id);
            setPickerOpen(false);
          }}
        />
      )}
    </>
  );
}

// ────────────────────────────────────────────────────────────────

function ExerciseCard({
  item,
  sets,
  expanded,
  onToggle,
  onLogSet,
  pending,
}: {
  item: SessionExercise;
  sets: SetLog[];
  expanded: boolean;
  onToggle: () => void;
  onLogSet: (values: {
    exerciseId: string;
    setNumber: number;
    reps: number;
    weightKg: number;
    technique: SetTechnique;
    rpe?: number;
    isWarmup: boolean;
    restSeconds: number;
  }) => void;
  pending: boolean;
}) {
  const prescription = item.prescription;
  const workSets = sets.filter((set) => !set.isWarmup);
  const targetSets = prescription?.sets ?? null;
  const done = targetSets !== null && workSets.length >= targetSets;
  const technique = prescription?.technique ?? 'NORMAL';

  return (
    <article
      className={`card p-0 transition ${expanded ? 'border-accent/40' : ''} ${
        done ? 'opacity-75' : ''
      }`}
    >
      <button onClick={onToggle} className="flex w-full items-center gap-3 p-4 text-left">
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg text-xs font-bold tabular-nums ${
            done ? 'bg-positive/15 text-positive' : 'bg-elevated text-accent'
          }`}
        >
          {done ? <IconCheck size={16} /> : `${workSets.length}/${targetSets ?? '—'}`}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.name}</p>
          <p className="truncate text-xs text-ink-faint">
            {item.muscleGroup}
            {prescription && ` · ${prescription.sets}× ${prescription.reps}`}
            {prescription?.targetWeightKg ? ` · ${prescription.targetWeightKg} kg` : ''}
            {prescription?.tempo ? ` · tempo ${prescription.tempo}` : ''}
          </p>
        </div>
        {technique !== 'NORMAL' && (
          <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            {TECHNIQUE_LABEL[technique]}
            {prescription?.groupKey ? ` ${prescription.groupKey}` : ''}
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border p-4">
          {prescription?.notes && (
            <p className="mb-3 rounded-lg bg-elevated px-3 py-2 text-xs leading-relaxed text-ink-muted">
              {prescription.notes}
            </p>
          )}

          {sets.length > 0 && (
            <ul className="mb-3 space-y-1.5">
              {sets.map((set) => (
                <li
                  key={set.id}
                  className="flex items-center justify-between rounded-lg bg-elevated/60 px-3 py-1.5 text-xs tabular-nums"
                >
                  <span className="text-ink-faint">
                    {set.isWarmup ? 'Aq.' : `#${set.setNumber}`}
                  </span>
                  <span className="font-medium">
                    {set.weightKg} kg × {set.reps}
                    {set.rpe ? (
                      <span className="ml-1.5 font-normal text-ink-faint">RPE {set.rpe}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <SetForm
            key={sets.length}
            item={item}
            sets={sets}
            pending={pending}
            onSubmit={onLogSet}
          />
        </div>
      )}
    </article>
  );
}

// ────────────────────────────────────────────────────────────────

/** Menor número de uma faixa "8-12" → 8; "10" → 10. */
function lowerBoundReps(range: string | undefined): number {
  if (!range) return 10;
  const first = Number(range.split('-')[0]);
  return Number.isFinite(first) && first > 0 ? first : 10;
}

function SetForm({
  item,
  sets,
  pending,
  onSubmit,
}: {
  item: SessionExercise;
  sets: SetLog[];
  pending: boolean;
  onSubmit: (values: {
    exerciseId: string;
    setNumber: number;
    reps: number;
    weightKg: number;
    technique: SetTechnique;
    rpe?: number;
    isWarmup: boolean;
    restSeconds: number;
  }) => void;
}) {
  const prescription = item.prescription;
  const lastSet = sets.at(-1) ?? null;

  // Pré-preenchimento: última série desta sessão > meta do plano > vazio.
  const [weight, setWeight] = useState(() =>
    String(lastSet?.weightKg ?? prescription?.targetWeightKg ?? ''),
  );
  const [reps, setReps] = useState(() =>
    String(lastSet?.reps ?? lowerBoundReps(prescription?.reps)),
  );
  const [rpe, setRpe] = useState('');
  const [isWarmup, setIsWarmup] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const weightValue = Number(weight.replace(',', '.'));
    const repsValue = Number(reps);
    const rpeValue = rpe === '' ? undefined : Number(rpe.replace(',', '.'));

    if (!Number.isFinite(weightValue) || weightValue < 0 || weightValue > 1000) {
      setLocalError('Carga entre 0 e 1000 kg.');
      return;
    }
    if (!Number.isInteger(repsValue) || repsValue < 0 || repsValue > 500) {
      setLocalError('Repetições entre 0 e 500.');
      return;
    }
    if (rpeValue !== undefined && (rpeValue < 1 || rpeValue > 10 || (rpeValue * 2) % 1 !== 0)) {
      setLocalError('RPE de 1 a 10, em passos de 0,5.');
      return;
    }

    setLocalError(null);
    onSubmit({
      exerciseId: item.exerciseId,
      setNumber: sets.length + 1,
      reps: repsValue,
      weightKg: weightValue,
      technique: prescription?.technique ?? 'NORMAL',
      ...(rpeValue !== undefined ? { rpe: rpeValue } : {}),
      isWarmup,
      restSeconds: prescription?.restSeconds ?? DEFAULT_REST_SECONDS,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label" htmlFor={`peso-${item.exerciseId}`}>
            Carga (kg)
          </label>
          <input
            id={`peso-${item.exerciseId}`}
            type="text"
            inputMode="decimal"
            value={weight}
            onChange={(event) => setWeight(event.target.value)}
            placeholder="0"
            className="input py-2 text-center text-base font-semibold tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor={`reps-${item.exerciseId}`}>
            Reps
          </label>
          <input
            id={`reps-${item.exerciseId}`}
            type="text"
            inputMode="numeric"
            value={reps}
            onChange={(event) => setReps(event.target.value)}
            placeholder="0"
            className="input py-2 text-center text-base font-semibold tabular-nums"
          />
        </div>
        <div>
          <label className="label" htmlFor={`rpe-${item.exerciseId}`}>
            RPE <span className="text-ink-faint">(opc.)</span>
          </label>
          <input
            id={`rpe-${item.exerciseId}`}
            type="text"
            inputMode="decimal"
            value={rpe}
            onChange={(event) => setRpe(event.target.value)}
            placeholder="—"
            className="input py-2 text-center text-base font-semibold tabular-nums"
          />
        </div>
      </div>

      {localError && <p className="mt-2 text-xs text-danger">{localError}</p>}

      <div className="mt-3 flex items-center justify-between gap-3">
        <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-muted">
          <input
            type="checkbox"
            checked={isWarmup}
            onChange={(event) => setIsWarmup(event.target.checked)}
            className="h-4 w-4 rounded border-border bg-surface accent-[#38BDF8]"
          />
          Aquecimento
        </label>
        <button type="submit" disabled={pending} className="btn-primary px-5 py-2 text-xs">
          <IconCheck size={14} />
          Registrar série
        </button>
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────

function FinishModal({
  onClose,
  onFinish,
  pending,
  totalSets,
}: {
  onClose: () => void;
  onFinish: (input: { status: 'COMPLETED' | 'ABANDONED'; rating?: number; notes?: string }) => void;
  pending: boolean;
  totalSets: number;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  return (
    <Modal title="Finalizar treino" onClose={onClose}>
      <p className="text-sm text-ink-muted">
        {totalSets > 0
          ? `${totalSets} série(s) registrada(s). Como foi a sessão?`
          : 'Nenhuma série registrada nesta sessão.'}
      </p>

      <div className="mt-4 flex justify-center gap-2">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            onClick={() => setRating(rating === value ? null : value)}
            aria-label={`${value} de 5`}
            className={`grid h-11 w-11 place-items-center rounded-xl border text-lg transition ${
              rating !== null && value <= rating
                ? 'border-warning bg-warning/15 text-warning'
                : 'border-border bg-surface text-ink-faint hover:bg-elevated'
            }`}
          >
            ★
          </button>
        ))}
      </div>

      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Observações (opcional)"
        rows={2}
        maxLength={1000}
        className="input mt-4 resize-none"
      />

      <div className="mt-4 space-y-2">
        <button
          onClick={() =>
            onFinish({
              status: 'COMPLETED',
              ...(rating ? { rating } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            })
          }
          disabled={pending}
          className="btn-primary w-full justify-center"
        >
          <IconCheck size={15} />
          {pending ? 'Finalizando…' : 'Concluir treino'}
        </button>
        <button
          onClick={() => onFinish({ status: 'ABANDONED' })}
          disabled={pending}
          className="btn-danger w-full justify-center text-xs"
        >
          <IconX size={14} />
          Abandonar sessão
        </button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────

function ExercisePicker({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (exercise: ExerciseListItem) => void;
}) {
  const [search, setSearch] = useState('');

  const query = useQuery({
    queryKey: ['exercises', 'picker', search],
    queryFn: () => {
      const params = new URLSearchParams({ pageSize: '30' });
      if (search.trim()) params.set('search', search.trim());
      return api.get<ExerciseListItem[]>(`/exercises?${params.toString()}`);
    },
  });

  return (
    <Modal title="Adicionar exercício" onClose={onClose}>
      <div className="relative">
        <IconSearch
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
        />
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar exercício…"
          className="input pl-9"
        />
      </div>

      <div className="mt-3 max-h-72 space-y-1.5 overflow-y-auto">
        {query.isLoading && (
          <div className="h-20 animate-pulse rounded-lg bg-elevated" aria-busy="true" />
        )}
        {query.data?.length === 0 && (
          <p className="py-6 text-center text-sm text-ink-faint">Nenhum exercício encontrado.</p>
        )}
        {query.data?.map((exercise) => (
          <button
            key={exercise.id}
            onClick={() => onSelect(exercise)}
            className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-elevated/50 px-3 py-2.5 text-left transition hover:border-accent"
          >
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{exercise.name}</span>
              <span className="text-xs text-ink-faint">{exercise.muscleGroup.name}</span>
            </span>
            <IconPlus size={16} className="shrink-0 text-accent" />
          </button>
        ))}
      </div>
    </Modal>
  );
}
