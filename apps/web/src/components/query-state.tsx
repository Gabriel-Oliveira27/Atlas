'use client';

/**
 * Trata carregamento, erro e vazio em um lugar só.
 *
 * Sem isto, cada tela repetiria o mesmo `if (isLoading) … if (error) …`,
 * e o tratamento divergiria entre elas — que é como uma tela acaba
 * mostrando tela branca quando a API cai.
 */

import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '@/lib/api';

interface QueryStateProps<T> {
  query: UseQueryResult<T, unknown>;
  children: (data: T) => React.ReactNode;
  /** Mensagem quando a consulta volta vazia. */
  emptyMessage?: string;
  isEmpty?: (data: T) => boolean;
  /**
   * `bare` remove a moldura de card dos estados de carregamento e vazio.
   * Use quando o QueryState já está DENTRO de um card — senão a tela
   * mostra um card dentro do outro.
   */
  variant?: 'card' | 'bare';
}

export function QueryState<T>({
  query,
  children,
  emptyMessage,
  isEmpty,
  variant = 'card',
}: QueryStateProps<T>) {
  const bare = variant === 'bare';

  if (query.isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className={`h-24 animate-pulse rounded-card ${bare ? 'bg-elevated' : 'bg-surface'}`} />
        {!bare && <div className="h-24 animate-pulse rounded-card bg-surface" />}
      </div>
    );
  }

  if (query.isError) {
    const error = query.error;
    const isApi = error instanceof ApiError;

    // Sessão inválida tem tratamento próprio: mandar o usuário reentrar
    // é mais útil do que mostrar "401".
    const isAuth = isApi && (error.status === 401 || error.status === 403);

    return (
      <div className={bare ? '' : 'card border-danger/30 bg-danger/5'}>
        <h2 className="text-sm font-medium text-danger">
          {isAuth ? 'Sessão expirada' : 'Não foi possível carregar'}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">{isApi ? error.message : 'Erro inesperado.'}</p>
        {isApi && error.code === 'NETWORK_ERROR' && (
          <p className="mt-2 text-xs text-ink-faint">
            Verifique se a API está no ar: <code className="font-mono">pnpm api:dev</code>
          </p>
        )}
        <div className="mt-3 flex gap-2">
          <button
            onClick={() => query.refetch()}
            className="rounded-lg bg-elevated px-3 py-1.5 text-xs hover:bg-border"
          >
            Tentar novamente
          </button>
          {isAuth && (
            <a
              href="/login"
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-base"
            >
              Entrar novamente
            </a>
          )}
        </div>
      </div>
    );
  }

  const data = query.data as T;

  if (isEmpty?.(data)) {
    return (
      <div className={bare ? 'py-6 text-center' : 'card text-center'}>
        <p className="text-sm text-ink-muted">{emptyMessage ?? 'Nada por aqui ainda.'}</p>
      </div>
    );
  }

  return <>{children(data)}</>;
}
