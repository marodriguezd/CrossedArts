export type WebGPUCapabilityState = 'supported' | 'unsupported' | 'checking';

export interface WebGPUCapabilityReport {
  state: WebGPUCapabilityState;
  adapterInfo?: string;
  reason?: string;
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

    return {
      state: 'supported',
      adapterInfo
    };
  } catch (err: any) {
    return {
      state: 'unsupported',
      reason: `Error al verificar WebGPU: ${err?.message || 'Error desconocido'}`
    };
  }
}
