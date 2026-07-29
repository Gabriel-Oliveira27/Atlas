import Link from 'next/link';
import { IconChevronLeft } from '@/components/icons';

/**
 * Cabeçalho padrão das telas internas: título, subtítulo opcional, botão
 * de voltar (para telas de detalhe) e uma ação à direita.
 */
export function PageHeader({
  title,
  subtitle,
  backHref,
  action,
}: {
  title: string;
  subtitle?: string;
  backHref?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-2">
        {backHref && (
          <Link
            href={backHref}
            aria-label="Voltar"
            className="-ml-2 mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            <IconChevronLeft size={20} />
          </Link>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </header>
  );
}
