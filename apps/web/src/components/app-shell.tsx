'use client';

/**
 * Casca da aplicação.
 *
 * Desktop: navegação lateral fixa. Mobile: cabeçalho compacto + barra de
 * abas inferior (com `pb-safe` para o recorte do aparelho). O aviso de
 * contingência (banco em nuvem) é global — vem de `subscribeServedBy`
 * no cliente HTTP, então nenhuma tela precisa tratar isso sozinha.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@atlas/shared';
import { clearSession, getSession, type Session } from '@/lib/session';
import { api, getServedBy, subscribeServedBy } from '@/lib/api';
import { getEndpointKind, subscribeEndpoint } from '@/lib/endpoint';
import {
  IconCloud,
  IconDroplet,
  IconDumbbell,
  IconHome,
  IconList,
  IconLogOut,
  IconPulse,
  IconTrendingUp,
  IconUser,
} from '@/components/icons';

const NAV = [
  { href: '/', label: 'Início', icon: IconHome },
  { href: '/hidratacao', label: 'Hidratação', icon: IconDroplet },
  { href: '/treino', label: 'Treino', icon: IconDumbbell },
  { href: '/exercicios', label: 'Exercícios', icon: IconList },
  { href: '/evolucao', label: 'Evolução', icon: IconTrendingUp },
  { href: '/perfil', label: 'Perfil', icon: IconUser },
];

/** No mobile cabem 5 abas; Exercícios fica acessível pela tela de Treino. */
const MOBILE_NAV = NAV.filter((item) => item.href !== '/exercicios');

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [onFallback, setOnFallback] = useState(false);

  useEffect(() => {
    const current = getSession();
    setSession(current);
    setReady(true);

    // A página de status é pública — serve para diagnosticar a stack
    // mesmo sem conseguir entrar.
    if (!current && pathname !== '/login' && pathname !== '/status') {
      router.replace('/login');
    }
  }, [pathname, router]);

  useEffect(() => {
    setDegraded(getServedBy() === 'CLOUD');
    return subscribeServedBy((servedBy) => setDegraded(servedBy === 'CLOUD'));
  }, []);

  // Avisar que está na API de reserva não é firula: a sincronização com
  // o Neon não é instantânea, então dados criados há pouco no servidor
  // principal podem ainda não estar aqui.
  useEffect(() => {
    setOnFallback(getEndpointKind() === 'fallback');
    return subscribeEndpoint((kind) => setOnFallback(kind === 'fallback'));
  }, []);

  function handleLogout() {
    // Revoga o refresh token no servidor; se falhar, a sessão local é
    // limpa mesmo assim — o usuário pediu para sair.
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

  // Evita piscar o conteúdo antes de saber se há sessão.
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-sm text-ink-faint">Carregando…</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen md:flex">
      {/* ── Navegação lateral (desktop) ─────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface/70 p-5 backdrop-blur md:flex">
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-accent to-accent-strong font-bold text-base">
            A
          </span>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </Link>

        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-elevated font-medium text-ink'
                    : 'text-ink-muted hover:bg-elevated hover:text-ink'
                }`}
              >
                <Icon size={18} className={active ? 'text-accent' : ''} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto space-y-4">
          <Link
            href="/status"
            className="flex items-center gap-2 text-xs text-ink-faint transition hover:text-ink"
          >
            <IconPulse size={14} />
            Status do sistema
          </Link>

          {session && (
            <div className="border-t border-border pt-4">
              <p className="truncate text-sm font-medium">{session.user.name}</p>
              <p className="truncate text-xs text-ink-faint">{session.user.email}</p>
              <button
                onClick={handleLogout}
                className="mt-3 flex items-center gap-1.5 text-xs text-ink-faint transition hover:text-danger"
              >
                <IconLogOut size={14} />
                Sair
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        {/* ── Cabeçalho (mobile) ────────────────────────────── */}
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-base/80 px-5 py-3 backdrop-blur md:hidden">
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-accent to-accent-strong text-sm font-bold text-base">
              A
            </span>
            <span className="font-semibold tracking-tight">{APP_NAME}</span>
          </Link>
          {(degraded || onFallback) && (
            <span
              className="flex items-center gap-1.5 text-xs text-warning"
              title={
                onFallback
                  ? 'Servidor principal fora — usando o de reserva'
                  : 'Operando pelo banco em nuvem'
              }
            >
              <IconCloud size={14} />
              {onFallback ? 'reserva' : 'contingência'}
            </span>
          )}
        </header>

        {/* Avisos globais (desktop). O de servidor vem primeiro: quando
            os dois valem, a origem dos dados importa mais do que qual
            banco os serviu. */}
        {onFallback && (
          <div className="hidden items-center gap-2 border-b border-warning/20 bg-warning/10 px-6 py-2 text-xs text-warning md:flex">
            <IconCloud size={14} />
            Servidor principal fora do ar — usando o de reserva. Alterações muito recentes podem
            ainda não aparecer aqui.
          </div>
        )}

        {degraded && !onFallback && (
          <div className="hidden items-center gap-2 border-b border-warning/20 bg-warning/10 px-6 py-2 text-xs text-warning md:flex">
            <IconCloud size={14} />
            Operando com o banco em nuvem — suas alterações serão reconciliadas quando o banco local
            voltar.
          </div>
        )}

        <main className="flex-1 pb-24 md:pb-0">{children}</main>
      </div>

      {/* ── Barra de abas (mobile) ──────────────────────────── */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/90 backdrop-blur md:hidden">
        <div className="flex">
          {MOBILE_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium transition ${
                  active ? 'text-accent' : 'text-ink-faint'
                }`}
              >
                <Icon size={21} strokeWidth={active ? 2.1 : 1.8} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
