import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as vm from 'node:vm';

const SW_SOURCE = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const SITE_ORIGIN = 'https://app.example';
// GitHub Pages sirve el shell bajo un prefijo: ambas formas tienen que pasar.
const SCOPES = [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/CrossedArts/`];

interface ServiceWorkerSandbox {
  scope?: string;
  caches?: Record<string, unknown>;
  fetch?: (request: Request) => Promise<Response>;
}

/**
 * Evalúa el `sw.js` REAL en un contexto aislado y devuelve sus funciones y sus
 * handlers. Copiar las funciones dentro del test dejaba pasar los bugs del
 * worker (el guard de `/api/` bajo subdirectorio, por ejemplo): se comprobaba
 * la copia, no el archivo.
 */
function loadServiceWorker(options: ServiceWorkerSandbox = {}) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const context = vm.createContext({
    self: {
      addEventListener: (name: string, handler: (event: unknown) => void) => {
        handlers[name] = handler;
      },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      location: { origin: SITE_ORIGIN },
      registration: { scope: options.scope ?? `${SITE_ORIGIN}/` }
    },
    caches: options.caches ?? {
      match: async () => undefined,
      open: async () => ({ put: async () => {}, add: async () => {} }),
      keys: async () => []
    },
    fetch: options.fetch ?? (async () => new Response('ok', { status: 200 })),
    console,
    URL,
    Request,
    Response,
    Error
  });

  const api = vm.runInContext(
    `${SW_SOURCE}
     ;({
       isDynamicOrBackendRequest,
       isCacheableFrontendAsset,
       STATIC_SHELL_ASSETS,
       KNOWN_SHELL_FILENAMES,
       APP_SHELL_VERSION,
       CACHE_PREFIX
     });`,
    context
  );

  return { api, handlers };
}

test('SW-1: Service Worker defines explicit version and prefix', () => {
  const { api } = loadServiceWorker();

  assert.match(api.APP_SHELL_VERSION, /^v\d+$/, 'Must have explicit version');
  assert.equal(api.CACHE_PREFIX, 'crossedarts-shell-', 'Must define cache prefix');
  assert.ok(SW_SOURCE.includes('${CACHE_PREFIX}${APP_SHELL_VERSION}'), 'Cache name must include version');
});

test('SW-2: Dynamic backend routes (/api/, /api/v1/, /docs, /openapi.json, /static/, /media/, /stream/, /content/) are strictly bypassed', () => {
  for (const scope of SCOPES) {
    const { api } = loadServiceWorker({ scope });
    const plain = { headers: new Headers() };
    const url = (path: string) => new URL(path, scope);

    for (const path of [
      'api/v1/courses',
      'api/health',
      'docs',
      'openapi.json',
      'static/a.css',
      'media/1/stream',
      'stream/1',
      'content/abc'
    ]) {
      const resolved = url(path);
      assert.equal(api.isDynamicOrBackendRequest(plain, resolved), true, `${resolved.pathname} debe ser dinámica`);
      assert.equal(api.isCacheableFrontendAsset(plain, resolved), false, `${resolved.pathname} no debe cachearse`);
    }
  }
});

test('SW-3: Dynamic headers (range, authorization, event-stream) are bypassed from cache', () => {
  const { api } = loadServiceWorker();
  const asset = new URL(`${SITE_ORIGIN}/assets/index-abc.js`);

  assert.equal(api.isDynamicOrBackendRequest({ headers: new Headers({ authorization: 'Bearer x' }) }, asset), true);
  assert.equal(api.isDynamicOrBackendRequest({ headers: new Headers({ range: 'bytes=0-1024' }) }, asset), true);
  assert.equal(api.isDynamicOrBackendRequest({ headers: new Headers({ range: 'bytes=0-1024' }) }, asset), true);
  assert.equal(api.isCacheableFrontendAsset({ headers: new Headers({ authorization: 'Bearer x' }) }, asset), false);

  assert.ok(SW_SOURCE.includes("!cacheControl.includes('no-store')"), 'Must respect no-store');
  assert.ok(SW_SOURCE.includes("!cacheControl.includes('private')"), 'Must respect private cache-control');
});

test('SW-4: Static frontend assets and app shell navigation remain cacheable and offline-first', () => {
  for (const scope of SCOPES) {
    const { api } = loadServiceWorker({ scope });
    const plain = { headers: new Headers() };

    for (const path of ['assets/index-abc.js', 'sql-wasm.wasm', 'manifest.json', 'favicon.svg', 'index.html']) {
      const resolved = new URL(path, scope);
      assert.equal(api.isDynamicOrBackendRequest(plain, resolved), false, `${resolved.pathname} es estática`);
      assert.equal(api.isCacheableFrontendAsset(plain, resolved), true, `${resolved.pathname} debe cachearse`);
    }
  }

  assert.ok(SW_SOURCE.includes("event.request.mode === 'navigate'"), 'Must handle navigation fallback');
  assert.ok(SW_SOURCE.includes("caches.match('./index.html')"), 'Must fall back to cached index.html offline');
});

test('SW-5: la lista blanca no cachea rutas arbitrarias del mismo origen', () => {
  for (const scope of SCOPES) {
    const { api } = loadServiceWorker({ scope });
    const plain = { headers: new Headers() };

    for (const path of ['custom-dynamic', 'user-data', 'data.json', 'some/path']) {
      const resolved = new URL(path, scope);
      assert.equal(api.isCacheableFrontendAsset(plain, resolved), false, `${resolved.pathname} no es un asset`);
    }
  }
});

test('SW-6: la revalidación en segundo plano se entrega a waitUntil', async () => {
  const requested: string[] = [];
  const stored: string[] = [];
  const { handlers } = loadServiceWorker({
    caches: {
      match: async () => new Response('cached', { status: 200 }),
      open: async () => ({
        put: async (request: Request) => {
          stored.push(request.url);
        },
        add: async () => {}
      }),
      keys: async () => []
    },
    fetch: async (request: Request) => {
      requested.push(request.url);
      return new Response('fresh', { status: 200, headers: { 'content-type': 'text/javascript' } });
    }
  });

  const waited: Promise<unknown>[] = [];
  let responded: Promise<Response> | undefined;
  const assetUrl = `${SITE_ORIGIN}/assets/index-abc.js`;

  handlers.fetch({
    request: new Request(assetUrl),
    respondWith: (promise: Promise<Response>) => {
      responded = promise;
    },
    waitUntil: (promise: Promise<unknown>) => {
      waited.push(promise);
    }
  });

  assert.equal(waited.length, 1, 'sin waitUntil el worker muere antes de revalidar');
  assert.ok(responded, 'el evento debe responder');
  assert.equal(await (await responded!).text(), 'cached', 'la caché se sirve al instante');

  await Promise.all(waited);
  assert.deepEqual(requested, [assetUrl], 'una sola petición de red');
  assert.deepEqual(stored, [assetUrl], 'el refresco se escribe en la caché');
});

test('SW-7: la lista del shell coincide con la que usa el build para el BUILD_ID', () => {
  const config = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const match = config.match(/const STATIC_SHELL_ASSETS = \[([^\]]*)\];/);
  assert.ok(match, 'vite.config.ts debe declarar STATIC_SHELL_ASSETS');

  const fromConfig = match![1]
    .split(',')
    .map((value) => value.trim().replace(/^'|'$/g, ''))
    .filter(Boolean);

  const { api } = loadServiceWorker();
  assert.deepEqual(
    [...api.STATIC_SHELL_ASSETS].sort(),
    [...fromConfig].sort(),
    'si las dos listas divergen, el BUILD_ID deja de describir el precache real'
  );
  assert.equal(api.KNOWN_SHELL_FILENAMES.size, fromConfig.filter((asset) => asset !== './').length);
});
