import { LOCAL_MODELS_REGISTRY, type LocalModelDefinition } from './registry.ts';

/**
 * Política interna y determinista de selección de modelo local.
 *
 * El usuario NUNCA elige modelo en el flujo normal: CrossedArts decide por él.
 * Los navegadores no exponen la VRAM real, así que NUNCA se asume capacidad
 * exacta. Solo se usan señales conservadoras:
 *   - disponibilidad de WebGPU,
 *   - features EXPLÍCITAMENTE reportadas por el adaptador,
 *   - una pista tosca de gama alta (`deviceTier`) derivada de límites holgados.
 *
 * Con información incierta se elige siempre el modelo viable más pequeño.
 */

export type WebGpuSupport = 'supported' | 'unsupported' | 'unknown';

export interface LocalAiCapabilities {
  webgpu: WebGpuSupport;
  hasWasm?: boolean;
  /**
   * Features reportadas por el adaptador. `null`/`undefined` significa
   * DESCONOCIDO: no se asume soporte de ningún requisito.
   */
  supportedFeatures?: string[] | null;
  /**
   * Pista conservadora de gama. `'high'` solo cuando el adaptador expone
   * límites holgados; no es una medición de VRAM.
   */
  deviceTier?: 'high' | 'unknown';
}

export interface LocalRuntimeProfile {
  model: LocalModelDefinition;
  /** Motivo interno (solo diagnóstico avanzado). */
  reason: 'recommended-capable' | 'conservative-fallback' | 'cpu-wasm-fallback';
}

/**
 * Devuelve el modelo más adecuado para las capacidades dadas.
 * Si WebGPU está disponible, selecciona el modelo WebGPU óptimo.
 * Si WebGPU no está disponible pero WebAssembly está activo, selecciona el modelo CPU/WASM ligero.
 */
export function selectBestLocalModel(
  capabilities: LocalAiCapabilities
): LocalModelDefinition | null {
  const isWebGpuSupported = capabilities.webgpu === 'supported';
  const hasWasm = capabilities.hasWasm === true;

  if (isWebGpuSupported) {
    const knownFeatures = capabilities.supportedFeatures;

    // Modelos WebGPU que satisfacen las features reportadas
    const eligible = LOCAL_MODELS_REGISTRY.filter((model) => {
      if (model.runtimeBackend !== 'webgpu') return false;
      if (!model.requiredFeatures || model.requiredFeatures.length === 0) return true;
      if (!knownFeatures) return false;
      return model.requiredFeatures.every((feature) => knownFeatures.includes(feature));
    });

    if (eligible.length > 0) {
      const clearlySuitable =
        capabilities.deviceTier === 'high' &&
        Array.isArray(knownFeatures) &&
        knownFeatures.length > 0;

      if (clearlySuitable) {
        const recommended = eligible.find((model) => model.recommended);
        if (recommended) return recommended;
      }

      // Conservador: el modelo viable con menor huella estimada (desempate por id)
      return [...eligible].sort(
        (a, b) => a.vramRequiredMB - b.vramRequiredMB || a.id.localeCompare(b.id)
      )[0];
    }
  }

  // Fallback a CPU / WebAssembly si no hay WebGPU pero sí soporte WASM
  if (hasWasm) {
    const wasmModels = LOCAL_MODELS_REGISTRY.filter(m => m.runtimeBackend === 'wasm');
    if (wasmModels.length > 0) {
      // Priorizar Qwen2.5-0.5B por su soporte en español y razonamiento
      const defaultWasm = wasmModels.find(m => m.id === 'onnx-community/Qwen2.5-0.5B-Instruct');
      return defaultWasm || wasmModels[0];
    }
  }

  return null;
}

/** Igual que `selectBestLocalModel` pero expone el motivo para diagnóstico. */
export function selectRuntimeProfile(
  capabilities: LocalAiCapabilities
): LocalRuntimeProfile | null {
  const model = selectBestLocalModel(capabilities);
  if (!model) return null;

  if (model.runtimeBackend === 'wasm') {
    return {
      model,
      reason: 'cpu-wasm-fallback'
    };
  }

  const knownFeatures = capabilities.supportedFeatures;
  const clearlySuitable =
    capabilities.deviceTier === 'high' && Array.isArray(knownFeatures) && knownFeatures.length > 0;
  return {
    model,
    reason: clearlySuitable && model.recommended ? 'recommended-capable' : 'conservative-fallback'
  };
}
