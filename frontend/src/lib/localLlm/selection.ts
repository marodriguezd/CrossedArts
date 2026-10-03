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
  reason: 'recommended-capable' | 'conservative-fallback';
}

/**
 * Devuelve el modelo más adecuado para las capacidades dadas, o `null` si la
 * inferencia local no es viable en absoluto. Determinista: mismo input ->
 * mismo modelo.
 */
export function selectBestLocalModel(
  capabilities: LocalAiCapabilities
): LocalModelDefinition | null {
  if (capabilities.webgpu !== 'supported') return null;

  const knownFeatures = capabilities.supportedFeatures;

  // Un requisito solo se considera satisfecho si la feature está EXPLÍCITAMENTE
  // soportada. Con features desconocidas se excluyen los modelos que las exigen.
  const eligible = LOCAL_MODELS_REGISTRY.filter((model) => {
    if (!model.requiredFeatures || model.requiredFeatures.length === 0) return true;
    if (!knownFeatures) return false;
    return model.requiredFeatures.every((feature) => knownFeatures.includes(feature));
  });

  if (eligible.length === 0) return null;

  // "Claramente adecuado" exige features conocidas y una pista de gama alta.
  // Nunca se infiere VRAM exacta.
  const clearlySuitable =
    capabilities.deviceTier === 'high' &&
    Array.isArray(knownFeatures) &&
    knownFeatures.length > 0;

  if (clearlySuitable) {
    const recommended = eligible.find((model) => model.recommended);
    if (recommended) return recommended;
  }

  // Conservador: el modelo viable con menor huella estimada (desempate por id).
  return [...eligible].sort(
    (a, b) => a.vramRequiredMB - b.vramRequiredMB || a.id.localeCompare(b.id)
  )[0];
}

/** Igual que `selectBestLocalModel` pero expone el motivo para diagnóstico. */
export function selectRuntimeProfile(
  capabilities: LocalAiCapabilities
): LocalRuntimeProfile | null {
  const model = selectBestLocalModel(capabilities);
  if (!model) return null;
  const knownFeatures = capabilities.supportedFeatures;
  const clearlySuitable =
    capabilities.deviceTier === 'high' && Array.isArray(knownFeatures) && knownFeatures.length > 0;
  return {
    model,
    reason: clearlySuitable && model.recommended ? 'recommended-capable' : 'conservative-fallback'
  };
}
