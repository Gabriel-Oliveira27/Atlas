'use client';

/**
 * Modal simples: sheet no mobile (desliza de baixo), diálogo centrado no
 * desktop. Fecha por Escape, pelo X e clicando no fundo.
 */

import { useEffect } from 'react';
import { IconX } from '@/components/icons';

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKey);
    // Trava a rolagem do fundo enquanto o modal está aberto.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm md:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="animate-fade-up max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border border-border bg-surface p-5 md:max-w-lg md:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-8 w-8 place-items-center rounded-lg text-ink-muted transition hover:bg-elevated hover:text-ink"
          >
            <IconX size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
