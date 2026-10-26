import test from 'node:test';
import assert from 'node:assert/strict';
import { WasmWorkerClient, abortError, isAbortError } from '../src/lib/localLlm/wasmWorkerClient.ts';
import { localLlmEngine, localLlmInternals } from '../src/lib/localLlm/engine.ts';

/**
 * P1.6 — Ningún fallo del worker deja la UI esperando para siempre, y cerrar el
 * tutor detiene el trabajo.
 *
 * Antes: `onerror` rechazaba los pendientes pero dejaba `this.worker` apuntando a
 * un hilo muerto (las llamadas siguientes colgaban), `unload()` podía esperar
 * eternamente y no existía cancelación.
 */

/** Worker falso con la superficie que usa el cliente. */
class FakeWorker {
  static instances: FakeWorker[] = [];
  public posted: any[] = [];
  public terminated = 0;
  public onmessage: ((e: any) => void) | null = null;
  public onerror: ((e: any) => void) | null = null;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: any): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated += 1;
  }

  /** Simula una respuesta del hilo. */
  reply(id: number, type: string, payload?: any, error?: string): void {
    this.onmessage?.({ data: { id, type, payload, error } });
  }

  crash(message = 'boom'): void {
    this.onerror?.({ message });
  }
}

function makeClient(timeouts: Partial<typeof import('../src/lib/localLlm/wasmWorkerClient.ts').WASM_WORKER_TIMEOUTS> = {}) {
  FakeWorker.instances = [];
  const client = new WasmWorkerClient({
    timeouts: { load: 50, generate: 50, unload: 50, ...timeouts },
    createWorker: () => new FakeWorker() as unknown as Worker
  });
  return { client, workers: () => FakeWorker.instances };
}

test('P1.6: un crash del worker rechaza los pendientes y permite recrearlo', async () => {
  const { client, workers } = makeClient();

  const pending = client.load('modelo-x');
  const worker = workers()[0];
  assert.equal(workers().length, 1);

  worker.crash('hilo muerto');
  await assert.rejects(() => pending, /WASM Worker error/);
  assert.equal(worker.terminated, 1, 'el hilo muerto se termina');

  // La siguiente llamada crea un hilo NUEVO en lugar de colgarse en el difunto.
  const second = client.load('modelo-x');
  assert.equal(workers().length, 2);
  workers()[1].reply(2, 'load-success');
  await second;

  await client.unload();
});

test('P1.6: una petición sin respuesta expira y no bloquea', async () => {
  const { client, workers } = makeClient({ generate: 20 });

  await assert.rejects(
    () => client.generate('hola', 10, 0.2),
    /Tiempo de espera agotado/
  );
  assert.equal(workers()[0].terminated, 1, 'un worker que no responde se descarta');
});

test('P1.6: unload no espera eternamente a un worker ocupado', async () => {
  const { client, workers } = makeClient({ unload: 20 });

  const generation = client.generate('hola', 10, 0.2).catch(() => 'cancelado');
  await client.unload();

  assert.equal(workers()[0].terminated, 1);
  assert.equal(await generation, 'cancelado', 'la generación pendiente se rechaza al descargar');
});

test('P1.6: abortar termina el worker y rechaza con AbortError', async () => {
  const { client, workers } = makeClient();
  const controller = new AbortController();

  const generation = client.generate('hola', 10, 0.2, undefined, controller.signal);
  controller.abort();

  await assert.rejects(() => generation, (err: any) => isAbortError(err));
  assert.equal(workers()[0].terminated, 1, 'cancelar descarta el hilo en curso');
});

test('P1.6: una señal ya abortada no llega a generar', async () => {
  const { client, workers } = makeClient();
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(() => client.generate('hola', 10, 0.2, undefined, controller.signal), (err: any) => isAbortError(err));
  assert.equal(workers().length, 0, 'no se crea un hilo para trabajo ya cancelado');
});

test('P1.6: abortError produce un error reconocible', () => {
  const err = abortError();
  assert.equal(err.name, 'AbortError');
  assert.equal(isAbortError(err), true);
  assert.equal(isAbortError(new Error('otro')), false);
});

