import { DEFAULT_EMBEDDING_MODEL_ID, getEmbeddingModelById, type EmbeddingModelDefinition } from './registry.ts';
import {
  detectEmbeddingCapabilities,
  type EmbeddingCapabilitiesReport,
  type EmbeddingRuntimeBackend
} from './capabilities.ts';
import { isWebGpuFatalError } from '../localLlm/capabilities.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION, expectedDimensionsForModel } from './cache.ts';
import { configureOnnxRuntimeWasm } from './ortRuntime.ts';
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

export function vectorNorm(v: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < v.length; i++) {
    sumSq += v[i] * v[i];
  }
  return Math.sqrt(sumSq);
}

/**
 * L2-normalizes a vector. Throws on non-finite values or a zero norm.
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
 * Norms memoized per vector OBJECT.
 *
 * Cached entry vectors are stable objects reused across queries, so their norm
 * is computed once instead of on every comparison. A `WeakMap` never keeps a
 * vector alive on its own.
 */
const VECTOR_NORMS = new WeakMap<object, number>();

function memoizedNorm(v: number[]): number {
  const cached = VECTOR_NORMS.get(v);
  if (cached !== undefined) return cached;
  const norm = vectorNorm(v);
  VECTOR_NORMS.set(v, norm);
  return norm;
}

/**
 * Cosine similarity. Inputs need not be pre-normalized (norms are computed
 * internally, memoized per vector object); zero-length or zero-norm inputs
 * score 0.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  const normA = memoizedNorm(a);
  const normB = memoizedNorm(b);
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
}

function stripKnownEmbeddingPrefix(text: string): string {
  return text.replace(
    /^(query:\s+|passage:\s+|task:\s+search result \| query:\s+|title:\s+none \| text:\s+)/i,
    ''
  );
}

/**
 * Thrown when an in-flight operation lost the load session that owned it
 * (`unload()` or a newer `loadModel()` completed first).
 *
 * Kept distinct from a real failure: the engine's current state — possibly a
 * healthy newer load of the same model — must NOT be flagged as 'error'.
 */
export class EmbeddingCancelledError extends Error {
  constructor(message = 'Operación de embeddings cancelada: la sesión de carga cambió.') {
    super(message);
    this.name = 'EmbeddingCancelledError';
  }
}

/** Normalized request to the embeddings engine (model, dtype, device). */
export interface EmbeddingPipelineRequest {
  modelId: string;
  dtype: NonNullable<EmbeddingModelDefinition['preferredDtype']>;
  device: 'webgpu' | 'wasm';
  onProgress: (item: any) => void;
}

/**
 * Transformers.js pipeline factory.
 *
 * Single engine injection point: the default implementation lazily imports
 * `@huggingface/transformers` and configures its local env; tests (and any
 * offline env) can swap the real model download for a deterministic double
 * without touching backend, prefix, or dimension selection logic.
 */
export type EmbeddingPipelineFactory = (request: EmbeddingPipelineRequest) => Promise<any>;

const defaultEmbeddingPipelineFactory: EmbeddingPipelineFactory = async ({ modelId, dtype, device, onProgress }) => {
  const { pipeline, env } = await import('@huggingface/transformers');

  // Local env setup: models resolve against the Hub and cache in the browser
  // (first download, then offline).
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  // The ONNX runtime itself is served from this same origin (never a CDN), and
  // thread usage is bounded by what the page can actually provide.
  //
  // `proxy` moves the CPU forward pass into ONNX Runtime's own worker: the main
  // thread keeps painting while a library is indexed. Only for `wasm` (the
  // proxy refuses non-CPU tensors) and only where a document exists.
  configureOnnxRuntimeWasm(env, {
    baseUri: typeof document !== 'undefined' ? document.baseURI : undefined,
    proxy: device === 'wasm'
  });

  return pipeline('feature-extraction', modelId, {
    dtype,
    device,
    progress_callback: onProgress
  });
};

