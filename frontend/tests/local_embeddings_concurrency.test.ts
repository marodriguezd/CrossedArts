import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';
import { embeddingCache } from '../src/lib/localEmbeddings/cache.ts';
import type { SemanticChunk } from '../src/lib/localEmbeddings/chunking.ts';

/**
 * Regresión de concurrencia del motor de embeddings.
 *
 * El motor descarga modelos de forma asíncrona y el usuario puede cambiar de
 * modelo (o descargarlo) mientras una carga anterior sigue en vuelo. Estos
 * tests fijan el contrato: gana siempre la sesión más reciente, las sesiones
 * obsoletas se descartan (liberando su pipeline) y el motor nunca queda en un
 * estado inconsistente.
 */

const MODEL_A = 'onnx-community/embeddinggemma-300m-ONNX';
const MODEL_B = 'Xenova/all-MiniLM-L6-v2';

const wasmCaps = { state: 'supported' as const, backend: 'wasm' as const, deviceLabel: 'WASM' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Pipeline falso que registra su descarga para verificar la liberación. */
function makePipe(name: string, disposed: string[], embedding?: () => Promise<unknown>) {
  const pipe: any = async (input: string) => {
    if (embedding) await embedding();
    return { data: new Float32Array(768).fill(0.5) };
  };
  pipe.dispose = async () => {
    disposed.push(name);
  };
  return pipe;
}

test('Concurrency 1: loadModel(B) gana a una carga de A aún en vuelo y A se libera', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];
  const gateA = deferred<void>();
  let call = 0;

  const createPipeline = async () => {
    call += 1;
    if (call === 1) {
      await gateA.promise; // A tarda en resolverse
      return makePipe('A', disposed);
    }
    return makePipe('B', disposed);
  };

  const loadA = engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });
  // Deja que A llegue a la creación del pipeline (carga realmente en vuelo).
  await new Promise((r) => setTimeout(r, 0));
  const loadB = engine.loadModel(MODEL_B, { detectCapabilities: async () => wasmCaps, createPipeline });

  await loadB;
  assert.strictEqual(engine.getStatus(), 'ready');
  assert.strictEqual(engine.getLoadedModelId(), MODEL_B);

  // A termina TARDE: su instancia debe liberarse y no publicarse.
  gateA.resolve();
  await loadA;

  assert.strictEqual(engine.getLoadedModelId(), MODEL_B, 'A no debe pisar a B');
  assert.strictEqual(engine.getStatus(), 'ready');
  assert.ok(disposed.includes('A'), 'La instancia obsoleta de A debe liberarse');
  assert.ok(!disposed.includes('B'), 'La instancia activa de B no debe liberarse');
  assert.ok(await engine.embedText('consulta', true), 'El motor queda utilizable con B');
});

test('Concurrency 2: dos loadModel del MISMO modelo comparten una sola descarga', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];
  let created = 0;
  const gate = deferred<void>();

  const createPipeline = async () => {
    created += 1;
    await gate.promise;
    return makePipe('A', disposed);
  };

  const first = engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });
  const second = engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });

  gate.resolve();
  await Promise.all([first, second]);

  assert.strictEqual(created, 1, 'No debe descargarse el mismo modelo dos veces');
  assert.strictEqual(engine.getStatus(), 'ready');
  assert.strictEqual(engine.getLoadedModelId(), MODEL_A);
});

test('Concurrency 3: unload() durante una carga activa deja el motor en idle y libera la instancia tardía', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];
  const gate = deferred<void>();

  const load = engine.loadModel(MODEL_A, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => {
      await gate.promise;
      return makePipe('A', disposed);
    }
  });

  await new Promise((r) => setTimeout(r, 0)); // deja avanzar la carga
  await engine.unload();

  assert.strictEqual(engine.getStatus(), 'idle');
  assert.strictEqual(engine.getLoadedModelId(), null);

  gate.resolve();
  await load; // no debe lanzar ni reactivar el modelo

  assert.strictEqual(engine.getStatus(), 'idle', 'La sesión obsoleta no debe reactivar el motor');
  assert.strictEqual(engine.getLoadedModelId(), null);
  assert.ok(disposed.includes('A'), 'La instancia creada tras el unload debe liberarse');
});

