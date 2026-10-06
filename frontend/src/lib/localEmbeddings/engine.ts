import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModelById } from './registry.ts';
import { detectEmbeddingCapabilities, type EmbeddingRuntimeBackend } from './capabilities.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION, expectedDimensionsForModel } from './cache.ts';
import type { SemanticChunk } from './chunking.ts';

export type EmbeddingEngineStatus =
  | 'disabled'
  | 'checking'
  | 'unsupported'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'embedding'
  | 'error'
  | 'unloading';

export interface EmbeddingProgress {
  progress: number;
  text: string;
}

/**
 * Calcula la norma L2 (euclidiana) de un vector.
 */
export function vectorNorm(v: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * Normaliza un vector mediante norma L2. Rechaza vectores con valores no finitos o norma 0.
 */
export function l2NormalizeVector(v: number[], expectedDimensions?: number): number[] {
  if (!v || v.length === 0) {
    throw new Error('Vector inválido: no puede estar vacío');
  }
  if (expectedDimensions !== undefined && v.length !== expectedDimensions) {
    throw new Error(`Vector inválido: se esperaban exactamente ${expectedDimensions} dimensiones, recibidas ${v.length}`);
  }
  for (let i = 0; i < v.length; i++) {
    if (!Number.isFinite(v[i])) {
      throw new Error(`Vector contiene valor no finito en el índice ${i}: ${v[i]}`);
    }
  }
  const norm = vectorNorm(v);
  if (norm === 0 || !Number.isFinite(norm)) {
    throw new Error('Vector con norma nula o inválida no puede ser normalizado');
  }
  return v.map(val => val / norm);
}

/**
 * Calcula la similitud de coseno pura entre dos vectores normalizados L2.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function stripKnownEmbeddingPrefix(text: string): string {
  return text.replace(
    /^(query:\s+|passage:\s+|task:\s+search result \| query:\s+|title:\s+none \| text:\s+)/i,
    ''
  );
}

class LocalEmbeddingEngine {
  private pipelineInstance: any = null;
  private currentModelId: string | null = null;
  private status: EmbeddingEngineStatus = 'idle';
  private lastError: string | null = null;
  private backend: EmbeddingRuntimeBackend = 'none';
  private progress: EmbeddingProgress = { progress: 0, text: '' };
  private listeners: Set<(status: EmbeddingEngineStatus, progress: EmbeddingProgress) => void> = new Set();
  private loadPromise: Promise<void> | null = null;
  private currentJobId: number = 0;

  public cancelIndexing(): void {
    this.currentJobId++;
    if (this.status === 'embedding') {
      this.status = 'ready';
      this.notify();
    }
  }

  public getStatus(): EmbeddingEngineStatus {
    return this.status;
  }

  public getLoadedModelId(): string | null {
    return this.currentModelId;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getProgress(): EmbeddingProgress {
    return this.progress;
  }

  public getBackend(): EmbeddingRuntimeBackend {
    return this.backend;
  }

  public subscribe(listener: (status: EmbeddingEngineStatus, progress: EmbeddingProgress) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.progress);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.status, this.progress);
      } catch (err) {
        console.error('Error en listener de embedding engine:', err);
      }
    }
  }

  /**
   * Carga perezosamente el modelo de embeddings usando Transformers.js.
   */
  public async loadModel(modelId: string = DEFAULT_EMBEDDING_MODEL_ID): Promise<void> {
    if (this.status === 'ready' && this.currentModelId === modelId && this.pipelineInstance) {
      return;
    }

    if (this.loadPromise && this.currentModelId === modelId && this.status === 'loading') {
      return this.loadPromise;
    }

    this.currentModelId = modelId;
    this.loadPromise = (async () => {
      this.status = 'checking';
      this.notify();

      const caps = await detectEmbeddingCapabilities();
      if (caps.state !== 'supported') {
        this.status = 'unsupported';
        this.lastError = 'Entorno sin soporte para ejecución de embeddings.';
        this.notify();
        throw new Error(this.lastError);
      }
      this.backend = caps.backend;

      const modelDef = getEmbeddingModelById(modelId);
      if (!modelDef) {
        this.status = 'error';
        this.lastError = `Modelo de embedding desconocido: ${modelId}`;
        this.notify();
        throw new Error(this.lastError);
      }

      this.status = 'loading';
      this.progress = { progress: 0, text: 'Iniciando pipeline de embeddings...' };
      this.notify();

      try {
        // Import dinámico de Transformers.js
        const { pipeline, env } = await import('@huggingface/transformers');
        
        // Configurar opciones de entorno local
        env.allowLocalModels = false;
        env.useBrowserCache = true;
        if (env.backends?.onnx?.wasm) {
          env.backends.onnx.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2);
        }

        let pipe: any;
        try {
          pipe = await pipeline('feature-extraction', modelId, {
            dtype: modelDef.preferredDtype ?? 'q8',
            device: caps.backend === 'webgpu' ? 'webgpu' : 'wasm',
            progress_callback: (item: any) => {
              if (item.status === 'progress' && item.progress !== undefined) {
                this.progress = {
                  progress: Math.round(item.progress),
                  text: `Descargando artefacto ONNX: ${item.file || ''}`
                };
                this.notify();
              }
            }
          });
        } catch (deviceErr: any) {
          // Si falló en WebGPU, reintentar con CPU (WASM) antes de arrojar error
          if (caps.backend === 'webgpu') {
            console.warn('Fallo inicializando embeddings en WebGPU, aplicando fallback a CPU/WASM:', deviceErr);
            this.backend = 'wasm';
            pipe = await pipeline('feature-extraction', modelId, {
              dtype: 'q8',
              device: 'wasm',
              progress_callback: (item: any) => {
                if (item.status === 'progress' && item.progress !== undefined) {
                  this.progress = {
                    progress: Math.round(item.progress),
                    text: `Descargando artefacto ONNX: ${item.file || ''}`
                  };
                  this.notify();
                }
              }
            });
          } else {
            throw deviceErr;
          }
        }

        this.pipelineInstance = pipe;
        this.status = 'ready';
        this.progress = { progress: 100, text: 'Modelo de embeddings listo.' };
        this.notify();
      } catch (err: any) {
        this.status = 'error';
        this.lastError = err?.message || 'Error cargando modelo de embeddings.';
        this.pipelineInstance = null;
        this.notify();
        throw err;
      }
    })();

    try {
      await this.loadPromise;
    } finally {
      this.loadPromise = null;
    }
  }

  /**
   * Genera el vector de embedding para un texto dado.
   * Aplica obligatoriamente el prefijo E5 ("query: " o "passage: "), ejecuta pooling 'mean' y normaliza L2 a 384 dimensiones.
   */
  public async embedText(text: string, isQuery: boolean = true): Promise<number[]> {
    if (this.status !== 'ready' || !this.pipelineInstance) {
      throw new Error('El motor de embeddings no está listo. Carga el modelo antes de generar vectores.');
    }

    this.status = 'embedding';
    this.notify();

    try {
      const modelDef = getEmbeddingModelById(modelId);
      if (!modelDef) throw new Error(`Modelo de embedding desconocido: ${modelId}`);

      const body = stripKnownEmbeddingPrefix(text.trim());
      const prefix = isQuery ? (modelDef.queryPrefix ?? '') : (modelDef.documentPrefix ?? '');
      const formattedInput = `${prefix}${body}`;

      const output = await this.pipelineInstance(formattedInput, {
        pooling: 'mean',
        normalize: false
      });

      const rawVector = Array.from(output.data as Float32Array | number[]);
      if (rawVector.length < modelDef.dimension) {
        throw new Error(
          `Embedding inválido: el modelo ${modelId} debería producir al menos ${modelDef.dimension} dimensiones y produjo ${rawVector.length}`
        );
      }

      const outputDimension = modelDef.outputDimension ?? modelDef.dimension;
      const truncatedVector = rawVector.slice(0, outputDimension);
      const vector = l2NormalizeVector(truncatedVector, outputDimension);

      this.status = 'ready';
      this.notify();
      return vector;
    } catch (err: any) {
      this.status = 'error';
      this.lastError = err?.message || 'Error generando embedding.';
      this.notify();
      throw err;
    }
  }

  /**
   * Indexa un conjunto de fragmentos de forma incremental y asíncrona, usando el caché de IndexedDB.
   * Previene carreras de indexación concurrentes y soporta cancelación inmediata.
   */
  /**
   * Purga proactiva de vectores de modelos/pipelines distintos del activo.
   *
   * Se invoca al preparar el índice semántico: al cambiar de modelo de
   * embeddings las entradas del anterior dejan de ser válidas, pero hasta ahora
   * solo se liberaban si el usuario limpiaba la caché a mano. Nunca lanza: una
   * purga fallida no debe impedir la indexación.
   */
  public async pruneStaleCache(activeModelId?: string): Promise<number> {
    const modelId = activeModelId || this.currentModelId || DEFAULT_EMBEDDING_MODEL_ID;
    try {
      return await embeddingCache.pruneOtherModels(modelId, EMBEDDING_PIPELINE_VERSION);
    } catch {
      return 0;
    }
  }

  public async indexChunks(
    chunks: SemanticChunk[],
    onProgress?: (indexed: number, total: number) => void
  ): Promise<number> {
    if (this.status !== 'ready' || !this.pipelineInstance) {
      throw new Error('El motor de embeddings debe estar listo para indexar contenido.');
    }

    const modelId = this.currentModelId || DEFAULT_EMBEDDING_MODEL_ID;
    const jobId = ++this.currentJobId;
    let newlyIndexed = 0;

    for (let i = 0; i < chunks.length; i++) {
      // Si el trabajo fue cancelado o reemplazado por otro más reciente, abortar inmediatamente
      if (this.currentJobId !== jobId) {
        throw new Error('Indexación cancelada o reemplazada por una nueva solicitud.');
      }

      const chunk = chunks[i];
      // La identidad de caché es el trío (chunk, modelo, versión de pipeline):
      // dos modelos nunca se pisan el vector del mismo fragmento.
      const cached = await embeddingCache.getEntry(chunk.chunkId, modelId);

      // Si existe, el hash SHA-256 no ha cambiado y la versión de pipeline coincide, reutilizar
      if (
        cached &&
        cached.modelId === modelId &&
        cached.pipelineVersion === EMBEDDING_PIPELINE_VERSION &&
        cached.contentHash === chunk.contentHash &&
        Array.isArray(cached.vector) &&
        cached.vector.length === expectedDimensionsForModel(modelId)
      ) {
        if (onProgress) onProgress(i + 1, chunks.length);
        continue;
      }

      // Generar nuevo embedding con prefijo passage
      const vector = await this.embedText(chunk.text, false);

      if (this.currentJobId !== jobId) {
        throw new Error('Indexación cancelada o reemplazada por una nueva solicitud.');
      }

      await embeddingCache.setEntry({
        chunkId: chunk.chunkId,
        sourceType: chunk.sourceType,
        sourceId: chunk.sourceId,
        title: chunk.title,
        text: chunk.text,
        contentHash: chunk.contentHash,
        modelId,
        pipelineVersion: EMBEDDING_PIPELINE_VERSION,
        dimensions: vector.length,
        vector,
        updatedAt: Date.now()
      });

      newlyIndexed++;
      if (onProgress) onProgress(i + 1, chunks.length);

      // Ceder el hilo de ejecución para no congelar la UI
      await new Promise(r => setTimeout(r, 0));
    }

    return newlyIndexed;
  }

  /**
   * Descarga el modelo y limpia recursos.
   */
  public async unload(): Promise<void> {
    this.status = 'unloading';
    this.notify();

    if (this.pipelineInstance && typeof this.pipelineInstance.dispose === 'function') {
      try {
        await this.pipelineInstance.dispose();
      } catch {}
    }

    this.pipelineInstance = null;
    this.currentModelId = null;
    this.status = 'idle';
    this.progress = { progress: 0, text: '' };
    this.lastError = null;
    this.notify();
  }
}

export const localEmbeddingEngine = new LocalEmbeddingEngine();
