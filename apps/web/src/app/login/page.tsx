'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@atlas/shared';
import type { LoginResponse } from '@atlas/shared';
import { api, ApiError, BASE_URL } from '@/lib/api';
import { getOrCreateDeviceId, getSession, saveSession } from '@/lib/session';

interface Providers {
  google: boolean;
  credentials: boolean;
  identifiers: Array<'email' | 'cpf' | 'phone'>;
}

/**
 * Duas etapas na mesma tela.
 *
 * `credenciais` é o caminho normal. Quando a API responde
 * `FIRST_ACCESS_REQUIRED`, a conta existe mas nunca teve senha — em vez
 * de mostrar um erro e deixar a pessoa presa, a tela vira o formulário
 * de primeiro acesso já com o identificador preenchido.
 */
type Etapa = 'credenciais' | 'primeiro-acesso';

export default function LoginPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>('credenciais');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    if (getSession()) router.replace('/');

    api
      .get<Providers>('/auth/providers', { skipAuth: true })
      .then(setProviders)
      .catch(() => setProviders({ google: false, credentials: true, identifiers: ['email'] }));
  }, [router]);

  function entrar(result: LoginResponse) {
    saveSession({
      accessToken: result.tokens.accessToken,
      refreshToken: result.tokens.refreshToken,
      deviceId: getOrCreateDeviceId(),
      user: result.user,
    });

    router.replace('/');
  }

  async function handleLogin(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const result = await api.post<LoginResponse>(
        '/auth/login',
        { identifier, password, deviceId: getOrCreateDeviceId() },
        { skipAuth: true },
      );

      entrar(result);
    } catch (err) {
      // A conta existe e nunca foi ativada: seguimos para a criação da
      // senha em vez de mostrar um erro sem saída.
      if (err instanceof ApiError && err.code === 'FIRST_ACCESS_REQUIRED') {
        setEtapa('primeiro-acesso');
        setPassword('');
        setError(null);
        setLoading(false);
        return;
      }

      setError(mensagemDeErro(err));
      setLoading(false);
    }
  }

  async function handlePrimeiroAcesso(event: React.FormEvent) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.post<LoginResponse>(
        '/auth/first-access',
        { identifier, activationCode, newPassword, deviceId: getOrCreateDeviceId() },
        { skipAuth: true },
      );

      entrar(result);
    } catch (err) {
      setError(mensagemDeErro(err));
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
          <p className="mt-1 text-sm text-ink-muted">
            {etapa === 'credenciais'
              ? 'Treinos, evolução física e hidratação'
              : 'Primeiro acesso — crie sua senha'}
          </p>
        </div>

        <div className="card space-y-4">
          {etapa === 'credenciais' ? (
            <form onSubmit={handleLogin} className="space-y-3">
              <Campo
                label="E-mail, CPF ou telefone"
                type="text"
                autoComplete="username"
                value={identifier}
                onChange={setIdentifier}
              />
              <Campo
                label="Senha"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
              />
              <Botao loading={loading} label="Entrar" loadingLabel="Entrando…" />
            </form>
          ) : (
            <form onSubmit={handlePrimeiroAcesso} className="space-y-3">
              <div className="rounded-lg border border-accent/30 bg-accent/10 p-3 text-xs leading-relaxed text-accent-soft">
                Sua conta ainda não tem senha. Informe o código de ativação que você recebeu e
                escolha uma senha.
              </div>

              <Campo
                label="Código de ativação"
                type="text"
                autoComplete="one-time-code"
                value={activationCode}
                onChange={setActivationCode}
                placeholder="ABCD-2345"
              />
              <Campo
                label="Nova senha"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={setNewPassword}
                hint="Ao menos 8 caracteres, com letra e número."
              />
              <Campo
                label="Confirme a senha"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={setConfirmPassword}
              />
              <Botao loading={loading} label="Criar senha e entrar" loadingLabel="Criando…" />

              <button
                type="button"
                onClick={() => {
                  setEtapa('credenciais');
                  setError(null);
                }}
                className="w-full text-center text-xs text-ink-faint underline-offset-2 hover:underline"
              >
                Voltar
              </button>
            </form>
          )}

          {providers?.google && etapa === 'credenciais' && (
            <a
              href={`${BASE_URL}/auth/google`}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-base transition hover:opacity-90"
            >
              Entrar com Google
            </a>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
            >
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

function Campo({
  label,
  hint,
  value,
  onChange,
  ...props
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  type: string;
  autoComplete: string;
  placeholder?: string;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="w-full rounded-lg border border-ink-faint/30 bg-transparent px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {hint && <span className="block text-[11px] text-ink-faint">{hint}</span>}
    </label>
  );
}

function Botao({
  loading,
  label,
  loadingLabel,
}: {
  loading: boolean;
  label: string;
  loadingLabel: string;
}) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-base transition hover:bg-accent-strong disabled:opacity-50"
    >
      {loading ? loadingLabel : label}
    </button>
  );
}

/**
 * Traduz o erro pelo `code`, nunca pela mensagem.
 *
 * `INVALID_CREDENTIALS` cobre senha errada E conta inexistente — a API
 * não distingue de propósito, e a tela não deve inventar a distinção.
 */
function mensagemDeErro(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return 'Falha inesperada ao entrar. A API está rodando?';
  }

  switch (err.code) {
    case 'INVALID_CREDENTIALS':
      return 'E-mail, CPF, telefone ou senha incorretos.';
    case 'ACTIVATION_CODE_INVALID':
      return 'Código de ativação inválido ou expirado. Peça um novo à academia.';
    case 'PASSWORD_NOT_SET':
      return 'Esta conta entra com o Google.';
    case 'USER_INACTIVE':
      return 'Esta conta está inativa. Procure a sua academia.';
    case 'RATE_LIMITED': {
      const segundos = (err.details as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      return segundos
        ? `Muitas tentativas. Tente de novo em ${segundos}s.`
        : 'Muitas tentativas. Aguarde um instante.';
    }
    case 'VALIDATION_ERROR':
      return 'Confira os dados informados.';
    default:
      return err.message;
  }
}
