'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@atlas/shared';
import type { LoginResponse } from '@atlas/shared';
import { api, ApiError, BASE_URL } from '@/lib/api';
import { getOrCreateDeviceId, getSession, saveSession } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<{ google: boolean; email: boolean } | null>(null);

  useEffect(() => {
    if (getSession()) router.replace('/');

    api
      .get<{ google: boolean; email: boolean }>('/auth/providers', { skipAuth: true })
      .then(setProviders)
      .catch(() => setProviders({ google: false, email: false }));
  }, [router]);

  async function handleDevLogin() {
    setLoading(true);
    setError(null);

    try {
      const result = await api.post<LoginResponse>(
        '/auth/dev-login',
        { email: 'admin@atlas.local' },
        { skipAuth: true },
      );

      saveSession({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
        deviceId: getOrCreateDeviceId(),
        user: result.user,
      });

      router.replace('/');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : 'Falha inesperada ao entrar. A API está rodando?',
      );
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-accent text-2xl font-bold text-base">
            A
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-ink-muted">Treinos, evolução física e hidratação</p>
        </div>

        <div className="card space-y-4">
          {providers?.google ? (
            <a
              href={`${BASE_URL}/auth/google`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-base transition hover:opacity-90"
            >
              Entrar com Google
            </a>
          ) : (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              Google OAuth ainda não configurado. Preencha{' '}
              <code className="font-mono">GOOGLE_CLIENT_ID</code> e{' '}
              <code className="font-mono">GOOGLE_CLIENT_SECRET</code> no{' '}
              <code className="font-mono">.env</code> para habilitar o login real.
            </div>
          )}

          <button
            onClick={handleDevLogin}
            disabled={loading}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-base transition hover:bg-accent-strong disabled:opacity-50"
          >
            {loading ? 'Entrando…' : 'Entrar como administrador (dev)'}
          </button>

          <p className="text-center text-[11px] leading-relaxed text-ink-faint">
            O login de desenvolvimento usa o usuário criado pelo seed e só funciona com{' '}
            <code className="font-mono">NODE_ENV=development</code>.
          </p>

          {error && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
              {error}
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-ink-faint">
          Problemas de conexão?{' '}
          <a href="/status" className="text-accent underline-offset-2 hover:underline">
            Ver status do sistema
          </a>
        </p>
      </div>
    </div>
  );
}
