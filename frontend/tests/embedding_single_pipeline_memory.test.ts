/**
 * Regresión de memoria del motor de embeddings (2c-5).
 *
 * Cambiar de modelo NO puede mantener dos pipelines residentes: el modelo de
 * embeddings ronda los 300 MB, así que solapar la instancia vieja con la nueva
 * duplica el pico justo cuando el navegador está descargando y compilando el
 * reemplazo (el peor momento posible en un portátil de 8 GB).
 *
 * La decisión es explícita y tiene un coste declarado: si la carga nueva falla,
 * el motor queda SIN modelo (estado `error`, `currentModelId = null`) en vez de
 * conservar el anterior. Cargar en dos fases para conservarlo obligaría a
 * aceptar el pico de memoria o a recargar el modelo viejo desde cero, y la
 * identidad del motor ya reporta honestamente «no hay modelo» cuando no lo hay.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';

const MODEL_A = 'onnx-community/embeddinggemma-300m-ONNX';
const MODEL_B = 'Xenova/all-MiniLM-L6-v2';
const wasmCaps = { state: 'supported' as const, backend: 'wasm' as const, deviceLabel: 'WASM' };

test('2c-5: cambiar de modelo libera el pipeline anterior ANTES de crear el nuevo', async () => {
  const engine = new LocalEmbeddingEngine();
  const events: string[] = [];
  let live = 0;
  let peak = 0;
  let seq = 0;

  const createPipeline = async () => {
    const name = `p${(seq += 1)}`;
    events.push(`create:${name}`);
    const pipe: any = async () => ({ data: new Float32Array(8).fill(0.25) });
    live += 1;
    peak = Math.max(peak, live);
    pipe.dispose = async () => {
      live -= 1;
      events.push(`dispose:${name}`);
    };
    return pipe;
  };

  await engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });
  assert.equal(live, 1, 'la primera carga deja exactamente un pipeline');

  await engine.loadModel(MODEL_B, { detectCapabilities: async () => wasmCaps, createPipeline });

  assert.deepEqual(
    events,
    ['create:p1', 'dispose:p1', 'create:p2'],
    'el orden importa: disponer primero es lo que evita el pico de dos modelos'
  );
  assert.equal(peak, 1, 'nunca hay dos pipelines residentes a la vez');
  assert.equal(engine.getLoadedModelId(), MODEL_B);
  assert.equal(engine.getStatus(), 'ready');

  await engine.unload();
  assert.equal(live, 0, 'unload libera la instancia activa');
});

test('2c-5: un cambio de modelo fallido no deja dos pipelines ni anuncia el nuevo', async () => {
  const engine = new LocalEmbeddingEngine();
  const events: string[] = [];
  let live = 0;

  const firstPipe = async () => {
    events.push('create:p1');
    const pipe: any = async () => ({ data: new Float32Array(8) });
    live += 1;
    pipe.dispose = async () => {
      live -= 1;
      events.push('dispose:p1');
    };
    return pipe;
  };

  await engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline: firstPipe });

  await assert.rejects(
    engine.loadModel(MODEL_B, {
      detectCapabilities: async () => wasmCaps,
      createPipeline: async () => {
        events.push('create:failed');
        throw new Error('descarga interrumpida');
      }
    }),
    /descarga interrumpida/
  );

  assert.equal(live, 0, 'la instancia anterior se liberó y la nueva nunca existió');
  assert.deepEqual(events, ['create:p1', 'dispose:p1', 'create:failed']);
  assert.equal(engine.getLoadedModelId(), null, 'no se anuncia un modelo que no está cargado');
  assert.equal(engine.getStatus(), 'error');
});
