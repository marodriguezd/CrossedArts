import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  LocalAiRuntime,
  LOCAL_AI_CONSENT_KEY,
  type LocalAiRuntimeDeps
} from '../src/services/localAiRuntime.ts';
import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../src/lib/localEmbeddings/registry.ts';
import {
  EMBEDDING_MODEL_STORAGE_KEY,
  getStoredEmbeddingModelId,
  setStoredEmbeddingModelId
} from '../src/services/embeddingModelPreference.ts';
import { getLocalModelById } from '../src/lib/localLlm/registry.ts';

/**
 * P1.2 — La indexación automática respeta el modelo de embeddings elegido.
 *
 * Antes cargaba SIEMPRE el modelo por defecto y purgaba todo lo demás, de modo
 * que la selección del usuario se perdía y su caché se borraba en cada pasada.
 */

const SELECTED = 'Xenova/multilingual-e5-small';

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map
  };
}

function makeEmbeddingEngine(initial: { status?: string; modelId?: string | null } = {}) {
  const state = {
    status: initial.status ?? 'idle',
    modelId: initial.modelId ?? null,
    loads: [] as string[],
    pruned: [] as string[],
    builds: [] as string[],
    indexed: 0
  };
  return {
    state,
    getStatus: () => state.status,
    getLoadedModelId: () => state.modelId,
    loadModel: async (id: string) => {
      state.loads.push(id);
      state.modelId = id;
      state.status = 'ready';
    },
    pruneStaleCache: async (active?: string) => {
      if (active) state.pruned.push(active);
      return 0;
    },
    indexChunks: async (chunks: any[], onProgress?: (n: number, t: number) => void) => {
      state.indexed += chunks.length;
      onProgress?.(chunks.length, chunks.length);
      return chunks.length;
    },
    cancelIndexing: () => undefined,
    markDirty: () => undefined,
    isDirty: () => false,
    clearDirty: () => undefined
  };
}

function makeRuntime(selectedModelId: string, initialEngine?: { status?: string; modelId?: string | null }) {
  const embeddingEngine = makeEmbeddingEngine(initialEngine);
  const deps: LocalAiRuntimeDeps = {
    llmEngine: {
      getStatus: () => 'idle',
      getLoadedModelId: () => null,
      loadModel: async () => undefined
    },
    embeddingEngine,
    detectCapabilities: async () => ({ state: 'supported', supportedFeatures: [], deviceTier: 'unknown' }) as any,
    isOnline: () => true,
    isBrowser: () => true,
    storage: makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' }),
    loadResources: async () => ({ courses: [], books: [], notes: [], flashcards: [], concepts: [] }),
    buildChunks: async (_resources, modelId) => {
      embeddingEngine.state.builds.push(modelId);
      return [{ chunkId: 'c1', sourceType: 'note', sourceId: 'n1', title: 't', text: 'x', contentHash: 'h1' }];
    },
    getModelDefinition: getLocalModelById,
    getSelectedEmbeddingModelId: () => selectedModelId
  };
  return { runtime: new LocalAiRuntime(deps), embeddingEngine };
}

test('P1.2: el modelo elegido se persiste y se valida contra el registro', () => {
  const storage = makeStorage();
  assert.equal(getStoredEmbeddingModelId(storage), DEFAULT_EMBEDDING_MODEL_ID);

  assert.equal(setStoredEmbeddingModelId(SELECTED, storage), true);
  assert.equal(storage.raw.get(EMBEDDING_MODEL_STORAGE_KEY), SELECTED);
  assert.equal(getStoredEmbeddingModelId(storage), SELECTED);

  // Un id desconocido no se escribe ni se lee.
  assert.equal(setStoredEmbeddingModelId('modelo/inventado', storage), false);
  assert.equal(getStoredEmbeddingModelId(storage), SELECTED);

  storage.raw.set(EMBEDDING_MODEL_STORAGE_KEY, 'modelo/inventado');
  assert.equal(getStoredEmbeddingModelId(storage), DEFAULT_EMBEDDING_MODEL_ID);
});

test('P1.2: la indexación carga y conserva el modelo seleccionado, no el de por defecto', async () => {
  const { runtime, embeddingEngine } = makeRuntime(SELECTED);

  await runtime.ensureSemanticIndexReady('local');

  assert.deepEqual(embeddingEngine.state.loads, [SELECTED], 'solo se carga el modelo elegido');
  assert.deepEqual(embeddingEngine.state.builds, [SELECTED], 'los chunks se construyen para ese modelo');
  assert.deepEqual(embeddingEngine.state.pruned, [SELECTED], 'nunca se purga el modelo activo');
  assert.equal(embeddingEngine.state.indexed, 1);
});

test('P1.2: una segunda pasada reutiliza el motor y no cambia de modelo', async () => {
  const { runtime, embeddingEngine } = makeRuntime(SELECTED);

  await runtime.ensureSemanticIndexReady('local');
  await runtime.ensureSemanticIndexReady('local');

  assert.deepEqual(embeddingEngine.state.loads, [SELECTED], 'no se recarga el modelo en la segunda pasada');
  assert.deepEqual(embeddingEngine.state.builds, [SELECTED, SELECTED]);
  assert.deepEqual(embeddingEngine.state.pruned, [SELECTED, SELECTED]);
});

test('P1.2: un motor ya cargado con otro modelo mantiene su identidad', async () => {
  const other = 'Xenova/all-MiniLM-L6-v2';
  const { runtime, embeddingEngine } = makeRuntime(SELECTED, { status: 'ready', modelId: other });

  await runtime.ensureSemanticIndexReady('local');

  // Los vectores cacheados pertenecen a `other`: no se invalida el motor vivo.
  assert.deepEqual(embeddingEngine.state.loads, []);
  assert.deepEqual(embeddingEngine.state.builds, [other]);
  assert.deepEqual(embeddingEngine.state.pruned, [other]);
});

test('P1.2: los vectores del modelo activo sobreviven entre pasadas (sin reindexar de cero)', async () => {
  await embeddingCache.clearCache();

  const engine = new LocalEmbeddingEngine();
  await engine.loadModel(SELECTED, {
    detectCapabilities: async () => ({ state: 'supported', backend: 'wasm' } as any),
    createPipeline: (async () => {
      const pipe: any = async (input: string) => ({
        data: new Float32Array(384).map((_, i) => Math.sin(i + input.length))
      });
      pipe.dispose = async () => undefined;
      return pipe;
    }) as any
  });

  const chunks = [
    { chunkId: 'p1-c1', sourceType: 'note', sourceId: 'n1', title: 't', text: 'texto uno', contentHash: 'h1' },
    { chunkId: 'p1-c2', sourceType: 'note', sourceId: 'n2', title: 't', text: 'texto dos', contentHash: 'h2' }
  ];

  const first = await engine.indexChunks(chunks);
  const second = await engine.indexChunks(chunks);

  assert.equal(first, 2, 'la primera pasada indexa ambos fragmentos');
  assert.equal(second, 0, 'la segunda reutiliza la caché del modelo activo');

  const entries = await embeddingCache.getAllEntriesForModel(SELECTED, EMBEDDING_PIPELINE_VERSION);
  assert.equal(entries.length, 2, 'los vectores del modelo activo siguen presentes');
});
