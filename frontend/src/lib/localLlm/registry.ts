export interface LocalModelDefinition {
  id: string;
  name: string;
  description: string;
  provider: 'webllm' | 'transformers_wasm';
  runtimeBackend: 'webgpu' | 'wasm';
  vramRequiredMB: number;
  downloadSizeApprox: string;
  contextWindowSize: number;
  lowResourceRequired: boolean;
  requiredFeatures?: string[];
  recommended: boolean;
  /** Languages with verified high-fidelity support (e.g. ['es', 'en', 'fr', 'pt']). */
  languages?: string[];
  /** Deployment profile used for grouping in the UI. */
  category?: 'multilingual' | 'ultralight' | 'cpu_wasm' | 'advanced';
}

/**
 * Local model catalog: hardware-accelerated WebGPU plus a CPU/WASM fallback via Transformers.js.
 */
export const LOCAL_MODELS_REGISTRY: LocalModelDefinition[] = [
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B (Instruct)',
    description: 'Modelo multilingüe equilibrado y rápido para WebGPU con excelente soporte en español.',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 2036,
    downloadSizeApprox: '~1.1 GB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: true,
    languages: ['es', 'en', 'fr', 'pt'],
    category: 'multilingual'
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 1.5B (Instruct)',
    description: 'Especialista multilingüe de alta precisión en español, francés, portugués e inglés con cuantización 4-bit.',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 1820,
    downloadSizeApprox: '~1.1 GB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: false,
    languages: ['es', 'en', 'fr', 'pt'],
    category: 'multilingual'
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B (Instruct)',
    description: 'Modelo ultraligero de Meta (~879 MB VRAM base) para dispositivos de recursos moderados.',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 879,
    downloadSizeApprox: '~850 MB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: false,
    languages: ['en', 'es'],
    category: 'ultralight'
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 1.7B (Instruct)',
    description: 'Modelo compacto de HuggingFace optimizado para razonamiento local. Requiere shader-f16.',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 1774,
    downloadSizeApprox: '~1.0 GB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    requiredFeatures: ['shader-f16'],
    recommended: false,
    languages: ['en', 'es', 'fr'],
    category: 'multilingual'
  },
  {
    id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 7B (Instruct - Avanzado)',
    description: 'Modelo de gran escala con máximo razonamiento y fidelidad en español. Requiere GPU potente con ≥6 GB de VRAM.',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 5300,
    downloadSizeApprox: '~4.2 GB',
    contextWindowSize: 4096,
    lowResourceRequired: false,
    recommended: false,
    languages: ['es', 'en', 'fr', 'pt'],
    category: 'advanced'
  },
  {
    id: 'Qwen3-0.6B-q4f16_1-MLC',
    name: 'Qwen3 0.6B (Nano)',
    description: 'Modelo compacto de la familia Qwen3 con mínima huella (~1403 MB VRAM base).',
    provider: 'webllm',
    runtimeBackend: 'webgpu',
    vramRequiredMB: 1403,
    downloadSizeApprox: '~500 MB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: false,
    languages: ['es', 'en'],
    category: 'ultralight'
  },
  {
    id: 'onnx-community/Qwen2.5-0.5B-Instruct',
    name: 'Qwen 2.5 0.5B (CPU / WASM)',
    description: 'Modelo multilingüe ligero ejecutado 100% en CPU y RAM vía WebAssembly (sin requerir WebGPU).',
    provider: 'transformers_wasm',
    runtimeBackend: 'wasm',
    vramRequiredMB: 0,
    downloadSizeApprox: '~350 MB',
    contextWindowSize: 2048,
    lowResourceRequired: true,
    recommended: false,
    languages: ['es', 'en', 'fr', 'pt'],
    category: 'cpu_wasm'
  },
  {
    id: 'HuggingFaceTB/SmolLM2-360M-Instruct',
    name: 'SmolLM2 360M (CPU / WASM)',
    description: 'Modelo ultracompacto de HuggingFace optimizado para CPU y mínimo consumo de RAM (~200 MB).',
    provider: 'transformers_wasm',
    runtimeBackend: 'wasm',
    vramRequiredMB: 0,
    downloadSizeApprox: '~200 MB',
    contextWindowSize: 2048,
    lowResourceRequired: true,
    recommended: false,
    languages: ['en', 'es'],
    category: 'cpu_wasm'
  }
];

export const DEFAULT_LOCAL_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';
export const DEFAULT_WASM_MODEL_ID = 'onnx-community/Qwen2.5-0.5B-Instruct';

export function getLocalModelById(id: string): LocalModelDefinition | undefined {
  return LOCAL_MODELS_REGISTRY.find(m => m.id === id);
}
