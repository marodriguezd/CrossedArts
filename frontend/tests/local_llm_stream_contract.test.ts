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
// =========================================================================
// Reescrituras del backend: retirada real sin romper el contrato de deltas
// =========================================================================

test('stream: una reescritura divergente retira lo ya emitido con un reemplazo', () => {
  const deltas: string[] = [];
  const replacements: string[] = [];
  const stream = new DeltaStream(d => deltas.push(d), undefined, text => replacements.push(text));

  stream.push('Hola mundo');
  // El backend corrige la caja de una palabra ya entregada: el sufijo nuevo NO
  // puede concatenarse sobre el viejo (antes quedaba «Hola mundoundo!!»).
  stream.push('Hola Mundo!!');

  assert.deepStrictEqual(replacements, ['Hola Mundo!!'], 'el consumidor recibe el texto corregido completo');
  assert.deepStrictEqual(deltas, ['Hola mundo'], 'no se añade el sufijo divergente como si fuera nuevo');
  assert.strictEqual(stream.text, 'Hola Mundo!!', 'el texto reconstruido es el del backend');
  assert.ok(!stream.text.includes('mundoundo'), 'no queda texto obsoleto ni fragmentos repetidos');
});

test('stream: una instantánea más corta retira de verdad lo entregado', () => {
  const replacements: string[] = [];
  const stream = new DeltaStream(() => undefined, undefined, text => replacements.push(text));

  stream.push('Respuesta provisional');
  stream.push('Respuesta');

  assert.deepStrictEqual(replacements, ['Respuesta']);
  assert.strictEqual(stream.text, 'Respuesta', 'la versión larga ya no está en manos del consumidor');
});

test('stream: finish repara un flujo no monótono y deja el texto final exacto', () => {
  const replacements: string[] = [];
  const deltas: string[] = [];
  const stream = new DeltaStream(d => deltas.push(d), undefined, text => replacements.push(text));

  stream.push('Charla sobre SM-2');
  stream.finish('Resumen sobre SM-2');

  assert.deepStrictEqual(replacements, ['Resumen sobre SM-2'], 'la respuesta definitiva sustituye a lo emitido');
  assert.strictEqual(stream.text, 'Resumen sobre SM-2');
  assert.strictEqual(deltas.join(''), 'Charla sobre SM-2');
});

test('stream: con instantáneas monótonas no hay ni un reemplazo', () => {
  const deltas: string[] = [];
  const replacements: string[] = [];
  const stream = new DeltaStream(d => deltas.push(d), undefined, text => replacements.push(text));

  stream.push('Hola');
  stream.push('Hola, ');
  stream.push('Hola, mundo');
  stream.finish('Hola, mundo');

  assert.deepStrictEqual(deltas, ['Hola', ',', ' mundo']);
  assert.deepStrictEqual(replacements, [], 'la ruta normal no paga el coste del evento nuevo');
  assert.strictEqual(stream.text, 'Hola, mundo');
});

test('stream: sin manejador de reemplazo el consumidor de deltas conserva el comportamiento anterior', () => {
  const deltas: string[] = [];
  const stream = new DeltaStream(d => deltas.push(d));

  stream.push('Hola mundo');
  stream.push('Hola Mundo!!');

  // Fallback documentado: nadie puede retirar lo entregado, así que se envía
  // sólo lo posterior al prefijo común. El valor que devuelve `generate()` es
  // la respuesta autoritativa.
  assert.deepStrictEqual(deltas, ['Hola mundo', 'Mundo!!']);
  assert.strictEqual(stream.text, 'Hola mundoMundo!!', 'la concatenación conserva el fragmento obsoleto');
  stream.finish('Hola Mundo!!');
  assert.deepStrictEqual(deltas, ['Hola mundo', 'Mundo!!'], 'finish no puede repararlo sin manejador');
});

test('stream: el reemplazo atraviesa el servicio del tutor hasta el consumidor', async () => {
  const { localLlmEngine } = await import('../src/lib/localLlm/engine.ts');
  const { localAiRuntime } = await import('../src/services/localAiRuntime.ts');
  const { aiService } = await import('../src/ai/aiService.ts');

  const originalGenerate = localLlmEngine.generate;
  const originalEnsureReady = localAiRuntime.ensureLocalAiReady;
  const originalSettings = aiService.getSettings();

  try {
    aiService.saveSettings({ ...originalSettings, provider: 'local', localAiEnabled: true });
    localAiRuntime.ensureLocalAiReady = async () => ({ stage: 'ready' } as any);
    // Doble del motor on-device: entrega un delta y después reescribe lo
    // entregado, que es lo que hace Transformers.js al decodificar el siguiente
    // token sobre los ids acumulados.
    localLlmEngine.generate = async (_messages: any, options: any) => {
      const inner = new DeltaStream(options.onChunk, undefined, options.onReplace);
      inner.push('Hola mundo');
      inner.push('Hola Mundo!!');
      inner.finish('Hola Mundo!!');
      return 'Hola Mundo!!';
    };

    const deltas: string[] = [];
    const replacements: string[] = [];
    const response = await aiService.askTutor(
      [{ role: 'user', content: 'hola' }],
      'C1: React 18',
      delta => deltas.push(delta),
      undefined,
      { onReplace: text => replacements.push(text), disableRetrieval: true }
    );

    assert.deepStrictEqual(
      replacements,
      ['Hola Mundo!!'],
      'el evento de reemplazo llega al consumidor del tutor'
    );
    assert.strictEqual(deltas.join(''), 'Hola mundo', 'el sufijo obsoleto no se concatena');
    assert.strictEqual(response.providerUsed, 'local');
    assert.strictEqual(typeof response.answer, 'string');
  } finally {
    localLlmEngine.generate = originalGenerate;
    localAiRuntime.ensureLocalAiReady = originalEnsureReady;
    aiService.saveSettings(originalSettings);
  }
});
