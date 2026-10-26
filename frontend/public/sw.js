// Service Worker nativo para Application Shell Offline de CrossedArts
//
// Estrategia de versionado y frontera de caché:
//   - `APP_SHELL_VERSION` se incrementa cuando cambia el shell desplegado.
//     El nombre de la caché incluye la versión, así que un despliegue nuevo
//     escribe en una caché nueva en lugar de reusar la anterior.
//   - En `activate` se BORRAN todas las cachés antiguas del propio servicio
//     (cualquiera que empiece por `crossedarts-shell-`), de modo que un shell
//     obsoleto no puede volver a servirse tras un despliegue.
//   - Las rutas siguen siendo relativas (`./`), compatibles con GitHub Pages
//     publicado en un subdirectorio de proyecto.
//   - No se cachean orígenes externos: Ollama y APIs remotas quedan fuera.
//   - FRONTERA DINÁMICA / API (Self-Hosted y Mismo Origen):
//     Se excluyen taxativamente todas las rutas dinámicas del backend (/api/, /api/v1/,
//     /docs, /redoc, /openapi.json, /static/, endpoints de streaming/media como /media/,
//     /stream/, /content/), peticiones autenticadas y respuestas HTTP Range / 206.
//     Bajo ningún concepto se almacenan datos dinámicos ni JSONs de API en Cache Storage.
//   - `sql-wasm.wasm` se precachea para que SQLite siga funcionando sin red.

const APP_SHELL_VERSION = 'v6';
/**
 * Identificador del build, inyectado al construir (ver `vite.config.ts`).
 *
 * Cambia cuando cambia el conjunto de chunks emitidos, así que un despliegue
 * produce un `sw.js` distinto y el navegador detecta la actualización. En
 * desarrollo vale 'dev' y el worker ni siquiera se registra.
 */
const BUILD_ID = /*__BUILD_ID__*/ 'dev';
const CACHE_PREFIX = 'crossedarts-shell-';
const CACHE_NAME = `${CACHE_PREFIX}${APP_SHELL_VERSION}-${BUILD_ID}`;

/**
 * Chunks del build (vistas perezosas incluidas), inyectados al construir.
 *
 * Sin esta lista el precache solo descubría lo referenciado por `index.html`,
 * de modo que abrir una vista perezosa sin red fallaba porque su chunk nunca
 * se había pedido. El runtime ONNX (`ort/*.wasm`, ~21 MB) queda fuera a
 * propósito: se cachea bajo demanda en el primer uso para no forzar su
 * descarga a quien nunca active la IA local.
 */
const PRECACHE_ASSETS = /*__PRECACHE_ASSETS__*/ [];

const STATIC_SHELL_ASSETS = [
  './',
  './index.html',
  './favicon.svg',
  './manifest.json',
  './sql-wasm.wasm'
];

const KNOWN_SHELL_FILENAMES = new Set([
  'index.html',
  'favicon.svg',
  'manifest.json',
  'sql-wasm.wasm'
]);

// Extensiones de archivos estáticos del frontend que son seguras para cachear
const STATIC_ASSET_EXTENSIONS = /\.(?:js|mjs|css|wasm|html|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf|webmanifest)$/i;

/**
 * Determina si una petición corresponde a una ruta dinámica del backend,
 * API, streaming de medios o datos de usuario que NUNCA deben cachearse.
 */
function isDynamicOrBackendRequest(request, url) {
  const pathname = url.pathname;

  // 1. Prefijos y rutas de API / backend
  if (
    pathname.startsWith('/api/') ||
    pathname === '/api' ||
    pathname.startsWith('/docs') ||
    pathname.startsWith('/redoc') ||
    pathname.startsWith('/openapi.json') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/media/') ||
    pathname.startsWith('/stream/') ||
    pathname.startsWith('/content/')
  ) {
    return true;
  }

  // 2. Cabeceras dinámicas / streaming / autenticación
  if (
    request.headers.has('range') ||
    request.headers.has('authorization') ||
    request.headers.get('accept')?.includes('text/event-stream')
  ) {
    return true;
  }

  return false;
}

