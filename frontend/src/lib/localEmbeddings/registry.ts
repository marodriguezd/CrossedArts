export interface EmbeddingModelDefinition {
  id: string;
  name: string;
  description: string;
  dimension: number;
  dimensions?: number;
  outputDimension?: number;
  downloadSizeApprox: string;
  onnxArtifact: string;
  languages: string;
  license: string;
  recommended: boolean;
  quantization?: string;
  queryPrefix?: string;
  documentPrefix?: string;
  preferredBackend?: 'webgpu' | 'wasm';
  preferredDtype?: 'fp32' | 'q8' | 'q4';
  multimodal?: boolean;
}

/**
 * Modelos de embeddings verificados para ejecución local con Transformers.js.
 *
 * EmbeddingGemma 2 (740M, multimodal) no dispone todavía de un export
 * ONNX/Transformers.js verificado para este frontend. No se declara falsamente
 * como integrado. Se integra EmbeddingGemma 300M, que sí tiene un export ONNX
 * documentado para Transformers.js en navegador.
 */
export const LOCAL_EMBEDDING_MODELS: EmbeddingModelDefinition[] = [
  {
    id: 'onnx-community/embeddinggemma-300m-ONNX',
    name: 'EmbeddingGemma 300M (ONNX)',
    description: 'Embedding multilingüe local de 300M parámetros para búsqueda semántica y RAG. Salida nativa de 768d reducida a 256d mediante Matryoshka Representation Learning.',
    dimension: 768,
    dimensions: 256,
    outputDimension: 256,
    downloadSizeApprox: 'ONNX q8 (descarga bajo demanda)',
    onnxArtifact: 'onnx/model_quantized.onnx',
    languages: '100+ idiomas',
    license: 'Gemma Terms of Use',
    quantization: 'q8',
    queryPrefix: 'task: search result | query: ',
    documentPrefix: 'title: none | text: ',
    preferredBackend: 'wasm',
    preferredDtype: 'q8',
    multimodal: false,
    recommended: true
  },
  {
    id: 'Xenova/multilingual-e5-small',
    name: 'Multilingual E5 Small (ONNX)',
    description: 'Modelo multilingüe ligero basado en intfloat/multilingual-e5-small.',
    dimension: 384,
    dimensions: 384,
    outputDimension: 384,
    downloadSizeApprox: '~135 MB',
    onnxArtifact: 'onnx/model_quantized.onnx',
    languages: 'Multilingüe (94 idiomas incl. ES, EN)',
    license: 'MIT',
    quantization: 'q8',
    queryPrefix: 'query: ',
    documentPrefix: 'passage: ',
    recommended: false
  },
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    name: 'MiniLM L6 v2 (English)',
    description: 'Modelo ultraligero y rápido optimizado para inglés y baja latencia en CPU/WASM.',
    dimension: 384,
    dimensions: 384,
    outputDimension: 384,
    downloadSizeApprox: '~45 MB',
    onnxArtifact: 'onnx/model_quantized.onnx',
    languages: 'Inglés prioritario',
    license: 'Apache-2.0',
    quantization: 'q8',
    recommended: false
  }
];

export const EMBEDDING_MODELS_REGISTRY = LOCAL_EMBEDDING_MODELS;

export const DEFAULT_EMBEDDING_MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX';

export function getEmbeddingModelById(id: string): EmbeddingModelDefinition | undefined {
  return LOCAL_EMBEDDING_MODELS.find(m => m.id === id);
}
