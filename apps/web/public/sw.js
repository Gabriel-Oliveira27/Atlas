/**
 * Service worker do Atlas.
 *
 * Estratégia deliberadamente conservadora:
 *
 *   • Navegação (HTML): rede primeiro, cache como reserva. Um app-shell
 *     servido do cache mostraria uma versão velha depois de cada deploy.
 *   • Estáticos do Next (`/_next/static`): cache primeiro — os nomes
 *     têm hash, então nunca ficam obsoletos.
 *   • Chamadas à API: NUNCA passam por aqui. Os dados do usuário são
 *     por-sessão e cacheá-los vazaria informação entre contas no mesmo
 *     aparelho. O trabalho offline de verdade é do banco local + fila de
 *     sincronização (F1.4/F1.5 do backlog), não do service worker.
 */

const VERSION = 'atlas-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const STATIC_CACHE = `${VERSION}-static`;

/** Páginas pré-carregadas para a primeira abertura offline funcionar. */
const SHELL_ASSETS = ['/', '/offline', '/manifest.webmanifest', '/icons/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      // `addAll` falha inteiro se um item falhar; aqui um 404 isolado não
      // pode impedir a instalação do worker.
      .then((cache) => Promise.allSettled(SHELL_ASSETS.map((asset) => cache.add(asset))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => !key.startsWith(VERSION)).map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Só lidamos com o próprio domínio; API e Cloudinary passam direto.
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  // Estáticos com hash no nome: cache primeiro.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Navegação: rede primeiro, cache/offline como reserva.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(async () => (await caches.match(request)) ?? (await caches.match('/offline'))),
    );
  }
});
