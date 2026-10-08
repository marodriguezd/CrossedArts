import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalEmbeddingEngine,
  cosineSimilarity,
  l2NormalizeVector
} from '../src/lib/localEmbeddings/engine.ts';
import {
  embeddingCache,
  expectedDimensionsForModel,
  EMBEDDING_PIPELINE_VERSION
} from '../src/lib/localEmbeddings/cache.ts';
import { isCachedVectorFresh } from '../src/lib/localRag/retrieval.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../src/lib/localEmbeddings/registry.ts';
import type { SemanticChunk } from '../src/lib/localEmbeddings/chunking.ts';

/* -------------------------------------------------------------------------- */
/* Dobles deterministas: sin descarga de modelo ni acceso a red.              */
/* -------------------------------------------------------------------------- */

const NATIVE_DIMENSION = 768; // EmbeddingGemma 300M nativo
const EFFECTIVE_DIMENSION = 256; // Truncado MRL

/**
 * Vector determinista de 768d tipo bolsa de palabras: los dos fragmentos que
 * comparten vocabulario quedan más cerca en coseno que los que no. No es un
 * modelo real, pero reproduce la propiedad semántica que consume el retrieval.
 */
function fakeNativeVector(text: string): Float32Array {
  const body = text.replace(
    /^(task: search result \| query:\s+|title: none \| text:\s+|query:\s+|passage:\s+)/i,
    ''
  );
  const data = new Float32Array(NATIVE_DIMENSION);
  const words = body.toLowerCase().match(/[a-záéíóúñü]+/g) || [];
  for (const word of words) {
    let h = 0x811c9dc5;
    for (let i = 0; i < word.length; i++) {
      h ^= word.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    data[(h % EFFECTIVE_DIMENSION)] += 1;
  }
  // Garantizar norma no nula incluso para texto sin palabras.
  if (words.length === 0) data[0] = 1;
  return data;
}

interface FakePipelineCalls {
  inputs: string[];
  devices: string[];
  dtypes: string[];
}

/**
 * Fábrica de pipeline falsa: registra las entradas reales (prefijos incluidos)
 * y devuelve un tensor NATIVO de 768d, igual que el export ONNX real.
 */
function makeFakePipelineFactory(calls: FakePipelineCalls) {
  return async ({ dtype, device }: { dtype: string; device: string }) => {
    calls.devices.push(device);
    calls.dtypes.push(dtype);
    const pipe: any = async (input: string) => {
      calls.inputs.push(input);
      return { data: fakeNativeVector(input) };
    };
    pipe.dispose = async () => {};
    return pipe;
  };
}

const wasmCaps = { state: 'supported' as const, backend: 'wasm' as const, deviceLabel: 'WASM' };
const webgpuCaps = { state: 'supported' as const, backend: 'webgpu' as const, deviceLabel: 'WebGPU' };

/* -------------------------------------------------------------------------- */

test('Embedding engine: loadModel respeta el backend preferido del registro (wasm) aunque el entorno ofrezca webgpu', async () => {
  const engine = new LocalEmbeddingEngine();
  const calls: FakePipelineCalls = { inputs: [], devices: [], dtypes: [] };

  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => webgpuCaps,
    createPipeline: makeFakePipelineFactory(calls)
  });

  assert.strictEqual(engine.getStatus(), 'ready');
  assert.strictEqual(engine.getBackend(), 'wasm', 'EmbeddingGemma declara preferredBackend=wasm');
  assert.deepStrictEqual(calls.devices, ['wasm']);
  assert.strictEqual(calls.dtypes[0], 'q8');
  assert.strictEqual(engine.getLoadedModelId(), DEFAULT_EMBEDDING_MODEL_ID);
});

test('Embedding engine: embedText produce 256d MRL normalizado L2 desde una salida nativa de 768d', async () => {
  const engine = new LocalEmbeddingEngine();
  const calls: FakePipelineCalls = { inputs: [], devices: [], dtypes: [] };

  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: makeFakePipelineFactory(calls)
  });

  const vector = await engine.embedText('teorema de pitágoras', true);

  assert.strictEqual(vector.length, EFFECTIVE_DIMENSION, 'El contrato efectivo es 256d');
  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
  assert.ok(Math.abs(norm - 1) < 1e-6, `El vector debe estar normalizado L2 (norm=${norm})`);
  // La entrada enviada al pipeline conserva exactamente el prefijo de consulta.
  assert.ok(calls.inputs.some(i => i.startsWith('task: search result | query: ')));
  assert.strictEqual(engine.getStatus(), 'ready');
});

