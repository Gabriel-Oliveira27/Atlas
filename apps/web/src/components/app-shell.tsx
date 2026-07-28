'use client';

/**
 * Casca da aplicação: navegação lateral no desktop, barra inferior no
 * mobile, e o aviso de contingência quando a API está servindo pelo Neon.
 */

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { APP_NAME } from '@atlas/shared';
import { clearSession, getSession, type Session } from '@/lib/session';

const NAV = [
  { href: '/', label: 'Início', icon: '◈' },
  { href: '/hidratacao', label: 'Hidratação', icon: '◍' },
  { href: '/exercicios', label: 'Exercícios', icon: '◎' },
  { href: '/status', label: 'Status', icon: '◉' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

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

  function handleLogout() {
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
      {/* Navegação — lateral no desktop */}
      <aside className="hidden w-60 shrink-0 border-r border-border bg-surface p-5 md:block">
        <Link href="/" className="mb-8 flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-accent font-bold text-base">
            A
          </span>
          <span className="text-lg font-semibold tracking-tight">{APP_NAME}</span>
        </Link>

        <nav className="space-y-1">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                  active
                    ? 'bg-elevated font-medium text-ink'
                    : 'text-ink-muted hover:bg-elevated hover:text-ink'
                }`}
              >
                <span aria-hidden className={active ? 'text-accent' : ''}>
                  {item.icon}
                </span>
                {item.label}
              </Link>
            );
          })}
        </nav>

        {session && (
          <div className="mt-8 border-t border-border pt-4">
            <p className="truncate text-sm font-medium">{session.user.name}</p>
            <p className="truncate text-xs text-ink-faint">{session.user.email}</p>
            <p className="mt-1 inline-block rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-muted">
              {session.user.role}
            </p>
            <button
              onClick={handleLogout}
              className="mt-3 text-xs text-ink-faint underline-offset-2 hover:text-danger hover:underline"
            >
              Sair
            </button>
          </div>
        )}
      </aside>

      <main className="flex-1 pb-20 md:pb-0">{children}</main>

      {/* Navegação — barra inferior no mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface md:hidden">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] ${
                active ? 'text-accent' : 'text-ink-faint'
              }`}
            >
              <span aria-hidden className="text-base">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
