export interface LocalModelDefinition {
  id: string;
  name: string;
  description: string;
  provider: 'webllm';
  vramRequiredMB: number;
  downloadSizeApprox: string;
  contextWindowSize: number;
  lowResourceRequired: boolean;
  requiredFeatures?: string[];
  recommended: boolean;
}

/**
 * Catálogo de modelos precompilados de WebLLM verificados contra el paquete instalado (@mlc-ai/web-llm ^0.2.85).
 * Modelo por defecto: Qwen3-1.7B-q4f16_1-MLC (multilingüe, ~2036 MB VRAM estimada, 4096 contexto).
 * Nota: El consumo real de VRAM y memoria depende de la GPU del sistema y del navegador.
 */
export const LOCAL_MODELS_REGISTRY: LocalModelDefinition[] = [
  {
    id: 'Qwen3-1.7B-q4f16_1-MLC',
    name: 'Qwen3 1.7B (Instruct)',
    description: 'Modelo multilingüe equilibrado y rápido para WebGPU.',
    provider: 'webllm',
    vramRequiredMB: 2036,
    downloadSizeApprox: '~1.1 GB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: true
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    name: 'Llama 3.2 1B (Instruct)',
    description: 'Modelo ultraligero de Meta (~879 MB VRAM base) para dispositivos de recursos moderados.',
    provider: 'webllm',
    vramRequiredMB: 879,
    downloadSizeApprox: '~850 MB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: false
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 1.7B (Instruct)',
    description: 'Modelo compacto de HuggingFace optimizado para razonamiento local. Requiere shader-f16.',
    provider: 'webllm',
    vramRequiredMB: 1774,
    downloadSizeApprox: '~1.0 GB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    requiredFeatures: ['shader-f16'],
    recommended: false
  },
  {
    id: 'Qwen3-0.6B-q4f16_1-MLC',
    name: 'Qwen3 0.6B (Nano)',
    description: 'Modelo compacto de la familia Qwen3 con mínima huella (~1403 MB VRAM base).',
    provider: 'webllm',
    vramRequiredMB: 1403,
    downloadSizeApprox: '~500 MB',
    contextWindowSize: 4096,
    lowResourceRequired: true,
    recommended: false
  }
];

export const DEFAULT_LOCAL_MODEL_ID = 'Qwen3-1.7B-q4f16_1-MLC';

export function getLocalModelById(id: string): LocalModelDefinition | undefined {
  return LOCAL_MODELS_REGISTRY.find(m => m.id === id);
}
