import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModelById, type EmbeddingModelDefinition } from './registry.ts';
import {
  detectEmbeddingCapabilities,
  type EmbeddingCapabilitiesReport,
  type EmbeddingRuntimeBackend
} from './capabilities.ts';
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

/** Petición normalizada al motor de embeddings (modelo, dtype, dispositivo). */
export interface EmbeddingPipelineRequest {
  modelId: string;
  dtype: NonNullable<EmbeddingModelDefinition['preferredDtype']>;
  device: 'webgpu' | 'wasm';
  onProgress: (item: any) => void;
}

/**
 * Fábrica del pipeline de Transformers.js.
 *
 * Punto de inyección único del motor: la implementación por defecto importa
 * `@huggingface/transformers` en diferido y configura su entorno local; los
 * tests (y cualquier entorno sin red) pueden sustituir la descarga real del
 * modelo por un doble determinista sin tocar la lógica de selección de
 * backend, prefijos ni dimensiones.
 */
export type EmbeddingPipelineFactory = (request: EmbeddingPipelineRequest) => Promise<any>;

const defaultEmbeddingPipelineFactory: EmbeddingPipelineFactory = async ({ modelId, dtype, device, onProgress }) => {
  const { pipeline, env } = await import('@huggingface/transformers');

  // Configuración de entorno local: los modelos se resuelven contra el Hub y
  // se cachean en el navegador (primera descarga, después sin red).
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = Math.min(
      4,
      typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2
    );
  }

  return pipeline('feature-extraction', modelId, {
    dtype,
    device,
    progress_callback: onProgress
  });
};

/**
 * Resuelve el dispositivo con el que se debe cargar un modelo.
 *
 * Reglas, en orden:
 *  1. Si el registro declara `preferredBackend`, ese valor manda siempre que
 *     el entorno lo soporte (EmbeddingGemma declara `wasm` y se carga en wasm
 *     aunque el navegador ofrezca WebGPU).
 *  2. Sin preferencia declarada, se usa el backend detectado por capacidades.
 *  3. Si se pide `webgpu` y el entorno no lo soporta, se degrada a `wasm`.
 */
function resolveEmbeddingDevice(
  modelDef: EmbeddingModelDefinition,
  caps: EmbeddingCapabilitiesReport
): 'webgpu' | 'wasm' {
  const preferred = modelDef.preferredBackend ?? (caps.backend === 'webgpu' ? 'webgpu' : 'wasm');
  if (preferred === 'webgpu' && caps.backend !== 'webgpu') return 'wasm';
  return preferred;
}

export class LocalEmbeddingEngine {
  private pipelineInstance: any = null;
  private currentModelId: string | null = null;
  private status: EmbeddingEngineStatus = 'idle';
  private lastError: string | null = null;
  private backend: EmbeddingRuntimeBackend = 'none';
  private progress: EmbeddingProgress = { progress: 0, text: '' };
  private listeners: Set<(status: EmbeddingEngineStatus, progress: EmbeddingProgress) => void> = new Set();
  private loadPromise: Promise<void> | null = null;
  /**
   * Identificador de sesión de carga. Se incrementa en cada `loadModel()` y en
   * cada `unload()`. Toda continuación asíncrona comprueba que su sesión sigue
   * vigente antes de tocar el estado, de modo que una carga antigua nunca puede
   * pisar a otra más reciente ni reactivar una instancia ya descargada.
   */
  private loadSessionId: number = 0;
  private currentJobId: number = 0;
  private dirtyPending: boolean = false;

  public markDirty(): void {
    this.dirtyPending = true;
  }

  public isDirty(): boolean {
    return this.dirtyPending;
  }

