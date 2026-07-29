import { PERMISSIONS } from '@atlas/shared';

/**
 * Página inicial do painel — ainda um marcador.
 *
 * Existe para o scaffold ser verificável: `pnpm --filter @atlas/admin dev`
 * sobe e mostra algo. As telas de verdade estão em
 * `docs/task-list-frontend.md`.
 *
 * As rotas listadas abaixo já existem e estão testadas na API; são o
 * ponto de partida natural quando o painel for construído.
 */

interface PlannedScreen {
  title: string;
  route: string;
  permission: string;
}

const READY_SCREENS: PlannedScreen[] = [
  {
    title: 'Alunos da academia',
    route: 'GET /api/users',
    permission: PERMISSIONS.USER_READ_ANY,
  },
  {
    title: 'Estado da sincronização',
    route: 'GET /api/sync/status',
    permission: PERMISSIONS.SYNC_READ,
  },
  {
    title: 'Disparo manual de sincronização',
    route: 'POST /api/sync/trigger',
    permission: PERMISSIONS.SYNC_TRIGGER,
  },
  {
    title: 'Saúde do sistema',
    route: 'GET /api/health',
    permission: 'público',
  },
];

export default function AdminHome() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <header className="mb-8">
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-accent text-xl font-bold text-base">
          A
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Atlas — painel administrativo</h1>
        <p className="mt-1 text-sm text-ink-muted">Scaffold. Nenhuma tela foi construída ainda.</p>
      </header>

      <section className="card">
        <h2 className="card-title mb-4">Rotas prontas na API</h2>

        <ul className="space-y-3">
          {READY_SCREENS.map((screen) => (
            <li key={screen.route} className="border-b border-border pb-3 last:border-0 last:pb-0">
              <p className="text-sm font-medium">{screen.title}</p>
              <p className="mt-0.5 font-mono text-xs text-ink-muted">{screen.route}</p>
              <p className="mt-0.5 text-xs text-ink-faint">exige {screen.permission}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-6 text-xs leading-relaxed text-ink-faint">
        O RBAC já está aplicado no back-end. Use <code className="font-mono">PERMISSIONS</code> de{' '}
        <code className="font-mono">@atlas/shared</code> para esconder na UI exatamente o que a API
        também recusaria — nunca o contrário.
      </p>
    </main>
  );
}
