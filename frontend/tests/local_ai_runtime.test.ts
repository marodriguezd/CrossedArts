import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalAiRuntime,
  LOCAL_AI_CONSENT_KEY,
  LOCAL_AI_CACHED_MODEL_KEY,
  type LocalAiRuntimeDeps
} from '../src/services/localAiRuntime.ts';
import { selectBestLocalModel, selectRuntimeProfile } from '../src/lib/localLlm/selection.ts';
import { getLocalModelById, LOCAL_MODELS_REGISTRY } from '../src/lib/localLlm/registry.ts';

/* -------------------------------------------------------------------------- */
/* Fakes                                                                      */
/* -------------------------------------------------------------------------- */

function makeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
    raw: map
  };
}

function makeLlmEngine(initialStatus: string = 'idle') {
  const calls: string[] = [];
  let status = initialStatus;
  let modelId: string | null = null;
  return {
    calls,
    getStatus: () => status,
    getLoadedModelId: () => modelId,
    loadModel: async (id: string, onProgress?: (p: { progress: number; text: string }) => void) => {
      calls.push(id);
      status = 'loading';
      onProgress?.({ progress: 12, text: 'Fetching model parameters' });
      await new Promise((r) => setTimeout(r, 8));
      onProgress?.({ progress: 95, text: 'Compiling shaders' });
      status = 'ready';
      modelId = id;
    }
  };
}

function makeEmbeddingEngine() {
  const loadCalls: string[] = [];
  const indexCalls: number[] = [];
  let status = 'idle';
  return {
    loadCalls,
    indexCalls,
    getStatus: () => status,
    getLoadedModelId: () => (status === 'ready' ? 'Xenova/multilingual-e5-small' : null),
    loadModel: async () => {
      loadCalls.push('load');
      await new Promise((r) => setTimeout(r, 5));
      status = 'ready';
    },
    indexChunks: async (chunks: any[], onProgress?: (n: number, t: number) => void) => {
      indexCalls.push(chunks.length);
      await new Promise((r) => setTimeout(r, 5));
      onProgress?.(chunks.length, chunks.length);
      return chunks.length;
    },
    cancelIndexing: () => {}
  };
}

function makeRuntime(overrides: Partial<LocalAiRuntimeDeps> = {}, opts: {
  online?: boolean;
  browser?: boolean;
  storage?: ReturnType<typeof makeStorage>;
  capability?: any;
} = {}) {
  const llmEngine = makeLlmEngine();
  const embeddingEngine = makeEmbeddingEngine();
  const storage = opts.storage ?? makeStorage();
  const deps: LocalAiRuntimeDeps = {
    llmEngine,
    embeddingEngine,
    detectCapabilities: async () => opts.capability ?? { state: 'supported', supportedFeatures: [], deviceTier: 'unknown' },
    isOnline: () => opts.online ?? true,
    isBrowser: () => opts.browser ?? true,
    storage,
    loadResources: async () => ({ courses: [], books: [], notes: [], flashcards: [], concepts: [] }),
    buildChunks: async () => [
      { chunkId: 'c1', sourceType: 'note', sourceId: 'n1', title: 't', text: 'x', contentHash: 'h1' },
      { chunkId: 'c2', sourceType: 'note', sourceId: 'n2', title: 't', text: 'y', contentHash: 'h2' }
    ],
    getModelDefinition: getLocalModelById,
    ...overrides
  };
  return { runtime: new LocalAiRuntime(deps), llmEngine, embeddingEngine, storage };
}

/* -------------------------------------------------------------------------- */
/* Model selection policy                                                      */
/* -------------------------------------------------------------------------- */

test('26.1 Unsupported WebGPU yields no local model (handled without crash)', () => {
  assert.strictEqual(selectBestLocalModel({ webgpu: 'unsupported' }), null);
  assert.strictEqual(selectBestLocalModel({ webgpu: 'unknown' }), null);
});

