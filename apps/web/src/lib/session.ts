/**
 * Sessão do usuário no navegador.
 *
 * ⚠️ PROTÓTIPO: os tokens ficam em `localStorage`, que é legível por
 * qualquer script da página (risco de XSS).
 *
 * Na versão de produção o refresh token deve ir em cookie `httpOnly`
 * emitido pela API, e o access token ficar apenas em memória. Está
 * registrado no backlog (F1.2 em `docs/task-list-frontend.md`).
 * Para um protótipo local, o localStorage mantém a sessão entre
 * recargas sem exigir a infraestrutura de cookies.
 */

import type { AuthenticatedUser } from '@atlas/shared';

const STORAGE_KEY = 'atlas.session';

export interface Session {
  accessToken: string;
  refreshToken: string;
  deviceId: string;
  user: AuthenticatedUser;
}

export function getSession(): Session | null {
  // Executa também no servidor durante o SSR, onde não há window.
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(STORAGE_KEY);
}

/**
 * Identificador estável deste navegador.
 *
 * A API usa o `deviceId` para vincular o refresh token e para o cursor
 * de sincronização — sem ele, cada recarga da página pareceria um
 * dispositivo novo e acumularia sessões órfãs.
 */
export function getOrCreateDeviceId(): string {
  if (typeof window === 'undefined') return 'ssr';

  const key = 'atlas.deviceId';
  let id = window.localStorage.getItem(key);

  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    window.localStorage.setItem(key, id);
  }

  return id;
}