test('Embedding engine: prefijos de documento y consulta son los del modelo, y no se acumulan', async () => {
  const engine = new LocalEmbeddingEngine();
  const seen: string[] = [];
  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => {
      const pipe: any = async (input: string) => {
        seen.push(input);
        return { data: fakeNativeVector(input) };
      };
      pipe.dispose = async () => {};
      return pipe;
    }
  });

  await engine.embedText('fotosíntesis', false);
  await engine.embedText('task: search result | query: fotosíntesis', true);

  assert.strictEqual(seen[0], 'title: none | text: fotosíntesis');
  assert.strictEqual(seen[1], 'task: search result | query: fotosíntesis');
});

test('Embedding engine: una salida nativa incompleta (<768d) se rechaza en lugar de normalizarse', async () => {
  const engine = new LocalEmbeddingEngine();
  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => {
      const pipe: any = async () => ({ data: new Float32Array(128) });
      pipe.dispose = async () => {};
      return pipe;
    }
  });

  await assert.rejects(() => engine.embedText('texto corto', true), /768/);
});

test('Embedding cache: dimensión esperada = salida efectiva MRL (256d), no la nativa (768d)', async () => {
  await embeddingCache.clearCache();

  assert.strictEqual(expectedDimensionsForModel(DEFAULT_EMBEDDING_MODEL_ID), EFFECTIVE_DIMENSION);

  // Un vector de la dimensión efectiva es aceptado.
  await embeddingCache.setEntry({
    chunkId: 'mrl_ok',
    sourceType: 'note',
    sourceId: 'n1',
    title: 'ok',
    text: 'contenido',
    contentHash: 'h_ok',
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: EFFECTIVE_DIMENSION,
    vector: new Array(EFFECTIVE_DIMENSION).fill(0.1),
    updatedAt: Date.now()
  });
  const ok = await embeddingCache.getEntry('mrl_ok', DEFAULT_EMBEDDING_MODEL_ID);
  assert.ok(ok, 'El vector MRL de 256d debe ser visible para la caché');
  assert.strictEqual(ok?.vector.length, EFFECTIVE_DIMENSION);

  // Un vector de 768d (nativo, no truncado) NO satisface el contrato efectivo.
  await embeddingCache.setEntry({
    chunkId: 'native_wrong',
    sourceType: 'note',
    sourceId: 'n2',
    title: 'wrong',
    text: 'contenido',
    contentHash: 'h_wrong',
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: NATIVE_DIMENSION,
    vector: new Array(NATIVE_DIMENSION).fill(0.1),
    updatedAt: Date.now()
  });
  const wrong = await embeddingCache.getEntry('native_wrong', DEFAULT_EMBEDDING_MODEL_ID);
  assert.strictEqual(wrong, null, 'Un vector de 768d no debe considerarse válido para la caché efectiva');

  await embeddingCache.clearCache();
});

test('Embedding engine: indexChunks persiste vectores de 256d y reutiliza la caché sin recomputar', async () => {
  await embeddingCache.clearCache();
  const engine = new LocalEmbeddingEngine();
  let embeddingCalls = 0;

  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => {
      const pipe: any = async (input: string) => {
        embeddingCalls++;
        return { data: fakeNativeVector(input) };
      };
      pipe.dispose = async () => {};
      return pipe;
    }
  });

  const chunks: SemanticChunk[] = [
    { chunkId: 'c1', sourceType: 'note', sourceId: 'n1', title: 'uno', text: 'alpha', contentHash: 'h1' },
    { chunkId: 'c2', sourceType: 'note', sourceId: 'n2', title: 'dos', text: 'beta', contentHash: 'h2' }
  ];

  const first = await engine.indexChunks(chunks);
  assert.strictEqual(first, 2);
  assert.strictEqual(embeddingCalls, 2);

  const stored = await embeddingCache.getEntry('c1', DEFAULT_EMBEDDING_MODEL_ID);
  assert.ok(stored);
  assert.strictEqual(stored?.vector.length, EFFECTIVE_DIMENSION);
  assert.strictEqual(stored?.dimensions, EFFECTIVE_DIMENSION);

  // Segunda pasada: hash y versión coinciden -> cero recomputaciones.
  const second = await engine.indexChunks(chunks);
  assert.strictEqual(second, 0);
  assert.strictEqual(embeddingCalls, 2, 'La caché debe evitar recomputar fragmentos sin cambios');

  await embeddingCache.clearCache();
});

