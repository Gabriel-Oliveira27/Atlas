'use client';

/**
 * Retorno do login com Google.
 *
 * A API redireciona para cá com os tokens no FRAGMENTO da URL
 * (`#access_token=...`) — o fragmento nunca é enviado a servidor nem
 * registrado em logs intermediários, ao contrário da query string.
 *
 * Fluxo: ler o fragmento → limpar a URL imediatamente → buscar o
 * usuário em /auth/me → salvar a sessão → ir para a Home.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { AuthenticatedUser } from '@atlas/shared';
import { api } from '@/lib/api';
import { getOrCreateDeviceId, saveSession } from '@/lib/session';

export default function AuthCallbackPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // O StrictMode monta o efeito duas vezes em dev; sem a trava, a
  // segunda execução leria uma URL já limpa e cairia no erro.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const accessToken = fragment.get('access_token');
    const refreshToken = fragment.get('refresh_token');

    // Tokens fora da barra de endereço o quanto antes.
    window.history.replaceState(null, '', '/auth/callback');

    if (!accessToken || !refreshToken) {
      setError('O retorno do login veio sem os tokens. Tente entrar novamente.');
      return;
    }

    const deviceId = getOrCreateDeviceId();

    // Sessão provisória só com os tokens, para o /auth/me autenticar.
    saveSession({
      accessToken,
      refreshToken,
      deviceId,
      user: {
        id: '',
        email: '',
        name: '',
        avatarUrl: null,
        role: 'USER',
        permissions: [],
        gymId: null,
        isActive: true,
      },
    });

    api
      .get<AuthenticatedUser>('/auth/me')
      .then((user) => {
        saveSession({ accessToken, refreshToken, deviceId, user });
        router.replace('/');
      })
      .catch(() => {
        setError('Não foi possível carregar seus dados. Tente entrar novamente.');
      });
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      {error ? (
        <div className="card max-w-sm border-danger/30 bg-danger/5 text-center">
          <p className="text-sm text-danger">{error}</p>
          <a href="/login" className="btn-primary mt-4">
            Voltar ao login
          </a>
        </div>
      ) : (
        <div className="text-center">
          <span className="mx-auto mb-4 grid h-12 w-12 animate-pulse place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-xl font-bold text-base">
            A
          </span>
          <p className="text-sm text-ink-muted">Concluindo o login…</p>
        </div>
      )}
    </div>
  );
}