/**
 * Determina si la petición corresponde a un recurso estático del frontend legítimo.
 * Aplica una lista blanca estricta para evitar cachear rutas arbitrarias del mismo origen.
 */
function isCacheableFrontendAsset(request, url) {
  if (isDynamicOrBackendRequest(request, url)) {
    return false;
  }

  const pathname = url.pathname;

  // 1. Archivos bajo /assets/ generados por Vite (p.ej. /assets/... o /CrossedArts/assets/...)
  if (pathname.includes('/assets/')) {
    return true;
  }

  // 2. Archivos específicos del shell estático (en raíz o en subdirectorio de proyecto)
  const basename = pathname.substring(pathname.lastIndexOf('/') + 1);
  if (basename && KNOWN_SHELL_FILENAMES.has(basename)) {
    return true;
  }

  // 3. Extensiones estáticas conocidas del frontend (imágenes, fuentes, scripts, estilos)
  if (STATIC_ASSET_EXTENSIONS.test(pathname)) {
    return true;
  }

  // Cualquier otra ruta del mismo origen (p.ej. datos dinámicos, rutas GET desconocidas) queda fuera
  return false;
}

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

  const assets = new Set([...STATIC_SHELL_ASSETS, ...PRECACHE_ASSETS]);
  if (indexResponse?.ok) {
    try {
      const html = await indexResponse.text();
      for (const match of html.matchAll(/(?:src|href)=\"([^\"]+)\"/g)) {
        const value = match[1];
        if (!value || value.startsWith('data:') || value.startsWith('//')) continue;
        // Solo agregar assets estáticos locales
        if (STATIC_ASSET_EXTENSIONS.test(value) || value.includes('/assets/')) {
          assets.add(value);
        }
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

/**
 * Instalación sin activación inmediata (actualización controlada).
 *
 * El worker nuevo queda en `waiting`: una pestaña abierta sigue servida por la
 * versión que conoce, y el cambio de versión ocurre solo cuando la persona lo
 * confirma (mensaje `SKIP_WAITING`). Activar a la fuerza dejaba a la pestaña
 * pidiendo chunks que el despliegue ya había borrado.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => precacheShell(cache))
  );
});

/**
 * Confirmación de la persona: recién aquí el worker en espera toma el control.
 * La página recarga UNA sola vez al recibir `controllerchange`.
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  // Exclusión estricta de backend/API/medios en despliegues con mismo origen
  if (isDynamicOrBackendRequest(event.request, url)) {
    return;
  }

  // Navegación (app shell): red primero con respaldo en caché. Así un despliegue
  // nuevo trae su index.html sin esperar, pero sin red seguimos sirviendo la
  // última versión conocida (offline-first).
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            // Una escritura de caché rechazada (cuota, respuesta opaca) no debe
            // convertirse en un rechazo de la navegación.
            caches.open(CACHE_NAME)
              .then((cache) => cache.put('./index.html', copy))
              .catch(() => {});
          }
          return networkResponse;
        })
        .catch(() => caches.match('./index.html').then((cached) => cached || caches.match('./')))
    );
    return;
  }

  // Solo interceptar y cachear si es un asset estático reconocido del frontend
  if (!isCacheableFrontendAsset(event.request, url)) {
    return;
  }

  // Assets estáticos: Stale-While-Revalidate. La respuesta cacheada se sirve al
  // instante (sin dependencia de red) y se refresca en segundo plano.
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          // Solo almacenar respuestas 200 completas (nunca 206 Partial Content ni errores)
          // y que no tengan directivas explícitas de no-store/private
          if (networkResponse && networkResponse.status === 200) {
            const cacheControl = networkResponse.headers.get('cache-control') || '';
            const contentType = networkResponse.headers.get('content-type') || '';

            if (
              !cacheControl.includes('no-store') &&
              !cacheControl.includes('private') &&
              !contentType.includes('text/event-stream')
            ) {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME)
                .then((cache) => cache.put(event.request, responseToCache))
                .catch(() => {});
            }
          }
          return networkResponse;
        })
        .catch(() => cachedResponse); // Si falla la red, recurrir a la caché

      return cachedResponse || fetchPromise;
    })
  );
});