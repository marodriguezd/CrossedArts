export type WebGPUCapabilityState = 'supported' | 'unsupported' | 'checking';

export interface WebGPUCapabilityReport {
  state: WebGPUCapabilityState;
  adapterInfo?: string;
  reason?: string;
  /**
   * Features reportadas EXPLÍCITAMENTE por el adaptador. `undefined` significa
   * desconocido: la selección de modelo no asumirá soporte. Solo diagnóstico.
   */
  supportedFeatures?: string[];
  /**
   * Pista conservadora de gama derivada de límites holgados del adaptador.
   * NO es una medición de VRAM: los navegadores no la exponen.
   */
  deviceTier?: 'high' | 'unknown';
}

/**
 * Detecta si el navegador y hardware soportan WebGPU de forma determinista.
 * En entornos sin GPU (o Node.js), reporta 'unsupported' limpiamente.
 */
export async function detectWebGPUCapability(): Promise<WebGPUCapabilityReport> {
  if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
    return {
      state: 'unsupported',
      reason: 'Tu navegador o entorno actual no dispone de soporte para la API WebGPU.'
    };
  }

  try {
    const gpu = (navigator as any).gpu;
    if (!gpu || typeof gpu.requestAdapter !== 'function') {
      return {
        state: 'unsupported',
        reason: 'La interfaz WebGPU no está completamente disponible en este dispositivo.'
      };
    }

    const adapter = await gpu.requestAdapter();
    if (!adapter) {
      return {
        state: 'unsupported',
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
        // Ignorar fallo al leer detalles del adaptador
      }
    }

    // Features explícitamente soportadas (si el adaptador las expone).
    let supportedFeatures: string[] | undefined;
    try {
      const features = (adapter as any).features;
      if (features && typeof features.has === 'function') {
        supportedFeatures = Array.from(features as Set<string>);
      }
    } catch {
      /* Features no legibles: se trata como desconocido. */
    }

    // Pista conservadora de gama: solo con límites holgados y explícitos. No es
    // VRAM exacta; por eso el valor por defecto es 'unknown'.
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
      /* Límites no legibles: se conserva el perfil conservador. */
    }

    return {
      state: 'supported',
      adapterInfo,
      supportedFeatures,
      deviceTier
    };
  } catch (err: any) {
    return {
      state: 'unsupported',
      reason: `Error al verificar WebGPU: ${err?.message || 'Error desconocido'}`
    };
  }
}
