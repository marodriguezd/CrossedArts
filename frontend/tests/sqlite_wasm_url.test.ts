import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveSqliteWasmUrl,
  deployedSqliteWasmFilename,
  SQLITE_WASM_FILENAME
} from '../src/db/sqliteWasmUrl.ts';

// ---------------------------------------------------------------------------
// H. Resolución de la URL del WASM de SQLite en producción
//
// Defecto real: Vite resuelve `sql.js` por su condición `browser` del
// package.json, cuya build de Emscripten pide `sql-wasm-browser.wasm` (un
// fichero que no desplegamos), y el `locateFile` anterior devolvía una ruta
// `./${file}` anclada al bundle en lugar del documento desplegado. El navegador
// recibía un 404 del WASM y mostraba "No se pudo cargar el motor SQLite".
// ---------------------------------------------------------------------------

test('18.1 Resolves the shipped WASM against the GitHub Pages project base', () => {
  const url = resolveSqliteWasmUrl(
    'sql-wasm.wasm',
    'https://marodriguezd.github.io/CrossedArts/'
  );
  assert.equal(url, 'https://marodriguezd.github.io/CrossedArts/sql-wasm.wasm');
});

test('18.2 Resolves against any static-hosting base without hard-coding the repo name', () => {
  const other = resolveSqliteWasmUrl('sql-wasm.wasm', 'https://example.com/my-app/');
  assert.equal(other, 'https://example.com/my-app/sql-wasm.wasm');
  // Nunca debe caer bajo /assets/, donde Vite coloca los chunks con hash.
  assert.notEqual(other, 'https://example.com/my-app/assets/sql-wasm.wasm');
  // Y nunca en la raíz del dominio, que rompería un despliegue de subdirectorio.
  assert.notEqual(other, 'https://example.com/sql-wasm.wasm');
});

test('18.3 Browser resolution is anchored to the document, not to the JS bundle directory', () => {
  const documentBase = 'https://marodriguezd.github.io/CrossedArts/';
  const bundleDir = 'https://marodriguezd.github.io/CrossedArts/assets/';

  const fromDocument = resolveSqliteWasmUrl(SQLITE_WASM_FILENAME, documentBase);
  const fromBundle = resolveSqliteWasmUrl(SQLITE_WASM_FILENAME, bundleDir);

  assert.equal(fromDocument, 'https://marodriguezd.github.io/CrossedArts/sql-wasm.wasm');
  assert.notEqual(
    fromDocument,
    fromBundle,
    'La URL del WASM no debe depender del directorio del bundle JS'
  );
});

test('18.4 The sql.js browser-build filename is normalized to the deployed file', () => {
  // La build `browser` de sql.js (la que Vite resuelve en el cliente) pide
  // `sql-wasm-browser.wasm`; debemos pedir el fichero realmente desplegado.
  assert.equal(deployedSqliteWasmFilename('sql-wasm-browser.wasm'), SQLITE_WASM_FILENAME);
  assert.equal(deployedSqliteWasmFilename('sql-wasm.wasm'), SQLITE_WASM_FILENAME);
  assert.equal(SQLITE_WASM_FILENAME, 'sql-wasm.wasm');

  // Cadena completa tal como la ejecuta `locateFile` en el navegador.
  const resolved = resolveSqliteWasmUrl(
    deployedSqliteWasmFilename('sql-wasm-browser.wasm'),
    'https://marodriguezd.github.io/CrossedArts/'
  );
  assert.equal(resolved, 'https://marodriguezd.github.io/CrossedArts/sql-wasm.wasm');
});

test('18.5 sqliteBridge resolves the browser WASM from document.baseURI', () => {
  const bridge = readFileSync(new URL('../src/db/sqliteBridge.ts', import.meta.url), 'utf8');

  assert.ok(bridge.includes('resolveSqliteWasmUrl'), 'El puente debe usar el helper puro de resolución');
  assert.ok(bridge.includes('deployedSqliteWasmFilename'), 'El puente debe normalizar el nombre del WASM');
  assert.ok(bridge.includes('document.baseURI'), 'La base debe ser el documento desplegado, no el bundle');
  // El patrón frágil anterior no debe reaparecer.
  assert.ok(!bridge.includes('`./${file}`'), 'No debe volver a construirse una ruta `./` relativa al bundle');
  // El entorno Node.js de tests sigue usando el binario local leído del disco.
  assert.ok(bridge.includes('wasmBinary'), 'El entorno Node debe seguir usando wasmBinary local sin red');
  assert.ok(bridge.includes('public/sql-wasm.wasm'), 'El fallback Node sigue apuntando al WASM local');
});

test('18.6 The service worker precaches the same deployed-relative WASM URL', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.ok(sw.includes("'./sql-wasm.wasm'"), 'El SW debe precachear el WASM de forma relativa a su ámbito');
  assert.ok(!sw.includes("'/sql-wasm.wasm'"), 'El SW no debe usar una ruta absoluta de raíz');
  assert.ok(!sw.includes('/assets/sql-wasm.wasm'), 'El WASM no vive bajo /assets/');
});
