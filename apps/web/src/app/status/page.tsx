'use client';

/**
 * Status do sistema — página PÚBLICA de diagnóstico.
 *
 * Deliberadamente acessível sem sessão: quando algo está errado, é
 * justamente quando não se consegue entrar. Mostra o que a API enxerga
 * do banco local, do Neon e do Redis.
 */

import { useQuery } from '@tanstack/react-query';
import type { HealthCheckResponse } from '@atlas/shared';
import { api, BASE_URL } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { QueryState } from '@/components/query-state';

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  up: { dot: 'bg-positive', label: 'Conectado' },
  down: { dot: 'bg-danger', label: 'Fora do ar' },
  disabled: { dot: 'bg-ink-faint', label: 'Não configurado' },
};

const OVERALL: Record<string, { className: string; label: string; hint: string }> = {
  ok: {
    className: 'border-positive/30 bg-positive/10 text-positive',
    label: 'Tudo operacional',
    hint: 'Banco principal e dependências respondendo.',
  },
  degraded: {
    className: 'border-warning/30 bg-warning/10 text-warning',
    label: 'Operando em contingência',
    hint: 'O sistema funciona, mas alguma dependência está fora.',
  },
  down: {
    className: 'border-danger/30 bg-danger/10 text-danger',
    label: 'Indisponível',
    hint: 'Nenhum banco de dados acessível.',
  },
};

export default function StatusPage() {
  const query = useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<HealthCheckResponse>('/health', { skipAuth: true }),
    refetchInterval: 10_000,
  });

  return (
    <AppShell>
      <div className="mx-auto max-w-2xl p-5 md:p-8">
        <h1 className="mb-1 text-2xl font-semibold tracking-tight">Status do sistema</h1>
        <p className="mb-6 text-xs text-ink-faint">
          Consultando <code className="font-mono">{BASE_URL}/health</code> a cada 10 s
        </p>

        <QueryState query={query}>
          {(health) => {
            const overall = OVERALL[health.status] ?? OVERALL.down;

            return (
              <>
                <div className={`rounded-card border p-4 ${overall!.className}`}>
                  <p className="font-medium">{overall!.label}</p>
                  <p className="mt-0.5 text-xs opacity-80">{overall!.hint}</p>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-3">
                  <div className="card">
                    <dt className="card-title">Banco ativo</dt>
                    <dd className="mt-1 text-lg font-semibold">
                      {health.activeDatabase === 'LOCAL'
                        ? 'Local'
                        : health.activeDatabase === 'CLOUD'
                          ? 'Neon'
                          : '—'}
                    </dd>
                  </div>
                  <div className="card">
                    <dt className="card-title">Tempo no ar</dt>
                    <dd className="mt-1 text-lg font-semibold tabular-nums">
                      {Math.floor(health.uptimeSeconds / 60)} min
                    </dd>
                  </div>
                </dl>

                <section className="mt-4 space-y-2">
                  <h2 className="card-title">Dependências</h2>

                  {(
                    [
                      ['PostgreSQL local (Docker :5433)', health.checks.databaseLocal],
                      ['Neon PostgreSQL (nuvem)', health.checks.databaseCloud],
                      ['Redis (filas e rate limit)', health.checks.redis],
                    ] as const
                  ).map(([label, check]) => {
                    const style = STATUS_STYLE[check.status] ?? STATUS_STYLE.down;
                    return (
                      <div
                        key={label}
                        className="flex items-center justify-between rounded-lg border border-border bg-surface px-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm">{label}</p>
                          {check.error && (
                            <p className="mt-0.5 truncate text-[11px] text-danger">{check.error}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {check.latencyMs !== undefined && check.status === 'up' && (
                            <span className="text-[11px] tabular-nums text-ink-faint">
                              {check.latencyMs} ms
                            </span>
                          )}
                          <span className={`h-2 w-2 rounded-full ${style!.dot}`} />
                          <span className="w-24 text-right text-xs text-ink-muted">
                            {style!.label}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </section>

                <p className="mt-6 text-[11px] text-ink-faint">
                  Nó: <code className="font-mono">{health.nodeId}</code> · versão {health.version}
                </p>
              </>
            );
          }}
        </QueryState>
      </div>
    </AppShell>
  );
}
