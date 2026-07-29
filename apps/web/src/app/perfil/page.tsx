'use client';

/**
 * Perfil e configurações.
 *
 * Dois blocos que gravam em rotas diferentes: dados físicos vão para
 * `PATCH /users/me` e as preferências para `PATCH /users/me/preferences`.
 * Cada bloco salva sozinho — um formulário único obrigaria o usuário a
 * mexer em tudo para mudar uma coisa.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { UserProfile } from '@/lib/types';
import { AppShell } from '@/components/app-shell';
import { PageHeader } from '@/components/page-header';
import { QueryState } from '@/components/query-state';
import { clearSession, getSession } from '@/lib/session';
import { IconCheck, IconDroplet, IconLogOut, IconPulse } from '@/components/icons';

const GOALS = [
  { value: 'HYPERTROPHY', label: 'Hipertrofia' },
  { value: 'FAT_LOSS', label: 'Perda de gordura' },
  { value: 'STRENGTH', label: 'Força' },
  { value: 'ENDURANCE', label: 'Resistência' },
  { value: 'HEALTH', label: 'Saúde' },
  { value: 'REHAB', label: 'Reabilitação' },
];

const LEVELS = [
  { value: 'BEGINNER', label: 'Iniciante' },
  { value: 'INTERMEDIATE', label: 'Intermediário' },
  { value: 'ADVANCED', label: 'Avançado' },
];

const ROLE_LABEL: Record<string, string> = {
  USER: 'Aluno',
  PROFESSOR: 'Professor',
  GYM_ADMIN: 'Administrador da academia',
  SUPER_ADMIN: 'Administrador da plataforma',
};

const PREFERENCE_TOGGLES = [
  { key: 'notificationsEnabled', label: 'Notificações', hint: 'Desliga todas de uma vez' },
  { key: 'hydrationRemindersEnabled', label: 'Lembretes de água', hint: null },
  { key: 'workoutRemindersEnabled', label: 'Lembretes de treino', hint: null },
  { key: 'weeklyReportEnabled', label: 'Relatório semanal', hint: 'Resumo gerado por IA' },
  { key: 'syncOnWifiOnly', label: 'Sincronizar só no Wi-Fi', hint: 'Vale para o aplicativo' },
] as const;

export default function PerfilPage() {
  const router = useRouter();

  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get<UserProfile>('/users/me'),
  });

  function handleLogout() {
    const current = getSession();
    void api
      .post('/auth/logout', {
        ...(current?.refreshToken ? { refreshToken: current.refreshToken } : {}),
        allDevices: false,
      })
      .catch(() => undefined);

    clearSession();
    router.replace('/login');
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-5 md:p-8">
        <PageHeader title="Perfil" />

        <QueryState query={query}>
          {(profile) => (
            <>
              {/* ── Identificação ───────────────────────────── */}
              <section className="card mb-4 flex items-center gap-4">
                {profile.avatarUrl ? (
                  // Avatar vem do Google ou do Cloudinary, já dimensionado.
                  <img
                    src={profile.avatarUrl}
                    alt=""
                    className="h-14 w-14 rounded-full object-cover"
                  />
                ) : (
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-gradient-to-br from-accent to-accent-strong text-xl font-bold text-base">
                    {profile.name.charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{profile.name}</p>
                  <p className="truncate text-sm text-ink-muted">{profile.email}</p>
                  <p className="mt-1 inline-block rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
                    {ROLE_LABEL[profile.role] ?? profile.role}
                  </p>
                </div>
              </section>

              {profile.gyms.length > 0 && (
                <section className="card mb-4">
                  <h2 className="card-title">Academia</h2>
                  <p className="mt-2 text-sm">{profile.gyms.map((gym) => gym.name).join(', ')}</p>
                </section>
              )}

              <ProfileForm profile={profile} />
              <WaterGoalCard profile={profile} />
              <PreferencesCard profile={profile} />

              {/* ── Sessão ──────────────────────────────────── */}
              <section className="card mt-4">
                <h2 className="card-title mb-3">Sessão</h2>
                <div className="flex flex-wrap gap-2">
                  <a href="/status" className="btn-ghost text-xs">
                    <IconPulse size={14} />
                    Status do sistema
                  </a>
                  <button onClick={handleLogout} className="btn-danger text-xs">
                    <IconLogOut size={14} />
                    Sair da conta
                  </button>
                </div>
              </section>
            </>
          )}
        </QueryState>
      </div>
    </AppShell>
  );
}

// ────────────────────────────────────────────────────────────────

