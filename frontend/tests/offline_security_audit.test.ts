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

test('6.4 Static Entrypoint Audit: index.html has no untracked external scripts', () => {
  const htmlPath = path.resolve('index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Asegurar que no hay etiquetas <script src="http..."> externas que violen el aislamiento
  const externalScripts = html.match(/<script[^>]+src=["']http/gi);
  assert.strictEqual(externalScripts, null, 'index.html must not contain external HTTP/HTTPS scripts');
});