/**
 * Resolves which device a model must load on.
 *
 * Rules, in order:
 *  1. When the registry declares `preferredBackend`, it wins whenever the env
 *     supports it (EmbeddingGemma declares `wasm` and loads on wasm even when
 *     the browser offers WebGPU).
 *  2. Without a declared preference, use the capability-detected backend.
 *  3. When `webgpu` is requested but unsupported, degrade to `wasm`.
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
   * Load-session id. Bumped on every `loadModel()` and `unload()`. Each async
   * continuation checks its session is still current before touching state, so
   * a stale load can never overwrite a newer one or revive an unloaded instance.
   */
  private loadSessionId: number = 0;
  private currentJobId: number = 0;
  private dirtyPending: boolean = false;
  /**
   * Last pipeline factory used by `loadModel`, kept so an inference-time WebGPU
   * failure can rebuild the pipeline on CPU without re-running detection.
   */
  private lastPipelineFactory: EmbeddingPipelineFactory | null = null;

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
   * Lazily loads the embeddings model via Transformers.js.
   *
   * `options` is the injection point for deterministic envs (tests): it can
   * replace capability detection and/or the pipeline factory without
   * downloading the model. Production omits it and uses defaults.
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

    // Load of the SAME model already in flight: share the promise (one download).
    if (this.loadPromise && this.currentModelId === modelId && (this.status === 'loading' || this.status === 'checking')) {
      return this.loadPromise;
    }

    const sessionId = ++this.loadSessionId;
    this.currentModelId = modelId;
    this.loadPromise = (async () => {
      this.status = 'checking';
      this.lastError = null;
      this.notify();

      let caps: EmbeddingCapabilitiesReport;
      try {
        caps = await (options?.detectCapabilities ?? detectEmbeddingCapabilities)();
      } catch (err: any) {
        if (sessionId !== this.loadSessionId) return;
        // Every terminal state stays reachable even when detection itself fails:
        // without this the engine was left at 'checking' forever, announcing a
        // model that would never load.
        this.status = 'error';
        this.lastError = err?.message || 'Error detectando las capacidades de ejecución.';
        this.currentModelId = null;
        this.notify();
        throw err;
      }
      if (sessionId !== this.loadSessionId) return; // session superseded during detection

      // `currentModelId` is what `getLoadedModelId()` reports and what the
      // vector cache and the embedding backups key on, so it is cleared on every
      // path that ends WITHOUT a usable pipeline. Reporting the requested id
      // there sent readers looking for vectors of a model that owns none.
      if (caps.state !== 'supported') {
        this.status = 'unsupported';
        this.lastError = 'Entorno sin soporte para ejecución de embeddings.';
        this.currentModelId = null;
        this.notify();
        throw new Error(this.lastError);
      }

      const modelDef = getEmbeddingModelById(modelId);
      if (!modelDef) {
        this.status = 'error';
        this.lastError = `Modelo de embedding desconocido: ${modelId}`;
        this.currentModelId = null;
        this.notify();
        throw new Error(this.lastError);
      }

      // Effective backend: honors the registry preference and only degrades
      // when the env lacks support. Fixed BEFORE creating the pipeline and
      // exposed via getBackend() for UI and tests to assert.
      const device = resolveEmbeddingDevice(modelDef, caps);
      const dtype = modelDef.preferredDtype ?? 'q8';
      const createPipeline = options?.createPipeline ?? defaultEmbeddingPipelineFactory;
      this.lastPipelineFactory = createPipeline;
      // Stale-session callbacks are fully ignored: they cannot overwrite the
      // progress or state of a newer load.
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

      // Two pipelines never coexist: the previous one is disposed before replacing.
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
          // Retry only when the FAILED attempt ran on WebGPU.
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
        // The previous pipeline was already disposed above, so nothing is
        // loaded: the id must not survive as a phantom identity for the cache.
        this.currentModelId = null;
        this.notify();
        throw err;
      }

      // Session superseded while the model downloaded: the freshly created
      // instance is disposed and NEVER published as active.
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
      // Only the current session clears the shared pointer.
      if (sessionId === this.loadSessionId) {
        this.loadPromise = null;
      }
    }
  }

  /**
   * Safely disposes a pipeline: never throws and accepts `null`.
   *
   * The only routine used to tear down instances (model replacement, stale
   * session, `unload()`), so native-instance lifecycle lives in one place.
   */
  private async disposePipeline(pipe: any): Promise<void> {
    if (!pipe || typeof pipe.dispose !== 'function') return;
    try {
      await pipe.dispose();
    } catch {
      /* dispose must never mask the operation result */
    }
  }

  /**
   * Runs one forward pass, degrading WebGPU -> CPU/WASM ONCE when the device
   * itself fails (shader validation, lost device, GPU memory).
   *
   * Creating the pipeline successfully does not guarantee it can run: drivers
   * routinely reject the compute shader only at the first dispatch. Without this
   * retry the embedding engine stayed unusable until the person changed models
   * by hand. The backend reported by `getBackend()` always reflects what really
   * ran.
   */
  private async runPipeline(input: string, modelId: string): Promise<any> {
    // The pipeline belongs to the load session that created it: an `unload()`
    // or a newer `loadModel()` interleaved with a slow CPU fallback must win.
    const sessionId = this.loadSessionId;
    try {
      return await this.pipelineInstance(input, { pooling: 'mean', normalize: false });
    } catch (err) {
      if (this.backend !== 'webgpu' || !isWebGpuFatalError(err) || !this.lastPipelineFactory) {
        throw err;
      }
      if (sessionId !== this.loadSessionId) throw new EmbeddingCancelledError();
      console.warn('Inferencia de embeddings en WebGPU falló; se reintenta en CPU/WASM:', err);

      // Detached BEFORE the await: a superseding load installs its own instance
      // meanwhile, and it must never be disposed on this one's behalf.
      const failedPipeline = this.pipelineInstance;
      this.pipelineInstance = null;
      await this.disposePipeline(failedPipeline);
      if (sessionId !== this.loadSessionId) throw new EmbeddingCancelledError();

      const modelDef = getEmbeddingModelById(modelId);

      const cpuPipeline = await this.lastPipelineFactory({
        modelId,
        dtype: modelDef?.preferredDtype ?? 'q8',
        device: 'wasm',
        onProgress: () => undefined
      });

      // A fallback that resolves after the session changed is an ORPHAN: it
      // belongs to a model the cache no longer targets, so publishing it would
      // make every later vector come from the wrong pipeline while being stored
      // under the new model's identity.
      if (sessionId !== this.loadSessionId) {
        await this.disposePipeline(cpuPipeline);
        throw new EmbeddingCancelledError();
      }

      this.pipelineInstance = cpuPipeline;
      this.backend = 'wasm';
      this.notify();

      // A second failure is a real error, not a device quirk: propagate it.
      return await cpuPipeline(input, { pooling: 'mean', normalize: false });
    }
  }

  /**
   * Embeds text with the ACTIVE model.
   *
   * - Applies the model prefix (`queryPrefix`/`documentPrefix` from the
   *   registry: for EmbeddingGemma, "task: search result | query: " /
   *   "title: none | text: ").
   * - Runs unnormalized 'mean' pooling, validates native output (768d for
   *   EmbeddingGemma), truncates to the model's EFFECTIVE dimension
   *   (`outputDimension`, 256d via MRL), then L2-normalizes.
   */
  public async embedText(text: string, isQuery: boolean = true): Promise<number[]> {
    const modelId = this.currentModelId ?? DEFAULT_EMBEDDING_MODEL_ID;
    return this.embedTextForModel(modelId, text, isQuery);
  }

  /**
   * Embeds with one CONCRETE model identity.
   *
   * Fails when the active model is no longer that one, so the returned vector
   * always matches the identity the caller will cache it under. Indexing thus
   * binds to the model, not to mutable state that may change across an `await`
   * (e.g. when another `loadModel` supersedes it).
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

      const output = await this.runPipeline(formattedInput, modelId);

      const rawVector = Array.from(output.data as Float32Array | number[]);
      if (rawVector.length < modelDef.dimension) {
        throw new Error(
          `Embedding inválido: el modelo ${modelId} debería producir al menos ${modelDef.dimension} dimensiones y produjo ${rawVector.length}`
        );
      }

      const outputDimension = modelDef.outputDimension ?? modelDef.dimension;
      const truncatedVector = rawVector.slice(0, outputDimension);
      const vector = l2NormalizeVector(truncatedVector, outputDimension);

      // When a `loadModel`/`unload` switched models mid-compute, that operation
      // owns the state: this path neither reverts to 'ready' nor flags 'error'
      // on an identity that is no longer active.
      if (this.currentModelId === modelId) {
        this.status = 'ready';
        this.notify();
      }
      return vector;
    } catch (err: any) {
      // A cancelled operation belongs to a load session that no longer exists:
      // the engine's current state (possibly a healthy newer load) stays intact.
      if (err instanceof EmbeddingCancelledError) throw err;
      if (this.currentModelId === modelId) {
        this.status = 'error';
        this.lastError = err?.message || 'Error generando embedding.';
        this.notify();
      }
      throw err;
    }
  }

  /**
   * Incrementally and asynchronously indexes a chunk set via the IndexedDB cache.
   * Guards against concurrent indexing races and supports instant cancellation.
   */
  /**
   * Proactively purges vectors from non-active models/pipelines.
   *
   * Runs while preparing the semantic index: switching embedding models
   * invalidates prior entries, which previously were freed only by manual cache
   * clears. Never throws: a failed purge must not block indexing.
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

    /** A job stays current only when nothing cancelled it AND the active model is unchanged. */
    const assertJobCurrent = () => {
      if (this.currentJobId !== jobId || this.currentModelId !== modelId) {
        throw new Error('Indexación cancelada o reemplazada por una nueva solicitud.');
      }
    };

    for (let i = 0; i < chunks.length; i++) {
      assertJobCurrent();

      const chunk = chunks[i];
      // Cache identity is the (chunk, model, pipeline-version) triple: two
      // models never overwrite one chunk's vector.
      const cached = await embeddingCache.getEntry(chunk.chunkId, modelId);

      // On a hit with unchanged SHA-256 hash and matching pipeline version, reuse
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

      // Generate a fresh embedding with the passage prefix, bound to the job model
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
        updatedAt: Date.now(),
        // Provenance travels WITH the vector: fusion and scoped retrieval read
        // it from the cache entry, not from a guess based on `sourceType`.
        substantive: chunk.substantive === true,
        resourceId: chunk.resourceId,
        lessonId: chunk.lessonId
      });

      newlyIndexed++;
      if (onProgress) onProgress(i + 1, chunks.length);

      // Yield to keep the UI responsive
      await new Promise(r => setTimeout(r, 0));
    }

    return newlyIndexed;
  }

  /**
   * Unloads the model and releases resources.
   */
  public async unload(): Promise<void> {
    // Invalidates any in-flight load: its continuations become no-ops and any
    // instance it might create is disposed as orphaned.
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
