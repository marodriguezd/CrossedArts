// Service Worker del app shell offline.
//
// La versión va en el nombre de la caché y `activate` borra las anteriores, así
// que un despliegue nuevo no puede servir un shell viejo. Rutas relativas (`./`)
// por GitHub Pages en subdirectorio.
//
// Nunca entran en Cache Storage: orígenes externos, rutas dinámicas del backend
// (/api/, /docs, /openapi.json, /static/, /media/, /stream/, /content/),
// peticiones con `Authorization`, respuestas Range/206 y JSON de API.
// `sql-wasm.wasm` sí, para que SQLite siga funcionando sin red.

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

const KNOWN_SHELL_FILENAMES = new Set(
  STATIC_SHELL_ASSETS.map((asset) => asset.replace('./', '')).filter(Boolean)
);

/**
 * Ruta pedida, medida desde la raíz del SCOPE y no del origen.
 *
 * El shell se publica bajo un prefijo en GitHub Pages, así que comparar contra
 * `/api/` a secas dejaba las rutas dinámicas de un backend del mismo origen
 * fuera del guard cuando el sitio vivía en un subdirectorio.
 */
function scopeRelativePath(pathname) {
  const scope = self.registration?.scope ? new URL(self.registration.scope).pathname : '/';
  if (scope !== '/' && pathname.startsWith(scope)) {
    return `/${pathname.slice(scope.length)}`;
  }
  return pathname;
}

const STATIC_ASSET_EXTENSIONS = /\.(?:js|mjs|css|wasm|html|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf|webmanifest)$/i;

/**
 * Determina si una petición corresponde a una ruta dinámica del backend,
 * API, streaming de medios o datos de usuario que NUNCA deben cachearse.
 */
function isDynamicOrBackendRequest(request, url) {
  const pathname = scopeRelativePath(url.pathname);

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

  if (pathname.includes('/assets/')) {
    return true;
  }

  const basename = pathname.substring(pathname.lastIndexOf('/') + 1);
  if (basename && KNOWN_SHELL_FILENAMES.has(basename)) {
    return true;
  }

  if (STATIC_ASSET_EXTENSIONS.test(pathname)) {
    return true;
  }

  // Cualquier otra ruta del mismo origen (datos dinámicos, GET desconocidos) queda fuera.
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

  if (event.request.method !== 'GET') return;

  // Ollama, APIs de IA y CDNs: ningún origen externo entra en la caché.
  if (url.origin !== self.location.origin) return;

  if (isDynamicOrBackendRequest(event.request, url)) {
    return;
  }

  // Navegación: red primero para que un despliegue nuevo traiga su index.html,
  // con la última copia conocida como respaldo cuando no hay red.
  if (event.request.mode === 'navigate') {
    const navigationResponse = fetch(event.request);
    // La copia del shell va por su propia cadena: no retrasa la navegación y
    // queda dentro de `waitUntil`, así que el evento no la mata al cerrarse.
    const cacheUpdate = navigationResponse
      .then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200) return undefined;
        const copy = networkResponse.clone();
        return caches.open(CACHE_NAME).then((cache) => cache.put('./index.html', copy));
      })
      .catch(() => {});
    event.waitUntil(cacheUpdate);
    event.respondWith(
      navigationResponse.catch(() =>
        caches.match('./index.html').then((cached) => cached || caches.match('./'))
      )
    );
    return;
  }

  if (!isCacheableFrontendAsset(event.request, url)) {
    return;
  }

  // Assets estáticos: Stale-While-Revalidate. La respuesta cacheada se sirve al
  // instante y el refresco se entrega a `waitUntil`: sin eso el worker puede
  // morir al cerrar el evento y la revalidación se pierde en silencio.
  const networkUpdate = fetch(event.request)
    .then((networkResponse) => {
      if (!networkResponse || networkResponse.status !== 200) return networkResponse;

      const cacheControl = networkResponse.headers.get('cache-control') || '';
      const contentType = networkResponse.headers.get('content-type') || '';
      const cacheable =
        !cacheControl.includes('no-store') &&
        !cacheControl.includes('private') &&
        !contentType.includes('text/event-stream');
      if (!cacheable) return networkResponse;

      const responseToCache = networkResponse.clone();
      return caches
        .open(CACHE_NAME)
        .then((cache) => cache.put(event.request, responseToCache))
        .then(() => networkResponse);
    })
    .catch(() => undefined);

  event.waitUntil(networkUpdate);

  event.respondWith(
    caches.match(event.request).then(async (cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      const networkResponse = await networkUpdate;
      if (!networkResponse) throw new Error(`Ni red ni caché para ${event.request.url}`);
      return networkResponse;
    })
  );
});