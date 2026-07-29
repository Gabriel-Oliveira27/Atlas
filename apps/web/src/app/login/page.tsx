'use client';

/**
 * Entrada do produto — três etapas na mesma tela.
 *
 * `credenciais` é o caminho normal. Quando a API responde
 * `FIRST_ACCESS_REQUIRED`, a conta existe mas nunca teve senha: em vez
 * de mostrar um erro e deixar a pessoa presa, a tela vira o formulário
 * de primeiro acesso já com o identificador preenchido. `cadastro` cria
 * uma conta nova.
 *
 * O identificador é UM campo só (e-mail, CPF ou telefone) porque o
 * usuário não lembra com o que se cadastrou — quem descobre é a API.
 */

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@atlas/shared';
import type { LoginResponse } from '@atlas/shared';
import { api, ApiError, BASE_URL } from '@/lib/api';
import { getOrCreateDeviceId, getSession, saveSession } from '@/lib/session';
import { IconGoogle } from '@/components/icons';

interface Providers {
  google: boolean;
  credentials: boolean;
  identifiers: Array<'email' | 'cpf' | 'phone'>;
}

type Etapa = 'credenciais' | 'primeiro-acesso' | 'cadastro';

const TITULO: Record<Etapa, string> = {
  credenciais: 'Treinos, evolução física e hidratação',
  'primeiro-acesso': 'Primeiro acesso — crie sua senha',
  cadastro: 'Crie sua conta',
};

export default function LoginPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState<Etapa>('credenciais');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Providers | null>(null);

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [activationCode, setActivationCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');

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

  function trocarEtapa(proxima: Etapa) {
    setEtapa(proxima);
    setError(null);
    setPassword('');
    setNewPassword('');
    setConfirmPassword('');
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
        trocarEtapa('primeiro-acesso');
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

  async function handleCadastro(event: React.FormEvent) {
    event.preventDefault();

    if (newPassword !== confirmPassword) {
      setError('As senhas não conferem.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await api.post<LoginResponse>(
        '/auth/register',
        { name, email, password: newPassword, deviceId: getOrCreateDeviceId() },
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
          <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-accent to-accent-strong text-2xl font-bold text-base">
            A
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
          <p className="mt-1 text-sm text-ink-muted">{TITULO[etapa]}</p>
        </div>

        <div className="card space-y-4">
          {etapa === 'credenciais' && (
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
          )}

          {etapa === 'primeiro-acesso' && (
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
            </form>
          )}

          {etapa === 'cadastro' && (
            <form onSubmit={handleCadastro} className="space-y-3">
              <Campo
                label="Nome completo"
                type="text"
                autoComplete="name"
                value={name}
                onChange={setName}
              />
              <Campo
                label="E-mail"
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
              />
              <Campo
                label="Senha"
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
              <Botao loading={loading} label="Criar conta" loadingLabel="Criando…" />
            </form>
          )}

          {providers?.google && etapa !== 'primeiro-acesso' && (
            <>
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">ou</span>
                <span className="h-px flex-1 bg-border" />
              </div>

              <a
                href={`${BASE_URL}/auth/google`}
                className="flex w-full items-center justify-center gap-2.5 rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-base transition hover:opacity-90"
              >
                <IconGoogle size={18} />
                Entrar com Google
              </a>
            </>
          )}

          {error && (
            <div
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-xs text-danger"
            >
              {error}
            </div>
          )}

          <div className="border-t border-border pt-3 text-center text-xs text-ink-faint">
            {etapa === 'credenciais' ? (
              <>
                Ainda não tem conta?{' '}
                <button
                  type="button"
                  onClick={() => trocarEtapa('cadastro')}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  Criar agora
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => trocarEtapa('credenciais')}
                className="text-accent underline-offset-2 hover:underline"
              >
                Voltar para o login
              </button>
            )}
          </div>
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
    <label className="block">
      <span className="label">{label}</span>
      <input
        {...props}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="input"
      />
      {hint && <span className="mt-1 block text-[11px] text-ink-faint">{hint}</span>}
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
    <button type="submit" disabled={loading} className="btn-primary w-full justify-center">
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
    // Configuração faltando, não credencial errada — a mensagem já vem
    // pronta do cliente HTTP e diz o que fazer.
    case 'API_NAO_CONFIGURADA':
      return err.message;
    case 'INVALID_CREDENTIALS':
      return 'E-mail, CPF, telefone ou senha incorretos.';
    case 'ACTIVATION_CODE_INVALID':
      return 'Código de ativação inválido ou expirado. Peça um novo à academia.';
    case 'PASSWORD_NOT_SET':
      return 'Esta conta entra com o Google.';
    case 'USER_INACTIVE':
      return 'Esta conta está inativa. Procure a sua academia.';
    case 'EMAIL_ALREADY_EXISTS':
    case 'CONFLICT':
      return 'Já existe uma conta com esses dados. Tente entrar.';
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
