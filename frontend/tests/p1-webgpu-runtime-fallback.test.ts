import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';
import { localLlmEngine, localLlmInternals } from '../src/lib/localLlm/engine.ts';
import { DEFAULT_WASM_MODEL_ID, getLocalModelById } from '../src/lib/localLlm/registry.ts';
import { isWebGpuFatalError } from '../src/lib/localLlm/capabilities.ts';

/**
 * P1.4 — Un fallo de WebGPU no deja la IA inutilizable hasta cambiar de modelo.
 *
 * Antes solo se reintentaba en WASM si fallaba la CREACIÓN del pipeline; un
 * fallo de shader en la primera inferencia (o al inicializar WebLLM) dejaba el
 * motor en error y exigía intervención manual.
 */

const GPU_CAPS = { state: 'supported', backend: 'webgpu' } as any;
const WASM_CAPS = { state: 'supported', backend: 'wasm' } as any;
/** Modelo sin backend preferido: se resuelve por capacidades (WebGPU si existe). */
const FLEXIBLE_MODEL = 'Xenova/multilingual-e5-small';

test('P1.4: isWebGpuFatalError distingue GPU de red o programación', () => {
  assert.equal(isWebGpuFatalError(new Error('ShaderModule validation failed: index_kernel')), true);
  assert.equal(isWebGpuFatalError(new Error('Device lost while executing compute stage')), true);
  assert.equal(isWebGpuFatalError(new Error('out of memory')), true);
  assert.equal(isWebGpuFatalError(new Error('Failed to fetch model weights')), false);
  assert.equal(isWebGpuFatalError(new TypeError('x is not a function')), false);
  assert.equal(isWebGpuFatalError(null), false);
});

test('P1.4: un fallo de inferencia WebGPU reintenta en WASM y sobrevive', async () => {
  const engine = new LocalEmbeddingEngine();
  const devices: string[] = [];
  let dispatches = 0;

  await engine.loadModel(FLEXIBLE_MODEL, {
    detectCapabilities: async () => GPU_CAPS,
    createPipeline: async ({ device }) => {
      devices.push(device);
      const pipe: any = async () => {
        dispatches += 1;
        if (device === 'webgpu' && dispatches === 1) {
          throw new Error('ShaderModule validation failed (index_kernel)');
        }
        return { data: new Float32Array(384).fill(0.1) };
      };
      pipe.dispose = async () => undefined;
      return pipe;
    }
  });

  assert.equal(engine.getBackend(), 'webgpu');

  const vector = await engine.embedText('consulta', true);

  assert.equal(vector.length, 384, 'el embedding se completa tras el fallback');
  assert.deepEqual(devices, ['webgpu', 'wasm'], 'se reconstruye el pipeline en CPU una sola vez');
  assert.equal(engine.getBackend(), 'wasm', 'el backend reportado es el que realmente ejecutó');
  assert.equal(engine.getStatus(), 'ready');
});

test('P1.4: un error que no es de GPU no inventa un fallback', async () => {
  const engine = new LocalEmbeddingEngine();
  const devices: string[] = [];

  await engine.loadModel(FLEXIBLE_MODEL, {
    detectCapabilities: async () => GPU_CAPS,
    createPipeline: async ({ device }) => {
      devices.push(device);
      const pipe: any = async () => {
        throw new Error('Entrada inválida: token inesperado');
      };
      pipe.dispose = async () => undefined;
      return pipe;
    }
  });

  await assert.rejects(() => engine.embedText('x', true), /token inesperado/);
  assert.deepEqual(devices, ['webgpu'], 'no se reintenta lo que no es un fallo de GPU');
});

test('P1.4: en WASM un fallo de inferencia no se reintenta', async () => {
  const engine = new LocalEmbeddingEngine();
  const devices: string[] = [];

  await engine.loadModel(FLEXIBLE_MODEL, {
    detectCapabilities: async () => WASM_CAPS,
    createPipeline: async ({ device }) => {
      devices.push(device);
      const pipe: any = async () => {
        throw new Error('out of memory');
      };
      pipe.dispose = async () => undefined;
      return pipe;
    }
  });

  await assert.rejects(() => engine.embedText('x', true), /out of memory/);
  assert.deepEqual(devices, ['wasm']);
});

test('P1.4: WebGPU roto al cargar el LLM degrada al modelo CPU automáticamente', async () => {
  const original = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  const originalWasm = localLlmInternals.createWasmPipeline;
  const created: string[] = [];
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWasmPipeline = async (modelId: string) => {
      created.push(modelId);
      return { unload: async () => undefined };
    };
    localLlmInternals.createWebGpuEngine = async (modelId: string) => {
      created.push(modelId);
      if (modelId !== DEFAULT_WASM_MODEL_ID) {
        throw new Error('ShaderModule validation failed: index_kernel (compute stage)');
      }
      return { unload: async () => undefined };
    };

    await localLlmEngine.loadModel('Llama-3.2-1B-Instruct-q4f16_1-MLC');

    assert.deepEqual(created, ['Llama-3.2-1B-Instruct-q4f16_1-MLC', DEFAULT_WASM_MODEL_ID]);
    assert.equal(localLlmEngine.getLoadedModelId(), DEFAULT_WASM_MODEL_ID);
    assert.equal(localLlmEngine.getStatus(), 'ready');
    assert.equal(localLlmEngine.getBackend(), 'wasm');
    assert.match(String(localLlmEngine.getFallbackNotice()), /WebGPU/);
  } finally {
    localLlmInternals.createWebGpuEngine = original;
    localLlmInternals.detectCapability = originalDetect;
    localLlmInternals.createWasmPipeline = originalWasm;
    await localLlmEngine.unload();
  }
});