test('26.2 Unknown adapter features never assume support: models with feature requirements are excluded', () => {
  const model = selectBestLocalModel({ webgpu: 'supported', supportedFeatures: null, deviceTier: 'high' });
  assert.ok(model);
  assert.ok(!model!.requiredFeatures?.length, 'Con features desconocidas no se elige un modelo con requisitos');

  const withFeatures = selectBestLocalModel({
    webgpu: 'supported',
    supportedFeatures: ['shader-f16'],
    deviceTier: 'unknown'
  });
  assert.ok(withFeatures);
});

test('26.3 Selection is deterministic and conservative', () => {
  const caps = { webgpu: 'supported' as const, supportedFeatures: [] as string[], deviceTier: 'unknown' as const };
  const first = selectBestLocalModel(caps);
  const second = selectBestLocalModel(caps);
  assert.strictEqual(first?.id, second?.id, 'Mismo input -> misma selección');

  // Conservador: el modelo viable de menor huella estimada.
  const eligible = LOCAL_MODELS_REGISTRY.filter((m) => !m.requiredFeatures?.length);
  const smallest = [...eligible].sort((a, b) => a.vramRequiredMB - b.vramRequiredMB || a.id.localeCompare(b.id))[0];
  assert.strictEqual(first?.id, smallest.id);
});

test('26.4 Clearly capable devices prefer the recommended model', () => {
  const profile = selectRuntimeProfile({
    webgpu: 'supported',
    supportedFeatures: ['shader-f16'],
    deviceTier: 'high'
  });
  assert.ok(profile);
  assert.strictEqual(profile!.reason, 'recommended-capable');
  assert.strictEqual(profile!.model.recommended, true);
});

/* -------------------------------------------------------------------------- */
/* LLM lifecycle                                                              */
/* -------------------------------------------------------------------------- */

test('26.5 Unsupported hardware is reported clearly and never loads a model', async () => {
  const { runtime, llmEngine } = makeRuntime({}, { capability: { state: 'unsupported', reason: 'sin gpu' } });
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'unsupported');
  assert.strictEqual(status.errorCategory, 'unsupported-browser');
  assert.strictEqual(llmEngine.calls.length, 0);
});

test('26.6 First-use consent blocks download and shows approximate size', async () => {
  const storage = makeStorage();
  const { runtime, llmEngine } = makeRuntime({}, { storage });
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'consent-required');
  assert.ok(status.message.includes('aproximadamente'));
  assert.ok(status.downloadSize && status.downloadSize.length > 0);
  assert.ok(status.modelId, 'Debe indicarse el modelo que se prepararía tras el consentimiento');
  assert.strictEqual(llmEngine.calls.length, 0, 'No download before consent');
});

test('26.7 Accepted consent triggers automatic preparation and marks the model cached', async () => {
  const storage = makeStorage();
  const { runtime, llmEngine } = makeRuntime({}, { storage });
  runtime.grantConsent();
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'ready');
  assert.strictEqual(llmEngine.calls.length, 1);
  assert.strictEqual(storage.getItem(LOCAL_AI_CONSENT_KEY), 'granted');
  assert.ok(storage.getItem(LOCAL_AI_CACHED_MODEL_KEY), 'El modelo preparado queda registrado como cacheado');
});

test('26.8 Concurrent preparation shares a single promise (one load only)', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, llmEngine } = makeRuntime({}, { storage });
  const [a, b, c] = await Promise.all([
    runtime.ensureLocalAiReady({ provider: 'local' }),
    runtime.ensureLocalAiReady({ provider: 'local' }),
    runtime.prepareForTutor('local')
  ]);
  assert.strictEqual(a.stage, 'ready');
  assert.strictEqual(b.stage, 'ready');
  assert.strictEqual(c.stage, 'ready');
  assert.strictEqual(llmEngine.calls.length, 1, 'El modelo se carga exactamente una vez');
});

