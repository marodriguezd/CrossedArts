export type WebGPUCapabilityState = 'supported' | 'unsupported' | 'checking';
export type LocalRuntimeBackend = 'webgpu' | 'wasm' | 'none';

export interface WebGPUCapabilityReport {
  state: WebGPUCapabilityState;
  runtimeBackend: LocalRuntimeBackend;
  hasWasmFallback: boolean;
  adapterInfo?: string;
  reason?: string;
  /**
   * Features EXPLICITLY reported by the adapter. `undefined` means unknown:
   * model selection will not assume support. Diagnostics only.
   */
  supportedFeatures?: string[];
  /**
   * Conservative tier hint derived from generous adapter limits. NOT a VRAM
   * measurement: browsers never expose it.
   */
  deviceTier?: 'high' | 'unknown';
}

/**
 * Deterministically detects whether the browser and hardware support WebGPU.
 * In GPU-less environments (or Node.js) it cleanly reports 'unsupported'.
 */
export async function detectWebGPUCapability(): Promise<WebGPUCapabilityReport> {
  const hasWasm = typeof WebAssembly !== 'undefined';

  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      state: 'unsupported',
      runtimeBackend: hasWasm ? 'wasm' : 'none',
      hasWasmFallback: hasWasm,
      reason: 'Tu navegador o entorno actual no dispone de soporte para la API WebGPU.'
    };
  }

  try {
    const gpu = (navigator as any).gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') {
      return {
        state: 'unsupported',
        runtimeBackend: hasWasm ? 'wasm' : 'none',
        hasWasmFallback: hasWasm,
        reason: 'La interfaz WebGPU no está completamente disponible en este dispositivo.'
      };
    }

    let adapter = null;
    try {
      adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    } catch {}
    if (!adapter) {
      adapter = await gpu.requestAdapter();
    }
    if (!adapter) {
      return {
        state: 'unsupported',
        runtimeBackend: hasWasm ? 'wasm' : 'none',
        hasWasmFallback: hasWasm,
        reason: 'No se encontró un adaptador gráfico compatible con WebGPU en el sistema.'
      };
    }

    let adapterInfo = 'Adaptador WebGPU disponible';
    if (typeof adapter.requestAdapterInfo === 'function') {
      try {
        const info = await adapter.requestAdapterInfo();
        if (info.vendor || info.architecture || info.device) {
          adapterInfo = `${info.vendor || ''} ${info.architecture || ''} ${info.device || ''}`.trim();
        }
      } catch {
        // Ignore failure while reading adapter details
      }
    }

    // Explicitly supported features (when the adapter exposes them).
    let supportedFeatures: string[] | undefined;
    try {
      const features = (adapter as any).features;
      if (features && typeof features.has === 'function') {
        supportedFeatures = Array.from(features as Set<string>);
      }
    } catch {
      /* Unreadable features: treated as unknown. */
    }

    // Conservative tier hint: only with generous explicit limits. Not exact
    // VRAM; hence the default is 'unknown'.
    let deviceTier: 'high' | 'unknown' = 'unknown';
    try {
      const limits = (adapter as any).limits;
      const gb = 1024 * 1024 * 1024;
      if (
        limits &&
        typeof limits.maxBufferSize === 'number' &&
        limits.maxBufferSize >= 2 * gb &&
        typeof limits.maxStorageBufferBindingSize === 'number' &&
        limits.maxStorageBufferBindingSize >= gb
      ) {
        deviceTier = 'high';
      }
    } catch {
      /* Unreadable limits: the conservative profile is kept. */
    }

    return {
      state: 'supported',
      runtimeBackend: 'webgpu',
      hasWasmFallback: hasWasm,
      adapterInfo,
      supportedFeatures,
      deviceTier
    };
  } catch (err: any) {
    return {
      state: 'unsupported',
      runtimeBackend: hasWasm ? 'wasm' : 'none',
      hasWasmFallback: hasWasm,
      reason: `Error al verificar WebGPU: ${err?.message || 'Error desconocido'}`
    };
  }
}
