export type EmbeddingRuntimeBackend = 'webgpu' | 'wasm' | 'none';

export interface EmbeddingCapabilitiesReport {
  state: 'supported' | 'unsupported';
  backend: EmbeddingRuntimeBackend;
  deviceLabel: string;
}

/**
 * Detects whether the environment supports WebGPU or WASM for embedding
 * execution with Transformers.js. Modern browsers without WebGPU cleanly get
 * WASM/CPU.
 */
export async function detectEmbeddingCapabilities(): Promise<EmbeddingCapabilitiesReport> {
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = (navigator as any).gpu;
      if (gpu && typeof gpu.requestAdapter === 'function') {
        const adapter = await Promise.race([
          gpu.requestAdapter({ powerPreference: 'high-performance' }).catch(() => gpu.requestAdapter()),
          new Promise((_, r) => setTimeout(() => r(new Error('timeout')), 1500))
        ]);
        if (adapter) {
          return {
            state: 'supported',
            backend: 'webgpu',
            deviceLabel: 'WebGPU (Aceleración por Hardware)'
          };
        }
      }
    } catch {
      // Timeout or adapter failure: fall through to CPU/WASM fallback.
    }
  }

  if (typeof WebAssembly !== 'undefined') {
    return {
      state: 'supported',
      backend: 'wasm',
      deviceLabel: 'WASM (CPU Multihilo / Fallback)'
    };
  }

  return {
    state: 'unsupported',
    backend: 'none',
    deviceLabel: 'Sin soporte para aceleración de embeddings'
  };
}
