export interface EmbeddingModelDefinition {
  id: string;
  name: string;
  description: string;
  dimension: number;
  dimensions?: number;
  downloadSizeApprox: string;
  onnxArtifact: string;
  languages: string;
  license: string;
  recommended: boolean;
  quantization?: string;
}

/**
 * Catálogo de modelos de embeddings verificados para ejecución directa en el navegador con Transformers.js.
 * Modelo por defecto: Xenova/multilingual-e5-small (ONNX quantizado, 384 dimensiones, ~94 idiomas, MIT).
 */
export const LOCAL_EMBEDDING_MODELS: EmbeddingModelDefinition[] = [
  {
    id: 'Xenova/multilingual-e5-small',
    name: 'Multilingual E5 Small (ONNX)',
    description: 'Modelo multilingüe de alta calidad y tamaño óptimo (~135 MB cuantizado q8 / fp32) con soporte de 94 idiomas. Basado en intfloat/multilingual-e5-small.',
    dimension: 384,
    dimensions: 384,
    downloadSizeApprox: '~135 MB',
    onnxArtifact: 'onnx/model_quantized.onnx',
    languages: 'Multilingüe (94 idiomas incl. ES, EN)',
    license: 'MIT',
    quantization: 'q8',
    recommended: true
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'MiniLM L6 v2 (English)',
    description: 'Modelo ultraligero y rápido (~45 MB cuantizado) optimizado para inglés y baja latencia en CPU/WASM.',
    dimension: 384,
    dimensions: 384,
    downloadSizeApprox: '~45 MB',
    onnxArtifact: 'onnx/model_quantized.onnx',
    languages: 'Inglés prioritario',
    license: 'Apache-2.0',
    quantization: 'q8',
    recommended: false
  }
];

export const EMBEDDING_MODELS_REGISTRY = LOCAL_EMBEDDING_MODELS;

export const DEFAULT_EMBEDDING_MODEL_ID = 'Xenova/multilingual-e5-small';

export function getEmbeddingModelById(id: string): EmbeddingModelDefinition | undefined {
  return LOCAL_EMBEDDING_MODELS.find(m => m.id === id);
}
