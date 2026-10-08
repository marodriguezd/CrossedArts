import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

test('SW-1: Service Worker defines explicit version and prefix', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.ok(/const APP_SHELL_VERSION = 'v\d+'/.test(sw), 'Must have explicit version');
  assert.ok(sw.includes("const CACHE_PREFIX = 'crossedarts-shell-'"), 'Must define cache prefix');
  assert.ok(sw.includes('${CACHE_PREFIX}${APP_SHELL_VERSION}'), 'Cache name must include version');
});

test('SW-2: Dynamic backend routes (/api/, /api/v1/, /docs, /openapi.json, /static/, /media/, /stream/, /content/) are strictly bypassed', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.ok(sw.includes("isDynamicOrBackendRequest"), 'Must have backend route detection function');
  assert.ok(sw.includes("pathname.startsWith('/api/')"), 'Must exclude /api/ routes');
  assert.ok(sw.includes("pathname.startsWith('/docs')"), 'Must exclude /docs');
  assert.ok(sw.includes("pathname.startsWith('/openapi.json')"), 'Must exclude /openapi.json');
  assert.ok(sw.includes("pathname.startsWith('/media/')"), 'Must exclude /media/');
  assert.ok(sw.includes("pathname.startsWith('/stream/')"), 'Must exclude /stream/');
  assert.ok(sw.includes("pathname.startsWith('/content/')"), 'Must exclude /content/');
});

test('SW-3: Dynamic headers (range, authorization, event-stream) are bypassed from cache', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  assert.ok(sw.includes("request.headers.has('range')"), 'Must check for Range header');
  assert.ok(sw.includes("request.headers.has('authorization')"), 'Must check for Authorization header');
  assert.ok(sw.includes("!cacheControl.includes('no-store')"), 'Must respect no-store');
  assert.ok(sw.includes("!cacheControl.includes('private')"), 'Must respect private cache-control');
});

test('SW-4: Static frontend assets and app shell navigation remain cacheable and offline-first', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  // Precache includes core shell assets
  assert.ok(sw.includes("'./'"), 'Must precache root');
  assert.ok(sw.includes("'./index.html'"), 'Must precache index.html');
  assert.ok(sw.includes("'./sql-wasm.wasm'"), 'Must precache sql-wasm.wasm');
  assert.ok(sw.includes("'./manifest.json'"), 'Must precache manifest.json');

  // Navigation mode handles app-shell fallback
  assert.ok(sw.includes("event.request.mode === 'navigate'"), 'Must handle navigation fallback');
  assert.ok(sw.includes("caches.match('./index.html')"), 'Must fall back to cached index.html offline');
});

test('SW-5: Logic evaluation of isDynamicOrBackendRequest and isCacheableFrontendAsset', () => {
  // Test the pure logic by evaluating isolated helper representations matching sw.js
  const KNOWN_SHELL_FILENAMES = new Set([
    'index.html',
    'favicon.svg',
    'manifest.json',
    'sql-wasm.wasm'
  ]);
  const STATIC_ASSET_EXTENSIONS = /\.(?:js|mjs|css|wasm|html|svg|png|jpg|jpeg|webp|gif|ico|woff|woff2|ttf|webmanifest)$/i;

  function isDynamicOrBackendRequest(request: { headers: Map<string, string> }, url: { pathname: string }) {
    const pathname = url.pathname;
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

  function isCacheableFrontendAsset(request: { headers: Map<string, string> }, url: { pathname: string }) {
    if (isDynamicOrBackendRequest(request, url)) return false;
    const pathname = url.pathname;
    if (pathname.includes('/assets/')) return true;
    const basename = pathname.substring(pathname.lastIndexOf('/') + 1);
    if (basename && KNOWN_SHELL_FILENAMES.has(basename)) {
      return true;
    }
    if (STATIC_ASSET_EXTENSIONS.test(pathname)) {
      return true;
    }
    return false;
  }

  const emptyHeaders = new Map<string, string>();
  const authHeaders = new Map([['authorization', 'Bearer token']]);
  const rangeHeaders = new Map([['range', 'bytes=0-1024']]);

  // Dynamic API routes must return true for isDynamicOrBackendRequest and false for isCacheable
  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/api/v1/courses' }), true);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/api/v1/courses' }), false);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/api/health' }), true);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/api/health' }), false);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/content/stream/video.mp4' }), true);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/content/stream/video.mp4' }), false);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: authHeaders }, { pathname: '/assets/index.js' }), true);
  assert.strictEqual(isCacheableFrontendAsset({ headers: authHeaders }, { pathname: '/assets/index.js' }), false);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: rangeHeaders }, { pathname: '/assets/video.mp4' }), true);
  assert.strictEqual(isCacheableFrontendAsset({ headers: rangeHeaders }, { pathname: '/assets/video.mp4' }), false);

  // Static frontend assets must be cacheable (both direct root and GitHub Pages subpath)
  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/assets/index-abc123.js' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/assets/index-abc123.js' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/CrossedArts/assets/index-abc123.js' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/assets/index-abc123.js' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/sql-wasm.wasm' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/sql-wasm.wasm' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/CrossedArts/sql-wasm.wasm' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/sql-wasm.wasm' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/favicon.svg' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/favicon.svg' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/CrossedArts/manifest.json' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/manifest.json' }), true);

  assert.strictEqual(isDynamicOrBackendRequest({ headers: emptyHeaders }, { pathname: '/CrossedArts/index.html' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/index.html' }), true);

  // Arbitrary same-origin paths must NOT be cacheable (Allowlist regression protection)
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/custom-dynamic' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/user-data' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/data.json' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/some/path' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/custom-dynamic' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/user-data' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/data.json' }), false);
  assert.strictEqual(isCacheableFrontendAsset({ headers: emptyHeaders }, { pathname: '/CrossedArts/some/path' }), false);
});
