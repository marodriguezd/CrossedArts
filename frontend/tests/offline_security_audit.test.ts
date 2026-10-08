import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

test('6.1 Security & Zero Web Access: SQLite operations make 0 network requests', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;

  // Interceptar cualquier llamada de red para auditar 0 accesos web
  globalThis.fetch = async (...args: any[]) => {
    networkCalls++;
    throw new Error(`VIOLATION: Intento de llamada a red no permitida: ${args[0]}`);
  };

  try {
    await dbBridge.init();
    await dao.getKPIs();
    await dao.getCourses();
    await dao.getBooks();
    await dao.getFlashcards();
    await dao.getNotes();
    await dao.getKnowledgeGraph();

    assert.strictEqual(networkCalls, 0, 'No network requests should be executed during database and DAO cycles');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('6.2 Offline Asset Integrity: Local sql-wasm.wasm exists and matches size requirements', () => {
  const wasmPath = path.resolve('public/sql-wasm.wasm');
  assert.ok(fs.existsSync(wasmPath), 'sql-wasm.wasm must exist in public/ directory');

  const stats = fs.statSync(wasmPath);
  assert.ok(stats.size > 500000, `sql-wasm.wasm size should be >500KB, got ${stats.size} bytes`);
});

test('6.3 GitHub Pages Deployment Audit: vite.config.ts enforces relative base path', () => {
  const configPath = path.resolve('vite.config.ts');
  assert.ok(fs.existsSync(configPath), 'vite.config.ts must exist');

  const content = fs.readFileSync(configPath, 'utf8');
  assert.ok(content.includes("base: './'"), "vite.config.ts must explicitly configure base: './' for GitHub Pages");
});

test('6.4 Static Entrypoint Audit: index.html has no untracked external scripts or stylesheets', () => {
  const htmlPath = path.resolve('index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Asegurar que no hay etiquetas <script src="http..."> ni <link href="http..."> externas que violen el aislamiento
  const externalScripts = html.match(/<script[^>]+src=["']http/gi);
  assert.strictEqual(externalScripts, null, 'index.html must not contain external HTTP/HTTPS scripts');

  const externalLinks = html.match(/<link[^>]+href=["']http/gi);
  assert.strictEqual(externalLinks, null, 'index.html must not contain external HTTP/HTTPS links/stylesheets');
});

test('6.5 Runtime Demo Media Audit: seedDemo has 0 remote media URLs and Dashboard/Library have 0 remote fallbacks', () => {
  const seedPath = path.resolve('src/db/seedDemo.ts');
  const seedContent = fs.readFileSync(seedPath, 'utf8');

  // Verificar que no hay URLs remotas de medios en el seed SQL
  const remoteMediaInSeed = seedContent.match(/https?:\/\/[^\s'"]+\.(mp4|webm|jpg|jpeg|png|webp|gif)/gi);
  assert.strictEqual(remoteMediaInSeed, null, 'seedDemo.ts must not contain remote media URLs');

  // Verificar ausencia de dominios de almacenamiento multimedia externo en seed
  assert.ok(!seedContent.includes('images.unsplash.com'), 'seedDemo.ts must not reference unsplash');
  assert.ok(!seedContent.includes('commondatastorage.googleapis.com'), 'seedDemo.ts must not reference googleapis video storage');

  // Verificar Dashboard.tsx y Library.tsx
  const dashboardPath = path.resolve('src/pages/Dashboard.tsx');
  const dashboardContent = fs.readFileSync(dashboardPath, 'utf8');
  assert.ok(!dashboardContent.includes('images.unsplash.com'), 'Dashboard.tsx must not contain remote unsplash fallback');

  const libraryPath = path.resolve('src/pages/Library.tsx');
  const libraryContent = fs.readFileSync(libraryPath, 'utf8');
  assert.ok(!libraryContent.includes('images.unsplash.com'), 'Library.tsx must not contain remote unsplash fallback');
});

test('6.6 Offline PWA Audit: manifest.json exists, uses relative scope and standalone display', () => {
  const manifestPath = path.resolve('public/manifest.json');
  assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist in public/ directory');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.start_url, './');
  assert.strictEqual(manifest.scope, './');
  assert.ok(manifest.theme_color.startsWith('#'));
});

test('6.7 Offline App Shell Audit: sw.js caches core assets without remote endpoints', () => {
  const swPath = path.resolve('public/sw.js');
  assert.ok(fs.existsSync(swPath), 'sw.js must exist in public/ directory');
  const swContent = fs.readFileSync(swPath, 'utf8');
  assert.ok(swContent.includes('sql-wasm.wasm'), 'Service Worker must cache sql-wasm.wasm');
  assert.ok(!swContent.includes('http://'), 'Service Worker must not hardcode remote HTTP endpoints');
  assert.ok(!swContent.includes('https://'), 'Service Worker must not hardcode remote HTTPS endpoints');
});