  public clearDirty(): void {
    this.dirtyPending = false;
  }

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
   *
   * `options` es el punto de inyección para entornos deterministas (tests):
   * permite sustituir la detección de capacidades y/o la fábrica del pipeline
   * sin descargar el modelo. En producción no se pasa y se usan los valores
   * por defecto.
   */
  public async loadModel(
    modelId: string = DEFAULT_EMBEDDING_MODEL_ID,
    options?: {
      detectCapabilities?: () => Promise<EmbeddingCapabilitiesReport>;
      createPipeline?: EmbeddingPipelineFactory;
    }
  ): Promise<void> {
    if (this.status === 'ready' && this.currentModelId === modelId && this.pipelineInstance) {
      return;
    }

    // Carga ya en curso del MISMO modelo: se comparte la promesa (una sola descarga).
    if (this.loadPromise && this.currentModelId === modelId && (this.status === 'loading' || this.status === 'checking')) {
      return this.loadPromise;
    }

    const sessionId = ++this.loadSessionId;
    this.currentModelId = modelId;
    this.loadPromise = (async () => {
      this.status = 'checking';
      this.lastError = null;
      this.notify();

      const caps = await (options?.detectCapabilities ?? detectEmbeddingCapabilities)();
      if (sessionId !== this.loadSessionId) return; // sesión reemplazada durante la detección
      if (caps.state !== 'supported') {
        this.status = 'unsupported';
        this.lastError = 'Entorno sin soporte para ejecución de embeddings.';
        this.notify();
        throw new Error(this.lastError);
      }

      const modelDef = getEmbeddingModelById(modelId);
      if (!modelDef) {
        this.status = 'error';
        this.lastError = `Modelo de embedding desconocido: ${modelId}`;
        this.notify();
        throw new Error(this.lastError);
      }

      // Backend efectivo: respeta la preferencia del registro y solo degrada
      // cuando el entorno no la soporta. Se fija ANTES de crear el pipeline y
      // se expone vía getBackend() para que la UI y los tests lo verifiquen.
      const device = resolveEmbeddingDevice(modelDef, caps);
      const dtype = modelDef.preferredDtype ?? 'q8';
      const createPipeline = options?.createPipeline ?? defaultEmbeddingPipelineFactory;
      // Los callbacks de una sesión obsoleta se ignoran por completo: no pueden
      // sobrescribir el progreso ni el estado de una carga más reciente.
      const onProgress = (item: any) => {
        if (sessionId !== this.loadSessionId) return;
        if (item.status === 'progress' && item.progress !== undefined) {
          this.progress = {
            progress: Math.round(item.progress),
            text: `Descargando artefacto ONNX: ${item.file || ''}`
          };
          this.notify();
        }
      };

      // Nunca conviven dos pipelines: se libera el anterior antes de reemplazarlo.
      await this.disposePipeline(this.pipelineInstance);
      if (sessionId !== this.loadSessionId) return;
      this.pipelineInstance = null;

      this.backend = device;
      this.status = 'loading';
      this.progress = { progress: 0, text: 'Iniciando pipeline de embeddings...' };
      this.notify();

      let pipe: any;
      try {
        try {
          pipe = await createPipeline({ modelId, dtype, device, onProgress });
        } catch (deviceErr: any) {
          if (sessionId !== this.loadSessionId) return;
          // Solo se reintenta si el intento FALLIDO fue sobre WebGPU.
          if (device === 'webgpu') {
            console.warn('Fallo inicializando embeddings en WebGPU, aplicando fallback a CPU/WASM:', deviceErr);
            pipe = await createPipeline({ modelId, dtype, device: 'wasm', onProgress });
            if (sessionId === this.loadSessionId) this.backend = 'wasm';
          } else {
            throw deviceErr;
          }
        }
      } catch (err: any) {
        if (sessionId !== this.loadSessionId) return;
        this.status = 'error';
        this.lastError = err?.message || 'Error cargando modelo de embeddings.';
        this.pipelineInstance = null;
        this.notify();
        throw err;
      }

      // Sesión reemplazada mientras se descargaba el modelo: la instancia recién
      // creada se libera y NUNCA se publica como activa.
      if (sessionId !== this.loadSessionId) {
        await this.disposePipeline(pipe);
        return;
      }

      this.pipelineInstance = pipe;
      this.status = 'ready';
      this.lastError = null;
      this.progress = { progress: 100, text: 'Modelo de embeddings listo.' };
      this.notify();
    })();

    try {
      await this.loadPromise;
    } finally {
      // Solo la sesión vigente limpia el puntero compartido.
      if (sessionId === this.loadSessionId) {
        this.loadPromise = null;
      }
    }
  }