test('Concurrency 4: los callbacks de progreso de una sesión obsoleta son inofensivos', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];
  const gateA = deferred<void>();
  let call = 0;

  const createPipeline = async ({ onProgress }: { onProgress: (item: any) => void }) => {
    call += 1;
    if (call === 1) {
      await gateA.promise;
      onProgress({ status: 'progress', progress: 42, file: 'obsoleto.onnx' });
      return makePipe('A', disposed);
    }
    onProgress({ status: 'progress', progress: 90, file: 'activo.onnx' });
    return makePipe('B', disposed);
  };

  const loadA = engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });
  await new Promise((r) => setTimeout(r, 0));
  const loadB = engine.loadModel(MODEL_B, { detectCapabilities: async () => wasmCaps, createPipeline });

  await loadB;
  const progressAfterB = engine.getProgress().progress;

  gateA.resolve();
  await loadA;

  assert.strictEqual(engine.getLoadedModelId(), MODEL_B);
  assert.strictEqual(
    engine.getProgress().progress,
    progressAfterB,
    'El progreso de la sesión obsoleta no debe sobrescribir el de la activa'
  );
});

test('Concurrency 5: un fallo de carga deja el motor en error recuperable para otro modelo', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];

  await assert.rejects(
    engine.loadModel(MODEL_A, {
      detectCapabilities: async () => wasmCaps,
      createPipeline: async () => {
        throw new Error('descarga interrumpida');
      }
    }),
    /descarga interrumpida/
  );

  assert.strictEqual(engine.getStatus(), 'error');
  assert.match(engine.getLastError() ?? '', /descarga interrumpida/);

  await engine.loadModel(MODEL_B, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => makePipe('B', disposed)
  });

  assert.strictEqual(engine.getStatus(), 'ready');
  assert.strictEqual(engine.getLastError(), null);
  assert.strictEqual(engine.getLoadedModelId(), MODEL_B);
});

test('Concurrency 6: indexChunks aborta si el modelo activo cambia a mitad de indexación', async () => {
  await embeddingCache.clearCache();
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];
  const gate = deferred<void>();

  const createPipeline = async ({ modelId }: { modelId: string }) => {
    if (modelId === MODEL_A) {
      return makePipe('A', disposed, async () => {
        await gate.promise;
      });
    }
    return makePipe('B', disposed);
  };

  await engine.loadModel(MODEL_A, { detectCapabilities: async () => wasmCaps, createPipeline });

  const chunks: SemanticChunk[] = [
    { chunkId: 'cc1', sourceType: 'note', sourceId: 'n1', title: 'uno', text: 'alpha', contentHash: 'h1' },
    { chunkId: 'cc2', sourceType: 'note', sourceId: 'n2', title: 'dos', text: 'beta', contentHash: 'h2' }
  ];

  const indexing = engine.indexChunks(chunks);
  await new Promise((r) => setTimeout(r, 0));

  await engine.loadModel(MODEL_B, { detectCapabilities: async () => wasmCaps, createPipeline });
  gate.resolve();

  await assert.rejects(indexing, /cancelada|reemplazada|no está listo|modelo activo/);
  assert.strictEqual(engine.getLoadedModelId(), MODEL_B);
  assert.strictEqual(engine.getStatus(), 'ready');

  await embeddingCache.clearCache();
});

test('Concurrency 7: tras unload() el motor puede volver a cargar y quedar operativo', async () => {
  const engine = new LocalEmbeddingEngine();
  const disposed: string[] = [];

  await engine.loadModel(MODEL_A, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => makePipe('A', disposed)
  });
  await engine.unload();
  assert.strictEqual(engine.getBackend(), 'none');

  await engine.loadModel(MODEL_A, {
    detectCapabilities: async () => wasmCaps,
    createPipeline: async () => makePipe('A2', disposed)
  });
  assert.strictEqual(engine.getStatus(), 'ready');
  assert.strictEqual(engine.getLoadedModelId(), MODEL_A);
});
