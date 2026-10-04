// Service Worker nativo para Application Shell Offline de CrossedArts
//
// Estrategia de versionado de caché (determinista y mínima):
//   - `APP_SHELL_VERSION` se incrementa cuando cambia el shell desplegado.
//     El nombre de la caché incluye la versión, así que un despliegue nuevo
//     escribe en una caché nueva en lugar de reusar la anterior.
//   - En `activate` se BORRAN todas las cachés antiguas del propio servicio
//     (cualquiera que empiece por `crossedarts-shell-`), de modo que un shell
//     obsoleto no puede volver a servirse tras un despliegue.
//   - Las rutas siguen siendo relativas (`./`), compatibles con GitHub Pages
//     publicado en un subdirectorio de proyecto.
//   - No se cachean orígenes externos: Ollama y APIs remotas quedan fuera.
//   - `sql-wasm.wasm` se precachea para que SQLite siga funcionando sin red.

const APP_SHELL_VERSION = 'v3';
const CACHE_PREFIX = 'crossedarts-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_SHELL_VERSION}`;

const STATIC_SHELL_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json',
  './sql-wasm.wasm'
];

async function precacheShell(cache) {
  // Primero fijamos el index fresco y derivamos de él los assets generados por Vite.
  // Así el shell inicial (JS/CSS) también está disponible inmediatamente offline,
  // sin hardcodear nombres hashados que cambian en cada build.
  let indexResponse;
  try {
    indexResponse = await fetch('./index.html', { cache: 'reload' });
    if (indexResponse.ok) await cache.put('./index.html', indexResponse.clone());
  } catch (err) {
    console.warn('[sw] No se pudo obtener index.html durante la instalación:', err);
  }

  const assets = new Set(STATIC_SHELL_ASSETS);
  if (indexResponse?.ok) {
    try {
      const html = await indexResponse.text();
      for (const match of html.matchAll(/(?:src|href)=\"([^\"]+)\"/g)) {
        const value = match[1];
        if (!value || value.startsWith('data:') || value.startsWith('//')) continue;
        assets.add(value);
      }
    } catch (err) {
      console.warn('[sw] No se pudieron descubrir los assets del shell:', err);
    }
  }

  await Promise.all(
    Array.from(assets).map((asset) =>
      cache.add(new Request(asset, { cache: 'reload' })).catch((err) => {
        console.warn('[sw] No se pudo precachear', asset, err);
      })
    )
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => precacheShell(cache))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Ignorar peticiones que no sean GET
  if (event.request.method !== 'GET') return;

  // Ignorar cualquier origen externo: Ollama, APIs de IA y CDNs no se cachean.
  if (url.origin !== self.location.origin) return;

  // Navegación (app shell): red primero con respaldo en caché. Así un despliegue
  // nuevo trae su index.html sin esperar, pero sin red seguimos sirviendo la
  // última versión conocida (offline-first).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Assets estáticos: Stale-While-Revalidate. La respuesta cacheada se sirve al
  // instante (sin dependencia de red) y se refresca en segundo plano.
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