function ProfileForm({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: profile.name,
    heightCm: profile.heightCm ? String(profile.heightCm) : '',
    weightKg: profile.weightKg ? String(profile.weightKg) : '',
    targetWeightKg: profile.targetWeightKg ? String(profile.targetWeightKg) : '',
    goal: profile.goal,
    experienceLevel: profile.experienceLevel,
  });
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch<UserProfile>('/users/me', body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      setSaved(true);
      setError(null);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.');
      setSaved(false);
    },
  });

  // A confirmação some sozinha — um "salvo ✓" permanente vira ruído.
  useEffect(() => {
    if (!saved) return;
    const timeout = setTimeout(() => setSaved(false), 2500);
    return () => clearTimeout(timeout);
  }, [saved]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    const height = form.heightCm ? Number(form.heightCm.replace(',', '.')) : undefined;
    const weight = form.weightKg ? Number(form.weightKg.replace(',', '.')) : undefined;
    const target = form.targetWeightKg ? Number(form.targetWeightKg.replace(',', '.')) : null;

    if (form.name.trim().length < 2) {
      setError('O nome precisa de ao menos 2 caracteres.');
      return;
    }
    if (height !== undefined && (height < 80 || height > 260)) {
      setError('Altura entre 80 e 260 cm.');
      return;
    }
    if (weight !== undefined && (weight < 20 || weight > 400)) {
      setError('Peso entre 20 e 400 kg.');
      return;
    }
    if (target !== null && (target < 20 || target > 400)) {
      setError('Meta de peso entre 20 e 400 kg.');
      return;
    }

    mutation.mutate({
      name: form.name.trim(),
      ...(height !== undefined ? { heightCm: height } : {}),
      ...(weight !== undefined ? { weightKg: weight } : {}),
      targetWeightKg: target,
      goal: form.goal,
      experienceLevel: form.experienceLevel,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="card mb-4">
      <h2 className="card-title mb-4">Dados pessoais</h2>

      <div className="space-y-3">
        <div>
          <label className="label" htmlFor="nome">
            Nome
          </label>
          <input
            id="nome"
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            className="input"
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label" htmlFor="altura">
              Altura (cm)
            </label>
            <input
              id="altura"
              type="text"
              inputMode="numeric"
              value={form.heightCm}
              onChange={(event) => setForm({ ...form, heightCm: event.target.value })}
              placeholder="—"
              className="input text-center tabular-nums"
            />
          </div>
          <div>
            <label className="label" htmlFor="peso-perfil">
              Peso (kg)
            </label>
            <input
              id="peso-perfil"
              type="text"
              inputMode="decimal"
              value={form.weightKg}
              onChange={(event) => setForm({ ...form, weightKg: event.target.value })}
              placeholder="—"
              className="input text-center tabular-nums"
            />
          </div>
          <div>
            <label className="label" htmlFor="meta-peso">
              Meta (kg)
            </label>
            <input
              id="meta-peso"
              type="text"
              inputMode="decimal"
              value={form.targetWeightKg}
              onChange={(event) => setForm({ ...form, targetWeightKg: event.target.value })}
              placeholder="—"
              className="input text-center tabular-nums"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="objetivo">
            Objetivo
          </label>
          <select
            id="objetivo"
            value={form.goal}
            onChange={(event) => setForm({ ...form, goal: event.target.value })}
            className="input"
          >
            {GOALS.map((goal) => (
              <option key={goal.value} value={goal.value}>
                {goal.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="nivel">
            Nível de experiência
          </label>
          <select
            id="nivel"
            value={form.experienceLevel}
            onChange={(event) => setForm({ ...form, experienceLevel: event.target.value })}
            className="input"
          >
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}

      <div className="mt-4 flex items-center gap-3">
        <button type="submit" disabled={mutation.isPending} className="btn-primary text-xs">
          {mutation.isPending ? 'Salvando…' : 'Salvar alterações'}
        </button>
        {saved && (
          <span className="flex items-center gap-1 text-xs text-positive">
            <IconCheck size={14} />
            salvo
          </span>
        )}
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────────────

function WaterGoalCard({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const suggestionQuery = useQuery({
    queryKey: ['water-goal', 'suggestion'],
    queryFn: () =>
      api.get<{ suggestedMl: number; currentMl: number }>('/users/me/water-goal/suggestion'),
    // Sem peso a API responde 422 — é esperado, não é falha de rede.
    enabled: Boolean(profile.weightKg),
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (dailyWaterGoalMl: number) => api.patch('/users/me', { dailyWaterGoalMl }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      void queryClient.invalidateQueries({ queryKey: ['hydration'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.'),
  });

  const suggestion = suggestionQuery.data;
  const differs = suggestion && suggestion.suggestedMl !== profile.dailyWaterGoalMl;

  return (
    <section className="card mb-4">
      <h2 className="card-title">Meta diária de água</h2>
      <p className="stat mt-3">
        {profile.dailyWaterGoalMl}
        <span className="ml-1 text-base font-normal text-ink-faint">ml</span>
      </p>

      {differs ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <p className="text-xs text-ink-muted">
            Pelo seu peso, sugerimos{' '}
            <strong className="text-ink">{suggestion.suggestedMl} ml</strong>.
          </p>
          <button
            onClick={() => mutation.mutate(suggestion.suggestedMl)}
            disabled={mutation.isPending}
            className="btn-ghost px-3 py-1.5 text-xs"
          >
            <IconDroplet size={13} />
            Usar sugestão
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">
          {profile.weightKg
            ? 'Sua meta acompanha a sugestão para o seu peso.'
            : 'Informe seu peso para receber uma sugestão.'}
        </p>
      )}

      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </section>
  );
}

// ────────────────────────────────────────────────────────────────

function PreferencesCard({ profile }: { profile: UserProfile }) {
  const queryClient = useQueryClient();
  const preferences = (profile.preferences ?? {}) as Record<string, boolean | undefined>;
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch('/users/me/preferences', body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile'] }),
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Não foi possível salvar.'),
  });

  return (
    <section className="card">
      <h2 className="card-title mb-1">Preferências</h2>
      <p className="mb-4 text-xs text-ink-faint">Cada opção salva sozinha ao ser alterada.</p>

      <ul className="divide-y divide-border">
        {PREFERENCE_TOGGLES.map((toggle) => {
          // Ausente = ligado: as notificações vêm habilitadas por padrão.
          const checked = preferences[toggle.key] ?? true;
          return (
            <li key={toggle.key} className="flex items-center justify-between gap-4 py-3">
              <div className="min-w-0">
                <p className="text-sm">{toggle.label}</p>
                {toggle.hint && <p className="text-xs text-ink-faint">{toggle.hint}</p>}
              </div>
              <button
                role="switch"
                aria-checked={checked}
                aria-label={toggle.label}
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ [toggle.key]: !checked })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                  checked ? 'bg-accent' : 'bg-elevated'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-base transition-[left] ${
                    checked ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
    </section>
  );
}
