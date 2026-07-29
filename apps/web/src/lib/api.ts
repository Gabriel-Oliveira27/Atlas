/**
 * Cliente HTTP do Atlas.
 *
 * Concentra em UM lugar o que toda tela precisaria repetir:
 *   • desembrulhar o envelope `{ success, data, meta }`
 *   • injetar o token de acesso
 *   • renovar o token em 401 e refazer a requisição
 *   • traduzir erro em `ApiError` com o `code` estável
 *
 * A renovação usa uma promessa compartilhada: cinco chamadas simultâneas
 * que recebem 401 disparariam cinco refreshes, e a rotação invalidaria
 * os tokens umas das outras — derrubando a sessão do usuário. Com a
 * promessa única, todas esperam o mesmo refresh.
 */

import type { ApiResponse, ErrorCode, PaginationMeta } from '@atlas/shared';
import { clearSession, getSession, saveSession } from './session';
import { getBaseUrl, invalidateEndpoint, isPointingAtLocalhost, resolveBaseUrl } from './endpoint';

/**
 * Endereço padrão, usado antes da primeira sondagem e quando não há
 * reserva configurada. A escolha entre notebook e API hospedada vive em
 * `endpoint.ts` — ver o porquê lá.
 */
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3333/api';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode | string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Rotas públicas (health, login, cadastro) não enviam Authorization. */
  skipAuth?: boolean;
  signal?: AbortSignal;
}

/** Resultado com a paginação preservada, quando a rota devolve lista. */
export interface Paged<T> {
  items: T[];
  pagination?: PaginationMeta;
}

/**
 * Rastreio de `meta.servedBy`.
 *
 * Toda resposta informa qual banco atendeu. Quando vira `CLOUD`, o
 * sistema está em contingência e o AppShell exibe um aviso global —
 * assim nenhuma tela precisa checar isso por conta própria.
 */
type ServedBy = 'LOCAL' | 'CLOUD' | null;

let lastServedBy: ServedBy = null;
const servedByListeners = new Set<(value: ServedBy) => void>();

export function getServedBy(): ServedBy {
  return lastServedBy;
}

export function subscribeServedBy(listener: (value: ServedBy) => void): () => void {
  servedByListeners.add(listener);
  return () => servedByListeners.delete(listener);
}

function trackServedBy(meta: unknown): void {
  const servedBy = (meta as { servedBy?: ServedBy } | undefined)?.servedBy ?? null;
  if (servedBy && servedBy !== lastServedBy) {
    lastServedBy = servedBy;
    for (const listener of servedByListeners) listener(servedBy);
  }
}

/** Refresh em andamento — compartilhado por todas as chamadas. */
let refreshInFlight: Promise<boolean> | null = null;

async function refreshTokens(): Promise<boolean> {
  const session = getSession();
  if (!session?.refreshToken) return false;

  try {
    const response = await fetch(`${getBaseUrl()}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken, deviceId: session.deviceId }),
    });

    const payload = (await response.json()) as ApiResponse<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>;

    if (!response.ok || !payload.success) {
      // Reuso detectado ou refresh expirado: a sessão acabou de verdade.
      clearSession();
      return false;
    }

    saveSession({
      ...session,
      accessToken: payload.data.accessToken,
      refreshToken: payload.data.refreshToken,
    });

    return true;
  } catch {
    return false;
  }
}

async function ensureRefreshed(): Promise<boolean> {
  refreshInFlight ??= refreshTokens().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

async function execute<T>(path: string, options: RequestOptions, retrying = false): Promise<T> {
  const session = getSession();

  // Decide entre notebook e reserva antes de cada requisição. É barato:
  // a decisão fica em cache por minutos, e só sonda quando expira.
  const baseUrl = await resolveBaseUrl();

  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (!options.skipAuth && session?.accessToken) {
    headers.authorization = `Bearer ${session.accessToken}`;
  }
  if (session?.deviceId) {
    headers['x-atlas-device-id'] = session.deviceId;
  }

  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch {
    // O endereço escolhido pode ter caído no meio da sessão. Invalida a
    // decisão para a próxima chamada sondar de novo — sem isso, o app
    // insistiria no endereço morto até o cache expirar.
    invalidateEndpoint();

    // Site publicado apontando para localhost é configuração faltando,
    // não API fora do ar. Dizer "falha de rede" aqui manda o usuário
    // procurar no lugar errado.
    if (isPointingAtLocalhost()) {
      throw new ApiError(
        'API_NAO_CONFIGURADA',
        'Este site está publicado, mas a API aponta para localhost. ' +
          'Defina NEXT_PUBLIC_API_URL nas variáveis de ambiente da Vercel e refaça o deploy.',
        0,
      );
    }

    // Falha de rede: a API está fora, não é erro de aplicação.
    throw new ApiError(
      'NETWORK_ERROR',
      `Não foi possível falar com a API (${baseUrl}). Ela está no ar?`,
      0,
    );
  }

  // 204 não tem corpo.
  if (response.status === 204) return undefined as T;

  let payload: ApiResponse<T>;
  try {
    payload = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new ApiError('INVALID_RESPONSE', 'A API devolveu uma resposta ilegível', response.status);
  }

  trackServedBy(payload.meta);

  if (payload.success) return payload.data;

  // Token expirado: renova uma vez e repete.
  if (response.status === 401 && !retrying && !options.skipAuth) {
    const renewed = await ensureRefreshed();
    if (renewed) return execute<T>(path, options, true);
  }

  throw new ApiError(
    payload.error.code,
    payload.error.message,
    response.status,
    payload.error.details,
  );
}

export const api = {
  get: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    execute<T>(path, { ...options, method: 'GET' }),

  post: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'POST', body }),

  patch: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'PATCH', body }),

  put: <T>(path: string, body?: unknown, options: Omit<RequestOptions, 'method'> = {}) =>
    execute<T>(path, { ...options, method: 'PUT', body }),

  delete: <T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}) =>
    execute<T>(path, { ...options, method: 'DELETE' }),
};

export { BASE_URL };
