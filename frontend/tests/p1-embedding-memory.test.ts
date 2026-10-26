import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  createEmbeddingMemoryReleaser,
  releaseOnPageHide,
  DEFAULT_EMBEDDING_IDLE_MS
} from '../src/services/embeddingMemory.ts';
import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';
import { embeddingCache } from '../src/lib/localEmbeddings/cache.ts';

/**
 * P1.5 — El modelo de embeddings no queda residente para siempre y nunca se
 * libera en mitad de una indexación.
 */

function makeTimers() {
  let nextId = 1;
  const pending = new Map<number, { fn: () => void; ms: number }>();
  return {
    timers: {
      setTimeout(fn: () => void, ms: number) {
        const id = nextId++;
        pending.set(id, { fn, ms });
        return id;
      },
      clearTimeout(handle: unknown) {
        pending.delete(Number(handle));
      }
    },
    pending,
    fireAll() {
      const entries = Array.from(pending.values());
      pending.clear();
      for (const entry of entries) entry.fn();
    },
    count: () => pending.size
  };
}

function makeEngine(status = 'ready') {
  let current = status;
  let unloads = 0;
  return {
    get unloads() { return unloads; },
    setStatus(next: string) { current = next; },
    getStatus: () => current,
    unload: async () => {
      unloads += 1;
      current = 'idle';
    }
  };
}

test('P1.5: la liberación se programa y ocurre tras la inactividad', async () => {
  const engine = makeEngine();
  const clock = makeTimers();
  let released = 0;
  const releaser = createEmbeddingMemoryReleaser({
    engine,
    idleMs: 1000,
    timers: clock.timers as any,
    onRelease: () => { released += 1; }
  });

  releaser.touch();
  assert.equal(clock.pending.size, 1, 'la liberación queda programada');
  assert.equal(clock.pending.values().next().value!.ms, 1000);

  clock.fireAll();
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(engine.unloads, 1);
  assert.equal(released, 1);
  assert.equal(clock.count(), 0, 'tras liberar no queda ningún temporizador armado');
});

test('P1.5: no se libera durante una indexación', async () => {
  const engine = makeEngine('embedding');
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, idleMs: 10, timers: clock.timers as any });

  releaser.touch();
  assert.equal(clock.count(), 0, 'mientras indexa no se arma el temporizador');

  assert.equal(await releaser.releaseNow(), false);
  assert.equal(engine.unloads, 0, 'nunca se descarga el modelo durante indexación');
});

test('P1.5: sin modelo cargado no hay nada que liberar', async () => {
  const engine = makeEngine('idle');
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, idleMs: 10, timers: clock.timers as any });
  assert.equal(await releaser.releaseNow(), false);
  assert.equal(engine.unloads, 0);
});

test('P1.5: dispose cancela el temporizador pendiente', () => {
  const engine = makeEngine();
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, idleMs: 10, timers: clock.timers as any });
  releaser.touch();
  assert.equal(clock.count(), 1);
  releaser.dispose();
  assert.equal(clock.count(), 0);
});

test('SP1: pagehide cancela el temporizador y libera el modelo', async () => {
  const engine = makeEngine();
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, idleMs: 5000, timers: clock.timers as any });
  releaser.touch();
  assert.equal(clock.count(), 1);

  assert.equal(await releaseOnPageHide(releaser), true);
  assert.equal(engine.unloads, 1, 'cerrar la pestaña devuelve la memoria del modelo');
  assert.equal(clock.count(), 0, 'ningún temporizador sobrevive al pagehide');
});

test('SP1: pagehide no descarga el modelo a mitad de una indexación', async () => {
  const engine = makeEngine('embedding');
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, idleMs: 5000, timers: clock.timers as any });

  assert.equal(await releaseOnPageHide(releaser), false);
  assert.equal(engine.unloads, 0, 'el trabajo en curso no se destruye al cerrar');
});

test('P1.5: el valor por defecto de inactividad es 5 minutos', () => {
  const engine = makeEngine();
  const clock = makeTimers();
  const releaser = createEmbeddingMemoryReleaser({ engine, timers: clock.timers as any });
  releaser.touch();
  assert.equal(clock.pending.values().next().value!.ms, DEFAULT_EMBEDDING_IDLE_MS);
  assert.equal(DEFAULT_EMBEDDING_IDLE_MS, 5 * 60 * 1000);
});

test('P1.5: load → index → unload → load no deja estado duplicado', async () => {
  await embeddingCache.clearCache();

  const engine = new LocalEmbeddingEngine();
  let factories = 0;
  const factory = async () => {
    factories += 1;
    const pipe: any = async () => ({ data: new Float32Array(384).fill(0.02) });
    pipe.dispose = async () => undefined;
    return pipe;
  };
  const options = {
    detectCapabilities: async () => ({ state: 'supported', backend: 'wasm' }) as any,
    createPipeline: factory as any
  };

  await engine.loadModel('Xenova/all-MiniLM-L6-v2', options);
  const indexed = await engine.indexChunks([
    { chunkId: 'm1', sourceType: 'note', sourceId: 'n1', title: 't', text: 'x', contentHash: 'h', substantive: true }
  ]);
  assert.equal(indexed, 1);

  await engine.unload();
  assert.equal(engine.getStatus(), 'idle');
  assert.equal(engine.getLoadedModelId(), null);
  assert.equal(engine.getBackend(), 'none');

  await engine.loadModel('Xenova/all-MiniLM-L6-v2', options);
  assert.equal(engine.getStatus(), 'ready');
  assert.equal(factories, 2, 'una instancia por carga, sin acumular pipelines');

  // Los vectores sobreviven a la liberación de memoria.
  const second = await engine.indexChunks([
    { chunkId: 'm1', sourceType: 'note', sourceId: 'n1', title: 't', text: 'x', contentHash: 'h', substantive: true }
  ]);
  assert.equal(second, 0, 'la caché persiste entre cargas');

  await engine.unload();
});