test('P1.6: el motor no genera con una señal ya cancelada', async () => {
  const originalGpu = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWebGpuEngine = async () => ({
      unload: async () => undefined,
      chat: {
        completions: {
          create: async () => {
            throw new Error('no debería generarse');
          }
        }
      }
    });

    await localLlmEngine.loadModel('Qwen3-1.7B-q4f16_1-MLC');
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => localLlmEngine.generate([{ role: 'user', content: 'hola' }], { signal: controller.signal }),
      (err: any) => isAbortError(err)
    );
    assert.equal(localLlmEngine.getStatus(), 'ready', 'cancelar no deja el motor en error');
  } finally {
    localLlmInternals.createWebGpuEngine = originalGpu;
    localLlmInternals.detectCapability = originalDetect;
    await localLlmEngine.unload();
  }
});

test('P1.6: abortar durante el stream corta la generación de WebGPU', async () => {
  const originalGpu = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  const controller = new AbortController();
  let interrupted = 0;
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWebGpuEngine = async () => ({
      unload: async () => undefined,
      interruptGenerate: () => { interrupted += 1; },
      chat: {
        completions: {
          create: async function* () {
            yield { choices: [{ delta: { content: 'uno' } }] };
            controller.abort();
            yield { choices: [{ delta: { content: 'dos' } }] };
          }
        }
      }
    });

    await localLlmEngine.loadModel('Qwen3-1.7B-q4f16_1-MLC');
    const chunks: string[] = [];

    await assert.rejects(
      () => localLlmEngine.generate([{ role: 'user', content: 'hola' }], {
        signal: controller.signal,
        onChunk: (delta) => chunks.push(delta)
      }),
      (err: any) => isAbortError(err)
    );

    assert.deepEqual(chunks, ['uno'], 'deja de emitir en cuanto se cancela');
    assert.equal(interrupted, 1, 'se interrumpe el motor WebGPU');
    assert.equal(localLlmEngine.getStatus(), 'ready');
  } finally {
    localLlmInternals.createWebGpuEngine = originalGpu;
    localLlmInternals.detectCapability = originalDetect;
    await localLlmEngine.unload();
  }
});

test('SP3: cancelar en WebGPU no se reporta como error aunque el stream falle con otro nombre', async () => {
  const originalGpu = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  const controller = new AbortController();
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWebGpuEngine = async () => ({
      unload: async () => undefined,
      interruptGenerate: () => { controller.abort(); },
      chat: {
        completions: {
          // `interruptGenerate()` (disparado por el botón Detener) hace que el
          // backend rechace el stream con SU error, no con un AbortError.
          create: async function* () {
            yield { choices: [{ delta: { content: 'uno' } }] };
            controller.abort();
            throw new Error('Interrupted by user');
          }
        }
      }
    });

    await localLlmEngine.loadModel('Qwen3-1.7B-q4f16_1-MLC');
    const chunks: string[] = [];

    await assert.rejects(
      () => localLlmEngine.generate([{ role: 'user', content: 'hola' }], {
        signal: controller.signal,
        onChunk: (delta) => chunks.push(delta)
      }),
      (err: any) => isAbortError(err),
      'una cancelación se propaga como AbortError, no como fallo del tutor'
    );

    assert.deepEqual(chunks, ['uno'], 'deja de emitir en cuanto se cancela');
    assert.equal(localLlmEngine.getStatus(), 'ready', 'cancelar no deja el motor en error');
    assert.equal(localLlmEngine.getLastError(), null, 'cancelar no registra un error');
  } finally {
    localLlmInternals.createWebGpuEngine = originalGpu;
    localLlmInternals.detectCapability = originalDetect;
    await localLlmEngine.unload();
  }
});

test('SP3: un error real sin cancelación sigue siendo un error', async () => {
  const originalGpu = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  const controller = new AbortController();
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWebGpuEngine = async () => ({
      unload: async () => undefined,
      chat: {
        completions: {
          create: async () => {
            throw new Error('Fallo del backend');
          }
        }
      }
    });

    await localLlmEngine.loadModel('Qwen3-1.7B-q4f16_1-MLC');

    await assert.rejects(
      () => localLlmEngine.generate([{ role: 'user', content: 'hola' }], { signal: controller.signal }),
      (err: any) => err?.name !== 'AbortError' && /Fallo del backend/.test(err.message),
      'sin señal abortada el error no se disfraza de cancelación'
    );
  } finally {
    localLlmInternals.createWebGpuEngine = originalGpu;
    localLlmInternals.detectCapability = originalDetect;
    await localLlmEngine.unload();
  }
});
