// sw.js — Service worker mínimo, só para tornar o app instalável no celular.
// Não faz cache agressivo de nada: a página principal e a API sempre vêm da rede,
// pra nunca servir uma versão velha depois de um deploy. Só os ícones (que não mudam)
// ficam em cache, como reforço de performance.
const CACHE = 'financeflow-static-v2';  // mudar a versão força os aparelhos a baixarem ícones novos
const CACHEABLE = ['/icons/ff-icon-192.png', '/icons/ff-icon-512.png', '/icons/ff-icon-maskable-512.png', '/icons/ff-badge-96.png'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CACHEABLE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ícones e manifest: cache primeiro, rede como reforço
  if (CACHEABLE.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Tudo mais (HTML, API): sempre da rede, nunca do cache
});

// ── NOTIFICAÇÕES PUSH (alerta de limite de gasto) ────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(data.title || 'FinanceFlow', {
      body:  data.body || '',
      icon:  '/icons/ff-icon-192.png',
      badge: '/icons/ff-badge-96.png',
      tag:   'limite-gasto'
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((list) => {
      const existente = list.find((c) => 'focus' in c);
      if (existente) return existente.focus();
      return clients.openWindow('/app');
    })
  );
});
