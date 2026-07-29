'use client';

/**
 * Registra o service worker.
 *
 * Só em produção: em desenvolvimento, um worker interceptando as
 * requisições atrapalha o hot reload e faz o navegador servir código
 * antigo — o tipo de bug que custa uma hora até alguém lembrar do cache.
 */

import { useEffect } from 'react';

export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    const register = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Falhar o registro não pode derrubar o app — o site funciona
        // igual, só perde a instalação e o cache.
      });
    };

    // Depois do load: registrar durante o carregamento inicial disputa
    // banda com o que a tela precisa para aparecer.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