test('26.9 An already-ready model is reused without reloading', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, llmEngine } = makeRuntime({}, { storage });
  // Simular motor ya cargado.
  (llmEngine as any).getStatus = () => 'ready';
  (llmEngine as any).getLoadedModelId = () => 'Qwen3-1.7B-q4f16_1-MLC';
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'ready');
  assert.strictEqual(llmEngine.calls.length, 0, 'No se recarga un modelo ya listo');
});

test('26.10 Offline with a previously cached model still prepares from cache', async () => {
  const selected = selectBestLocalModel({ webgpu: 'supported', supportedFeatures: [], deviceTier: 'unknown' })!;
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted', [LOCAL_AI_CACHED_MODEL_KEY]: selected.id });
  const { runtime, llmEngine } = makeRuntime({}, { storage, online: false });
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'ready');
  assert.strictEqual(llmEngine.calls.length, 1);
});

test('26.11 Offline without cache fails gracefully with an actionable status (no futile download)', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, llmEngine } = makeRuntime({}, { storage, online: false });
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'error');
  assert.strictEqual(status.errorCategory, 'offline-uncached');
  assert.ok(status.errorAction && status.errorAction.length > 0);
  assert.strictEqual(llmEngine.calls.length, 0);
});

test('26.12 Demo, OpenAI and Ollama never load the local WebLLM model', async () => {
  for (const provider of ['demo', 'openai', 'ollama'] as const) {
    const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
    const { runtime, llmEngine } = makeRuntime({}, { storage });
    const status = await runtime.prepareForTutor(provider);
    assert.strictEqual(llmEngine.calls.length, 0, `${provider} no debe cargar WebLLM`);
    assert.strictEqual(status.stage, 'idle');
  }
});

/* -------------------------------------------------------------------------- */
/* Semantic indexing                                                          */
/* -------------------------------------------------------------------------- */

test('26.13 Semantic preparation outside a browser never downloads embeddings', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, embeddingEngine } = makeRuntime({}, { browser: false, storage });
  const status = await runtime.ensureSemanticIndexReady();
  assert.strictEqual(status.stage, 'error');
  assert.strictEqual(status.errorCategory, 'semantic-unavailable');
  assert.strictEqual(embeddingEngine.loadCalls.length, 0);
});

test('26.14 Concurrent semantic preparation is deduplicated (one load, one index job)', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, embeddingEngine } = makeRuntime({}, { storage });
  const [a, b] = await Promise.all([runtime.ensureSemanticIndexReady(), runtime.ensureSemanticIndexReady()]);
  assert.strictEqual(a.stage, 'ready');
  assert.strictEqual(b.stage, 'ready');
  assert.strictEqual(embeddingEngine.loadCalls.length, 1, 'El modelo de embeddings se carga una vez');
  assert.strictEqual(embeddingEngine.indexCalls.length, 1, 'Una única indexación concurrente');
  assert.strictEqual(a.total, 2);
});

test('26.15 Fresh/unchanged content is handed to the engine once (reuse delegated, no duplicate jobs)', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, embeddingEngine } = makeRuntime({}, { storage });
  const first = await runtime.ensureSemanticIndexReady();
  assert.strictEqual(first.stage, 'ready');
  // Segunda solicitud: trabajo nuevo (la reutilización de vectores frescos la
  // resuelve el motor, que ya está cubierto por la suite existente).
  await runtime.ensureSemanticIndexReady();
  assert.strictEqual(embeddingEngine.indexCalls.length, 2);
  assert.ok(embeddingEngine.indexCalls.every((n) => n === 2));
});

test('26.16 Semantic failure is contained and never throws to callers', async () => {
  const embeddingEngine = makeEmbeddingEngine();
  (embeddingEngine as any).loadModel = async () => {
    throw new Error('onnx unavailable');
  };
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime } = makeRuntime({ embeddingEngine: embeddingEngine as any }, { storage });
  const status = await runtime.ensureSemanticIndexReady();
  assert.strictEqual(status.stage, 'error');
  assert.strictEqual(status.errorCategory, 'indexing-failed');
});

