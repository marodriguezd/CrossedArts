import { LOCAL_MODELS_REGISTRY, type LocalModelDefinition } from './registry.ts';

/**
 * Tareas pedagógicas que la IA local puede ejecutar. La tarea influences QUÉ
 * modelo conviene, nunca SI el hardware lo soporta: la elegibilidad la decide
 * siempre `selectBestLocalModel` (capacidades reales), y la tarea solo ordena
 * preferences entre los modelos ya elegibles.
 */
export type AIModelTask =
  | 'tutor'
  | 'summarization'
  | 'flashcard_generation'
  | 'question_generation'
  | 'light_assistance';

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

  // Fallback a CPU / WebAssembly si no hay WebGPU pero sí soporte WASM.
  // El orden de preferencia es el canónico (`wasmModelsInPreferenceOrder`).
  if (hasWasm) {
    const wasmModels = wasmModelsInPreferenceOrder();
    if (wasmModels.length > 0) return wasmModels[0];
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


/* -------------------------------------------------------------------------- */
/* Selección por tarea (una sola implementación)                        */
/* -------------------------------------------------------------------------- */

/**
 * Orden de preferencia de los modelos CPU/WASM.
 *
 * Qwen2.5-0.5B va primero por su soporte en español y razonamiento (decisión de
 * producto ya existente); el resto sigue un orden explícito y determinista, no
 * una comparación por nombre.
 */
const WASM_PREFERENCE_ORDER = [
  'onnx-community/Qwen2.5-0.5B-Instruct',
  'HuggingFaceTB/SmolLM2-360M-Instruct'
];

function wasmModelsInPreferenceOrder(): LocalModelDefinition[] {
  const wasm = LOCAL_MODELS_REGISTRY.filter(m => m.runtimeBackend === 'wasm');
  const ordered: LocalModelDefinition[] = [];
  for (const id of WASM_PREFERENCE_ORDER) {
    const found = wasm.find(m => m.id === id);
    if (found) ordered.push(found);
  }
  for (const model of wasm) {
    if (!ordered.includes(model)) ordered.push(model);
  }
  return ordered;
}

/**
 * Preferencia por tarea dentro de los modelos YA ELEGIBLES.
 *
 * El orden es explícito y determinista; si ningún id está disponible se cae al
 * criterio por defecto de la tarea (recomendado o menor huella), nunca al azar.
 */
const TASK_PREFERENCE: Record<AIModelTask, string[]> = {
  // Generación estructurada: se prioriza la adherencia a JSON.
  flashcard_generation: [
    'Qwen3-1.7B-q4f16_1-MLC',
    'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'Qwen3-0.6B-q4f16_1-MLC',
    'onnx-community/Qwen2.5-0.5B-Instruct',
    'HuggingFaceTB/SmolLM2-360M-Instruct'
  ],
  question_generation: [
    'Qwen3-1.7B-q4f16_1-MLC',
    'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'Qwen3-0.6B-q4f16_1-MLC',
    'onnx-community/Qwen2.5-0.5B-Instruct',
    'HuggingFaceTB/SmolLM2-360M-Instruct'
  ],
  // Asistencia ligera: el modelo viable más pequeño.
  light_assistance: [],
  // Tutor y resumen: el modelo recomendado que el dispositivo permita.
  tutor: [],
  summarization: []
};

/**
 * Selección CANÓNICA de modelo para una tarea, respetando las capacidades.
 *
 * Regla: primero se determina el conjunto ELEGIBLE por hardware (WebGPU con sus
 * features reportadas, o CPU/WASM). Solo entre esos candidatos se aplica la
 * preferencia de la tarea. Si la tarea no expresa preferencia o ninguno de sus
 * modelos está disponible, se usa el recomendado del conjunto elegible y, en su
 * defecto, el de menor huella estimada (desempate por id). Determinista.
 *
 * Es la ÚNICA política de selección por tarea: la preparación del runtime la usa
 * directamente, de modo que no puede existir una segunda ruta de selección.
 */
export function selectBestLocalModelForTask(
  capabilities: LocalAiCapabilities,
  task: AIModelTask = 'tutor'
): LocalModelDefinition | null {
  const eligible = eligibleModelsFor(capabilities);
  if (!eligible.length) return null;

  // Criterio conservador: el viable de menor huella estimada. Los empates (todos
  // los modelos CPU declaran 0 MB) se resuelven por el ORDEN CANÓNICO de
  // elegibilidad, no alfabéticamente: así la preferencia de producto del runtime
  // CPU (Qwen2.5-0.5B) se respeta sin dejar de ser determinista.
  const smallest = [...eligible].sort(
    (a, b) =>
      a.vramRequiredMB - b.vramRequiredMB ||
      eligible.indexOf(a) - eligible.indexOf(b) ||
      a.id.localeCompare(b.id)
  )[0];

  // Dispositivo claramente capaz: se puede elegir por tarea (y por preferencia de
  // calidad) porque hay margen. Cuando la información es incierta NO se asume
  // capacidad: se conserva el criterio conservador de siempre, el viable más
  // pequeño. Así la selección por tarea nunca sube la exigencia de hardware.
  const clearlySuitable =
    capabilities.deviceTier === 'high' &&
    Array.isArray(capabilities.supportedFeatures) &&
    capabilities.supportedFeatures.length > 0;

  if (!clearlySuitable) return smallest;

  for (const id of TASK_PREFERENCE[task]) {
    const found = eligible.find(m => m.id === id);
    if (found) return found;
  }

  const recommended = eligible.find(m => m.recommended);
  return recommended ?? smallest;
}

/** Modelos que el dispositivo puede ejecutar según sus capacidades declaradas. */
export function eligibleModelsFor(capabilities: LocalAiCapabilities): LocalModelDefinition[] {
  if (capabilities.webgpu === 'supported') {
    const knownFeatures = capabilities.supportedFeatures;
    return LOCAL_MODELS_REGISTRY.filter((model) => {
      if (model.runtimeBackend !== 'webgpu') return false;
      if (!model.requiredFeatures || model.requiredFeatures.length === 0) return true;
      if (!knownFeatures) return false;
      return model.requiredFeatures.every((feature) => knownFeatures.includes(feature));
    });
  }

  if (capabilities.hasWasm === true) {
    return wasmModelsInPreferenceOrder();
  }

  return [];
}
