/**
 * Página servida pelo service worker quando não há rede nem cache da
 * rota pedida. Estática de propósito: precisa funcionar com zero JS de
 * aplicação carregado.
 */

export const metadata = { title: 'Sem conexão — Atlas' };

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-sm text-center">
        <span className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-elevated text-2xl font-bold text-ink-faint">
          A
        </span>
        <h1 className="text-xl font-semibold tracking-tight">Sem conexão</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-muted">
          Esta tela ainda não estava salva no aparelho. Assim que a conexão voltar, ela carrega
          normalmente.
        </p>
        <a href="/" className="btn-primary mt-5">
          Tentar novamente
        </a>
      </div>
    </div>
  );
}