  /**
   * Libera un pipeline de forma segura: nunca lanza y acepta `null`.
   *
   * Es la única rutina usada para descargar instancias (reemplazo de modelo,
   * sesión obsoleta y `unload()`), de modo que el ciclo de vida de la instancia
   * nativa se gestiona en un único punto.
   */
  private async disposePipeline(pipe: any): Promise<void> {
    if (!pipe || typeof pipe.dispose !== 'function') return;
    try {
      await pipe.dispose();
    } catch {
      /* liberar nunca debe enmascarar el resultado de la operación */
    }
  }

  /**
   * Genera el vector de embedding para un texto dado usando el modelo ACTIVO.
   *
   * - Aplica el prefijo del modelo (`queryPrefix`/`documentPrefix` del
   *   registro: para EmbeddingGemma, "task: search result | query: " /
   *   "title: none | text: ").
   * - Ejecuta pooling 'mean' sin normalizar, valida la salida nativa
   *   (768d para EmbeddingGemma), trunca a la dimensión EFEECTIVA del modelo
   *   (`outputDimension`, 256d vía MRL) y solo entonces normaliza L2.
   */
  public async embedText(text: string, isQuery: boolean = true): Promise<number[]> {
    const modelId = this.currentModelId ?? DEFAULT_EMBEDDING_MODEL_ID;
    return this.embedTextForModel(modelId, text, isQuery);
  }

  /**
   * Genera el embedding con una identidad de modelo CONCRETA.
   *
   * Falla si el modelo activo ya no es ese, de modo que el vector devuelto
   * siempre corresponde a la identidad con la que el llamador va a cachearlo.
   * Así la indexación queda ligada al modelo y no a un estado mutable que pudo
   * cambiar durante un `await` (p. ej. si otro `loadModel` la reemplaza).
   */
  private async embedTextForModel(modelId: string, text: string, isQuery: boolean): Promise<number[]> {
    if (this.status !== 'ready' || !this.pipelineInstance) {
      throw new Error('El motor de embeddings no está listo. Carga el modelo antes de generar vectores.');
    }
    if (this.currentModelId !== modelId) {
      throw new Error('La indexación fue cancelada: el modelo activo cambió durante el proceso.');
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

      // Si un `loadModel`/`unload` cambió el modelo mientras se calculaba, el
      // estado lo gestiona esa operación: aquí no se revierte a 'ready' ni se
      // marca 'error' sobre una identidad que ya no es la activa.
      if (this.currentModelId === modelId) {
        this.status = 'ready';
        this.notify();
      }
      return vector;
    } catch (err: any) {
      if (this.currentModelId === modelId) {
        this.status = 'error';
        this.lastError = err?.message || 'Error generando embedding.';
        this.notify();
      }
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

    /** El trabajo sigue vigente sólo si nada lo canceló NI el modelo activo cambió. */
    const assertJobCurrent = () => {
      if (this.currentJobId !== jobId || this.currentModelId !== modelId) {
        throw new Error('Indexación cancelada o reemplazada por una nueva solicitud.');
      }
    };

    for (let i = 0; i < chunks.length; i++) {
      assertJobCurrent();

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

      // Generar nuevo embedding con prefijo passage, ligado al modelo del trabajo
      const vector = await this.embedTextForModel(modelId, chunk.text, false);

      assertJobCurrent();

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
    // Invalida cualquier carga en vuelo: sus continuaciones se vuelven no-ops y
    // la instancia que pudiera crear se libera como huérfana.
    this.loadSessionId++;
    this.loadPromise = null;

    this.status = 'unloading';
    this.notify();

    const pipe = this.pipelineInstance;
    this.pipelineInstance = null;
    await this.disposePipeline(pipe);

    this.currentModelId = null;
    this.backend = 'none';
    this.status = 'idle';
    this.progress = { progress: 0, text: '' };
    this.lastError = null;
    this.notify();
  }
}

export const localEmbeddingEngine = new LocalEmbeddingEngine();