test('26.17 scheduleIndexing never throws and is deduplicated', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, embeddingEngine } = makeRuntime({}, { storage });
  runtime.scheduleIndexing();
  runtime.scheduleIndexing();
  await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(embeddingEngine.indexCalls.length, 1);
});

/* -------------------------------------------------------------------------- */
/* Status & subscriptions                                                      */
/* -------------------------------------------------------------------------- */

test('26.18 Status transitions are observable deterministically', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime } = makeRuntime({}, { storage });
  const seen: string[] = [];
  const unsubscribe = runtime.subscribe((s) => seen.push(s.stage));
  await runtime.ensureLocalAiReady({ provider: 'local' });
  unsubscribe();
  assert.strictEqual(seen[0], 'idle');
  assert.ok(seen.includes('preparing'));
  assert.ok(seen.includes('downloading') || seen.includes('compiling'));
  assert.strictEqual(seen[seen.length - 1], 'ready');
});

test('26.19 Demo/OpenAI/Ollama never prepare local embeddings, even with local consent', async () => {
  for (const provider of ['demo', 'openai', 'ollama'] as const) {
    const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
    const { runtime, embeddingEngine } = makeRuntime({}, { storage });
    const status = await runtime.ensureSemanticIndexReady(provider);
    assert.strictEqual(status.stage, 'idle');
    assert.strictEqual(embeddingEngine.loadCalls.length, 0);
  }
});

test('26.20 Semantic preparation does not download an embedding model for an empty library', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const { runtime, embeddingEngine } = makeRuntime({
    loadResources: async () => ({ courses: [], books: [], notes: [], flashcards: [], concepts: [] }),
    buildChunks: async () => []
  }, { storage });
  const status = await runtime.ensureSemanticIndexReady();
  assert.strictEqual(status.stage, 'ready');
  assert.strictEqual(status.total, 0);
  assert.strictEqual(embeddingEngine.loadCalls.length, 0);
});

test('26.21 High-capability device falls back to a lighter model after resource exhaustion', async () => {
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted' });
  const llmEngine = makeLlmEngine();
  const originalLoad = llmEngine.loadModel;
  llmEngine.loadModel = async (id, onProgress) => {
    if (id === 'Qwen3-1.7B-q4f16_1-MLC') throw new Error('CUDA out of memory / device lost');
    return originalLoad(id, onProgress);
  };
  const { runtime } = makeRuntime({ llmEngine }, {
    storage,
    capability: { state: 'supported', supportedFeatures: ['shader-f16'], deviceTier: 'high' }
  });
  const status = await runtime.ensureLocalAiReady({ provider: 'local' });
  assert.strictEqual(status.stage, 'ready');
  assert.notStrictEqual(status.modelId, 'Qwen3-1.7B-q4f16_1-MLC');
  assert.ok(status.message.includes('ligera'));
  assert.strictEqual(llmEngine.calls.length, 2);
});

test('26.22 Cached model registry accepts old single-id values and upgrades to a multi-model list', async () => {
  const selected = selectBestLocalModel({ webgpu: 'supported', supportedFeatures: [], deviceTier: 'unknown' })!;
  const storage = makeStorage({ [LOCAL_AI_CONSENT_KEY]: 'granted', [LOCAL_AI_CACHED_MODEL_KEY]: selected.id });
  const { runtime, llmEngine } = makeRuntime({}, { storage });
  await runtime.ensureLocalAiReady({ provider: 'local' });
  const raw = storage.getItem(LOCAL_AI_CACHED_MODEL_KEY);
  assert.ok(raw);
  assert.ok(JSON.parse(raw!).includes(selected.id));
});