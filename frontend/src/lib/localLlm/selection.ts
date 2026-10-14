import { LOCAL_MODELS_REGISTRY, type LocalModelDefinition } from './registry.ts';

/**
 * Tutoring tasks local AI can run. The task influences WHICH model fits, never
 * WHETHER the hardware supports it: eligibility always comes from
 * `selectBestLocalModel` (real capabilities); the task only orders preferences
 * among already eligible models.
 */
export type AIModelTask =
  | 'tutor'
  | 'summarization'
  | 'flashcard_generation'
  | 'question_generation'
  | 'light_assistance';

/**
 * Internal deterministic local-model selection policy. Users NEVER pick a
 * model in the normal flow: CrossedArts decides for them. Browsers never
 * expose real VRAM, so exact capacity is NEVER assumed. Only conservative
 * signals apply:
 *   - WebGPU availability,
 *   - features EXPLICITLY reported by the adapter,
 *   - a coarse high-tier hint (`deviceTier`) from generous limits. Under
 * uncertain information the smallest viable model always wins.
 */

export type WebGpuSupport = 'supported' | 'unsupported' | 'unknown';

export interface LocalAiCapabilities {
  webgpu: WebGpuSupport;
  hasWasm?: boolean;
  /**
   * Adapter-reported features. `null`/`undefined` means UNKNOWN: support for no
   * requirement is assumed.
   */
  supportedFeatures?: string[] | null;
  /**
   * Conservative tier hint. `'high'` only when the adapter exposes generous
   * limits; not a VRAM measurement.
   */
  deviceTier?: 'high' | 'unknown';
}

export interface LocalRuntimeProfile {
  model: LocalModelDefinition;
  /** Internal reason (advanced diagnostics only). */
  reason: 'recommended-capable' | 'conservative-fallback' | 'cpu-wasm-fallback';
}

/**
 * Returns the best model for the given capabilities. With WebGPU available it
 * picks the optimal WebGPU model; without WebGPU but with WebAssembly it picks
 * the light CPU/WASM model.
 */
export function selectBestLocalModel(
  capabilities: LocalAiCapabilities
): LocalModelDefinition | null {
  const isWebGpuSupported = capabilities.webgpu === 'supported';
  const hasWasm = capabilities.hasWasm === true;

  if (isWebGpuSupported) {
    const knownFeatures = capabilities.supportedFeatures;

    // WebGPU models satisfying the reported features
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

      // Conservative: viable model with the smallest estimated footprint (id tiebreak)
      return [...eligible].sort(
        (a, b) => a.vramRequiredMB - b.vramRequiredMB || a.id.localeCompare(b.id)
      )[0];
    }
  }

  // CPU / WebAssembly fallback without WebGPU but with WASM support.
  // Preference order is the canonical one (`wasmModelsInPreferenceOrder`).
  if (hasWasm) {
    const wasmModels = wasmModelsInPreferenceOrder();
    if (wasmModels.length > 0) return wasmModels[0];
  }

  return null;
}

/** Same as `selectBestLocalModel` but exposes the reason for diagnostics. */
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
/* Per-task selection (single implementation)                            */
/* -------------------------------------------------------------------------- */

/**
 * CPU/WASM model preference order. Qwen2.5-0.5B goes first for its Spanish
 * support and reasoning (existing product decision); the rest follows an
 * explicit deterministic order, not a name comparison.
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
 * Per-task preference among ALREADY ELIGIBLE models. The order is explicit
 * and deterministic; when no id is available it falls back to the task default
 * (recommended or smallest footprint), never to chance.
 */
const TASK_PREFERENCE: Record<AIModelTask, string[]> = {
  // Structured generation: JSON adherence wins.
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
  // Light assistance: the smallest viable model.
  light_assistance: [],
  // Tutor and summary: the recommended model the device allows.
  tutor: [],
  summarization: []
};

/**
 * CANONICAL per-task model selection, honoring capabilities. Rule: first
 * determine the hardware-ELIGIBLE set (WebGPU with reported features, or
 * CPU/WASM). Task preference applies only among those candidates. When the
 * task states no preference or none of its models is available, use the
 * eligible set's recommended model, else the smallest estimated footprint (id
 * tiebreak). Deterministic. This is the ONLY per-task selection policy: the
 * runtime setup uses it directly, so no second selection path can exist.
 */
export function selectBestLocalModelForTask(
  capabilities: LocalAiCapabilities,
  task: AIModelTask = 'tutor'
): LocalModelDefinition | null {
  const eligible = eligibleModelsFor(capabilities);
  if (!eligible.length) return null;

  // Conservative rule: viable model with the smallest estimated footprint. Ties
  // (all CPU models declare 0 MB) resolve by the CANONICAL eligibility ORDER,
  // not alphabetically: the CPU runtime product preference (Qwen2.5-0.5B) holds
  // while staying deterministic.
  const smallest = [...eligible].sort(
    (a, b) =>
      a.vramRequiredMB - b.vramRequiredMB ||
      eligible.indexOf(a) - eligible.indexOf(b) ||
      a.id.localeCompare(b.id)
  )[0];

  // Clearly capable device: per-task (and quality-preference) choice is safe
  // with headroom. Under uncertain information NO capability is assumed: keep
  // the usual conservative rule, the smallest viable model. Per-task selection
  // thus never raises hardware demands.
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

/** Models the device can run per its declared capabilities. */
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
