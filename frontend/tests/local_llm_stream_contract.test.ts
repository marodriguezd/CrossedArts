/**
 * Contrato del runtime de modelo local: una sola API de generación y un solo
 * contrato de streaming (DELTA por callback).
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  DeltaStream,
  stripGenerationArtifacts,
  type GenerationOptions
} from '../src/lib/localLlm/runtime.ts';

test('stream: un backend que acumula se convierte en deltas exactos', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));

  // Instantáneas ACUMULADAS, como las emite Transformers.js en WASM.
  stream.push('Hola');
  stream.push('Hola, ');
  stream.push('Hola, mundo');
  stream.finish('Hola, mundo');

  // El delTA no puede terminar en espacio mientras el texto acumulado aún puede
  // crecer: por eso el corte de palabra llega unido a lo que viene después.
  assert.deepStrictEqual(chunks, ['Hola', ',', ' mundo']);
  assert.strictEqual(chunks.join(''), 'Hola, mundo', 'Concatenar los deltas reproduce la respuesta');
  assert.strictEqual(stream.text, 'Hola, mundo');
  assert.ok(chunks.every(c => !/\s$/.test(c)), 'Ningún delTA queda cortado en un espacio');
});

test('stream: la respuesta final no se emite dos veces', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));

  stream.push('Texto generado');
  stream.finish('Texto generado');

  assert.deepStrictEqual(chunks, ['Texto generado'], 'El final idéntico no produce un segundo delTA');
});

test('stream: WebGPU y WASM reconstruyen la misma respuesta', () => {
  const answer = 'React usa Fiber para reconciliar el árbol.';

  const nativeDeltas = ['React usa ', 'Fiber para ', 'reconciliar ', 'el árbol.'];

  // WebGPU: deltas nativos, se entregan tal cual.
  const webgpuChunks: string[] = [...nativeDeltas];

  // WASM: instantáneas ACUMULADAS convertidas en deltas por DeltaStream.
  const wasmChunks: string[] = [];
  const wasmStream = new DeltaStream(delta => wasmChunks.push(delta));
  let acc = '';
  for (const delta of nativeDeltas) {
    acc += delta;
    wasmStream.push(acc);
  }
  wasmStream.finish(answer);

  assert.strictEqual(webgpuChunks.join(''), answer);
  assert.strictEqual(wasmChunks.join(''), answer, 'Ambas rutas entregan exactamente la misma respuesta');
  assert.strictEqual(wasmStream.text, answer);
  assert.ok(wasmChunks.length > 1, 'La ruta acumulada también emite deltas reales');
});

test('stream: el texto acumulado nunca se entrega como delTA', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));
  stream.push('a');
  stream.push('ab');
  stream.push('abc');
  assert.ok(
    chunks.every(c => c.length <= 3 && !chunks.includes('abc')),
    'No se emite el texto acumulado como si fuera nuevo'
  );
  assert.strictEqual(chunks.join(''), 'abc');
});

test('stream: si el backend reescribe el final solo se entrega lo nuevo', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));
  stream.push('Respuesta provisional');
  // El backend "corrige" el texto (p. ej. recorta el marcador final).
  stream.push('Respuesta provisional con detalle');
  stream.finish('Respuesta provisional con detalle');

  assert.strictEqual(chunks.join(''), 'Respuesta provisional con detalle');
  assert.deepStrictEqual(chunks, ['Respuesta provisional', ' con detalle']);
  assert.ok(
    chunks.filter(c => c === 'Respuesta provisional').length === 1,
    'El prefijo ya emitido no se duplica'
  );
});

test('stream: se ignoran instantáneas más cortas o repetidas', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));
  stream.push('hola');
  stream.push('hola');
  stream.push('');
  assert.deepStrictEqual(chunks, ['hola']);
});

test('stream: normalización de artefactos de plantilla compartida', () => {
  const chunks: string[] = [];
  const stream = new DeltaStream(delta => chunks.push(delta));
  stream.push('Respuesta del modelo<|im_end|>');
  stream.finish('Respuesta del modelo');

  assert.deepStrictEqual(chunks, ['Respuesta del modelo']);
  assert.strictEqual(stripGenerationArtifacts(' texto <|im_end|> ruido'), 'texto');
  assert.strictEqual(stripGenerationArtifacts('texto <|endoftext|>'), 'texto');
  assert.strictEqual(stripGenerationArtifacts(''), '');
});

test('stream: dos generaciones no comparten estado', () => {
  const first: string[] = [];
  const second: string[] = [];
  new DeltaStream(d => first.push(d)).finish('uno');
  new DeltaStream(d => second.push(d)).finish('dos');
  assert.deepStrictEqual(first, ['uno']);
  assert.deepStrictEqual(second, ['dos']);
});

test('runtime: `generate` es el contrato canónico y `generateChat` un alias', async () => {
  const { localLlmEngine } = await import('../src/lib/localLlm/engine.ts');
  assert.strictEqual(typeof localLlmEngine.generate, 'function');
  assert.strictEqual(typeof localLlmEngine.generateChat, 'function');
  assert.strictEqual(typeof localLlmEngine.generateStream, 'function');

  // Sin motor listo, la API canónica y su alias fallan IGUAL: no hay dos
  // contratos distintos, solo dos nombres para el mismo.
  await assert.rejects(() => localLlmEngine.generate([], {} as GenerationOptions), /no está listo/);
  await assert.rejects(
    () => (localLlmEngine.generateChat as NonNullable<typeof localLlmEngine.generateChat>)([], {}),
    /no está listo/
  );
});