test('P1.4: un fallo de red al cargar el LLM no cambia de modelo', async () => {
  const original = localLlmInternals.createWebGpuEngine;
  const originalDetect = localLlmInternals.detectCapability;
  const originalWasm = localLlmInternals.createWasmPipeline;
  const created: string[] = [];
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'supported', runtimeBackend: 'webgpu', hasWasmFallback: true }) as any;
    localLlmInternals.createWebGpuEngine = async (modelId: string) => {
      created.push(modelId);
      throw new Error('Failed to fetch model artifact (network offline)');
    };

    await assert.rejects(() => localLlmEngine.loadModel('Llama-3.2-1B-Instruct-q4f16_1-MLC'));
    assert.equal(created.length, 1, 'sin fallo de GPU no se prueba otro modelo');
  } finally {
    localLlmInternals.createWebGpuEngine = original;
    localLlmInternals.detectCapability = originalDetect;
    localLlmInternals.createWasmPipeline = originalWasm;
    await localLlmEngine.unload();
  }
});

test('P1.4: el modelo CPU por defecto es un modelo WASM real del registro', () => {
  const def = getLocalModelById(DEFAULT_WASM_MODEL_ID);
  assert.ok(def);
  assert.equal(def!.runtimeBackend, 'wasm');
});

test('P1.4: un navegador sin WebGPU no cambia de modelo, avisa', async () => {
  const originalDetect = localLlmInternals.detectCapability;
  const originalGpu = localLlmInternals.createWebGpuEngine;
  const originalWasm = localLlmInternals.createWasmPipeline;
  const created: string[] = [];
  try {
    localLlmInternals.detectCapability = async () => ({ state: 'unsupported', runtimeBackend: 'none', hasWasmFallback: true, reason: 'Tu navegador no dispone de soporte para la API WebGPU.' }) as any;
    localLlmInternals.createWebGpuEngine = async (modelId: string) => { created.push(modelId); return {}; };
    localLlmInternals.createWasmPipeline = async (modelId: string) => { created.push(modelId); return {}; };

    await assert.rejects(() => localLlmEngine.loadModel('Qwen3-1.7B-q4f16_1-MLC'), /WebGPU/);
    assert.deepEqual(created, [], 'sin ejecución real no se inventa un fallback');
    assert.equal(localLlmEngine.getStatus(), 'unsupported');
  } finally {
    localLlmInternals.detectCapability = originalDetect;
    localLlmInternals.createWebGpuEngine = originalGpu;
    localLlmInternals.createWasmPipeline = originalWasm;
    await localLlmEngine.unload();
  }
});
test('P1.4: un fallback CPU obsoleto no secuestra el pipeline de la carga siguiente', async () => {
  const engine = new LocalEmbeddingEngine();
  let releaseFallback: () => void = () => {};
  const fallbackGate = new Promise<void>((resolve) => { releaseFallback = resolve; });
  let wasmBuilds = 0;

  const createPipeline = async ({ device }: { device: 'webgpu' | 'wasm' }) => {
    if (device === 'webgpu') {
      const gpuPipe: any = async () => { throw new Error('Device lost while executing compute stage'); };
      gpuPipe.dispose = async () => undefined;
      return gpuPipe;
    }
    wasmBuilds += 1;
    const build = wasmBuilds;
    // El primer CPU es lento: sigue construyéndose mientras el motor se
    // descarga y se vuelve a cargar.
    if (build === 1) await fallbackGate;
    const pipe: any = async () => {
      const vector = new Float32Array(384);
      vector[build === 1 ? 0 : 383] = 1;
      return { data: vector };
    };
    pipe.dispose = async () => undefined;
    return pipe;
  };

  await engine.loadModel(FLEXIBLE_MODEL, { detectCapabilities: async () => GPU_CAPS, createPipeline });

  const inflight = engine.embedText('consulta', true).catch(() => 'cancelado');
  await new Promise((resolve) => setTimeout(resolve, 5));

  await engine.unload();
  await engine.loadModel(FLEXIBLE_MODEL, { detectCapabilities: async () => GPU_CAPS, createPipeline });

  releaseFallback();
  assert.equal(await inflight, 'cancelado', 'el embedding de la sesión anterior no se publica');
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(engine.getStatus(), 'ready', 'una operación cancelada no marca el motor como roto');

  const vector = await engine.embedText('otra', true);
  assert.equal(vector[383], 1, 'la inferencia corre en el pipeline de la carga vigente');
  assert.equal(vector[0], 0, 'el CPU obsoleto no se reinstala');
});
