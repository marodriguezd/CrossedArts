// Service Worker nativo para Application Shell Offline de CrossedArts
const CACHE_NAME = 'crossedarts-shell-v1';

const STATIC_SHELL_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json',
  './sql-wasm.wasm'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_SHELL_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar peticiones que no sean GET
  if (event.request.method !== 'GET') return;

  // Ignorar peticiones a APIs externas o localhost de Ollama
  if (url.origin !== self.location.origin) return;

  // Estrategia Stale-While-Revalidate para el app shell y assets estáticos
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // Si falla la red, recurrir a la caché

      return cachedResponse || fetchPromise;
    })
  );
});
