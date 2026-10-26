import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  ORT_RUNTIME_DIRECTORY,
  ORT_RUNTIME_FILES,
  ORT_RUNTIME_GLUE_FILES,
  configureOnnxRuntimeWasm,
  resolveOrtRuntimeBase,
  resolveOrtThreadCount
} from '../src/lib/localEmbeddings/ortRuntime.ts';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST_ROOT = path.join(FRONTEND_ROOT, 'dist');

/**
 * Build-artifact contract tests need `npm run build` first.
 *
 * CI runs `typecheck -> test -> build` (and AGENTS.md documents the same
 * order), so `dist/` does not exist yet when the suite runs in a clean clone.
 * Skipping keeps the suite honest: the artifact checks still run wherever a
 * build is present instead of failing the pipeline for a missing precondition.
 */
const BUILD_AVAILABLE = existsSync(path.join(DIST_ROOT, 'index.html'));
const BUILD_SKIP_REASON =
  BUILD_AVAILABLE === false ? 'requiere un build previo (`npm run build`)' : false;

test('P0.1 ortRuntime: el runtime ONNX se resuelve bajo la base del sitio', () => {
  assert.equal(
    resolveOrtRuntimeBase('https://example.test/CrossedArts/'),
    `https://example.test/CrossedArts/${ORT_RUNTIME_DIRECTORY}/`
  );
  assert.equal(
    resolveOrtRuntimeBase('https://example.test/'),
    `https://example.test/${ORT_RUNTIME_DIRECTORY}/`
  );
  // Sin base (worker o test aislado) nunca produce una URL relativa inválida.
  assert.equal(resolveOrtRuntimeBase(undefined), `http://localhost/${ORT_RUNTIME_DIRECTORY}/`);
});

test('P0.1 ortRuntime: el número de hilos respeta SharedArrayBuffer', () => {
  // GitHub Pages no envía COOP/COEP: multihilo real no está disponible.
  assert.equal(resolveOrtThreadCount(false, 16), 1);
  assert.equal(resolveOrtThreadCount(undefined, 16), 1);
  assert.equal(resolveOrtThreadCount(true, 16), 4);
  assert.equal(resolveOrtThreadCount(true, 2), 2);
  assert.equal(resolveOrtThreadCount(true, undefined), 2);
});

test('P0.1 ortRuntime: configureOnnxRuntimeWasm apunta a los artefactos locales', () => {
  const env = { backends: { onnx: { wasm: { wasmPaths: 'https://cdn.jsdelivr.net/npm/x/dist/' } } } };

  const applied = configureOnnxRuntimeWasm(env, {
    baseUri: 'https://example.test/CrossedArts/',
    crossOriginIsolated: false
  });

  assert.equal(applied, 'https://example.test/CrossedArts/ort/');
  assert.equal(env.backends.onnx.wasm.wasmPaths, 'https://example.test/CrossedArts/ort/');
  assert.equal(env.backends.onnx.wasm.numThreads, 1);
  assert.doesNotMatch(String(env.backends.onnx.wasm.wasmPaths), /cdn\.jsdelivr\.net/);
});

test('P0.1 ortRuntime: un wasmPaths explícito (worker) tiene prioridad', () => {
  const env = { backends: { onnx: { wasm: {} as Record<string, unknown> } } };
  const applied = configureOnnxRuntimeWasm(env, {
    baseUri: 'https://ignored.test/',
    wasmPaths: 'https://example.test/app/ort/',
    crossOriginIsolated: true,
    numThreads: 2
  });
  assert.equal(applied, 'https://example.test/app/ort/');
  assert.equal((env.backends.onnx.wasm as Record<string, unknown>).numThreads, 2);
});

test('P0.1 ortRuntime: un env sin backend ONNX no lanza', () => {
  assert.equal(configureOnnxRuntimeWasm({}), null);
  assert.equal(configureOnnxRuntimeWasm({ backends: {} }), null);
});

test('SP1 ortRuntime: proxy sólo cuando se pide, y nunca heredado', () => {
  const withProxy = { backends: { onnx: { wasm: {} as Record<string, unknown> } } };
  configureOnnxRuntimeWasm(withProxy, { proxy: true });
  assert.equal((withProxy.backends.onnx.wasm as Record<string, unknown>).proxy, true);

  // Sin pedirlo se fija a false: un realm reutilizado no puede quedarse con el
  // valor anterior y mover la inferencia de sitio por sorpresa.
  const withoutProxy = { backends: { onnx: { wasm: { proxy: true } as Record<string, unknown> } } };
  configureOnnxRuntimeWasm(withoutProxy, {});
  assert.equal((withoutProxy.backends.onnx.wasm as Record<string, unknown>).proxy, false);
});

test('P0.1 build: dist entrega el runtime ONNX con nombres estables y sin CDN', { skip: BUILD_SKIP_REASON }, () => {
  for (const file of ORT_RUNTIME_FILES) {
    const emitted = path.join(DIST_ROOT, ORT_RUNTIME_DIRECTORY, file);
    assert.ok(existsSync(emitted), `El build no emitió ${ORT_RUNTIME_DIRECTORY}/${file}`);
    assert.ok(readFileSync(emitted).byteLength > 1000, `${file} está vacío`);
  }

  // El glue se importa en tiempo de ejecución desde `wasmPaths` (un directorio):
  // sin él, ONNX Runtime no arranca ni en el hilo principal ni en su proxy.
  for (const file of ORT_RUNTIME_GLUE_FILES) {
    const emitted = path.join(DIST_ROOT, ORT_RUNTIME_DIRECTORY, file);
    assert.ok(existsSync(emitted), `El build no emitió el glue ${ORT_RUNTIME_DIRECTORY}/${file}`);
    const source = readFileSync(emitted, 'utf8');
    assert.ok(source.length > 1000, `${file} está vacío`);
    assert.ok(!source.includes('cdn.jsdelivr.net'), `${file} conserva el CDN`);
  }

  // Una sola copia del binario: el asset con hash de Rollup queda fuera.
  const assetsDir = path.join(DIST_ROOT, 'assets');
  const hashedOrtCopies = existsSync(assetsDir)
    ? readdirSync(assetsDir).filter(name => /^ort-wasm-.*\.wasm$/.test(name))
    : [];
  assert.deepEqual(hashedOrtCopies, [], `duplicado del runtime ONNX en dist/assets: ${hashedOrtCopies.join(', ')}`);

  // Ningún chunk del build puede conservar el CDN por defecto de Transformers.
  const offenders: string[] = [];
  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith('.js')) continue;
    const content = readFileSync(path.join(assetsDir, name), 'utf8');
    if (content.includes('cdn.jsdelivr.net')) offenders.push(name);
  }
  const swPath = path.join(DIST_ROOT, 'sw.js');
  if (existsSync(swPath) && readFileSync(swPath, 'utf8').includes('cdn.jsdelivr.net')) {
    offenders.push('sw.js');
  }
  assert.deepEqual(offenders, [], `chunks con CDN externo: ${offenders.join(', ')}`);
});
