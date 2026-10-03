export type EmbeddingRuntimeBackend = 'webgpu' | 'wasm' | 'none';

export interface EmbeddingCapabilitiesReport {
  state: 'supported' | 'unsupported';
  backend: EmbeddingRuntimeBackend;
  deviceLabel: string;
}

/**
 * Detecta si el entorno soporta WebGPU o WASM para ejecución de embeddings con Transformers.js.
 * En navegadores modernos sin WebGPU, ofrece WASM/CPU limpiamente.
 */
export async function detectEmbeddingCapabilities(): Promise<EmbeddingCapabilitiesReport> {
  // 1. Comprobar WebGPU si está disponible
  if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
    try {
      const gpu = (navigator as any).gpu;
      if (gpu && typeof gpu.requestAdapter === 'function') {
        const adapter = await gpu.requestAdapter();
        if (adapter) {
          return {
            state: 'supported',
            backend: 'webgpu',
            deviceLabel: 'WebGPU (Aceleración por Hardware)'
          };
        }
      }
    } catch {
      // Ignorar fallo y comprobar fallback WASM
    }
  }

  // 2. Comprobar WebAssembly (CPU Fallback)
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