test('Retrieval semántico: los vectores de 256d de la caché se consumen con similitud coseno y vigencia real', async () => {
  await embeddingCache.clearCache();
  const engine = new LocalEmbeddingEngine();

  await engine.loadModel(DEFAULT_EMBEDDING_MODEL_ID, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => {
      const pipe: any = async (input: string) => ({ data: fakeNativeVector(input) });
      pipe.dispose = async () => {};
      return pipe;
    }
  });

  const chunks: SemanticChunk[] = [
    { chunkId: 'note_sem', sourceType: 'note', sourceId: 'n9', title: 'Álgebra', text: 'ecuaciones cuadráticas', contentHash: 'hash_sem' },
    { chunkId: 'note_otra', sourceType: 'note', sourceId: 'n10', title: 'Historia', text: 'revolución francesa', contentHash: 'hash_otra' }
  ];
  await engine.indexChunks(chunks);

  const queryVector = await engine.embedText('ecuaciones cuadráticas', true);

  const cached = await embeddingCache.getAllEntriesForModel(DEFAULT_EMBEDDING_MODEL_ID);
  assert.strictEqual(cached.length, 2);
  for (const entry of cached) {
    assert.strictEqual(entry.vector.length, EFFECTIVE_DIMENSION);
    assert.ok(isCachedVectorFresh(entry, entry.contentHash, EMBEDDING_PIPELINE_VERSION));
  }

  const scored = cached
    .map(entry => ({ chunkId: entry.chunkId, score: cosineSimilarity(queryVector, entry.vector) }))
    .sort((a, b) => b.score - a.score);

  assert.strictEqual(scored[0].chunkId, 'note_sem', 'La consulta debe recuperar el fragmento semánticamente idéntico');
  assert.ok(scored[0].score > 0.6, `Similitud esperada alta, obtenida ${scored[0].score}`);

  // Un cambio de contenido invalida el vector (no se consume material obsoleto).
  assert.strictEqual(isCachedVectorFresh(cached[0], 'otro-hash', EMBEDDING_PIPELINE_VERSION), false);
  // Una versión de pipeline distinta también lo invalida.
  assert.strictEqual(
    isCachedVectorFresh(cached[0], cached[0].contentHash, 'v1.0-deprecated'),
    false
  );

  await embeddingCache.clearCache();
});

test('l2NormalizeVector: rechaza dimensiones incorrectas y valores no finitos', () => {
  assert.throws(() => l2NormalizeVector([1, 2, 3], 4), /dimensiones/);
  assert.throws(() => l2NormalizeVector([1, NaN], 2), /no finito/);
  assert.throws(() => l2NormalizeVector([0, 0], 2), /norma/);
  const v = l2NormalizeVector([3, 4], 2);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-9 && Math.abs(v[1] - 0.8) < 1e-9);
});

test('MemoryVectorIndex: rechaza inserciones y búsquedas con dimensiones incompatibles', async () => {
  const { MemoryVectorIndex } = await import('../src/lib/localEmbeddings/vectorIndex.ts');
  const index = new MemoryVectorIndex(4);

  // Inserción válida de 4d
  index.upsert({ id: 'item1', vector: [1, 0, 0, 0] });
  assert.strictEqual(index.size(), 1);

  // Inserción inválida (3d o 5d) debe lanzar error
  assert.throws(() => {
    index.upsert({ id: 'item_bad', vector: [1, 0, 0] });
  }, /Dimensión de vector incompatible/);

  // Búsqueda con dimensión incompatible debe lanzar error
  assert.throws(() => {
    index.search([1, 0, 0]);
  }, /Dimensión de vector de búsqueda incompatible/);

  // Búsqueda válida con 4d
  const results = index.search([1, 0, 0, 0]);
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].id, 'item1');
  assert.ok(results[0].score > 0.99);
});
