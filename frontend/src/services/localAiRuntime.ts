import { localLlmEngine } from '../lib/localLlm/engine.ts';
import { localEmbeddingEngine } from '../lib/localEmbeddings/engine.ts';
import { detectWebGPUCapability, type WebGPUCapabilityReport } from '../lib/localLlm/capabilities.ts';
import { selectRuntimeProfile } from '../lib/localLlm/selection.ts';
import { getLocalModelById, type LocalModelDefinition } from '../lib/localLlm/registry.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../lib/localEmbeddings/registry.ts';
import { dao } from '../db/dao.ts';
import { createSemanticChunksFromResourcesAsync, type SemanticChunk } from '../lib/localEmbeddings/chunking.ts';

/**
 * CrossedArts — Runtime de IA local con preparación automática.
 *
 * Capa mínima de coordinación que orquesta los motores existentes
 * (`localLlmEngine`, `localEmbeddingEngine`) sin reemplazarlos ni introducir un
 * store global. El usuario expresa intención (abrir el tutor, preguntar,
 * explicar, generar material) y este runtime decide y prepara todo lo necesario.
 *
 * Garantías:
 *  - una sola preparación en vuelo por recurso (promesas compartidas);
 *  - límites de proveedor explícitos: `demo`/`ollama`/`openai` NUNCA cargan WebLLM;
 *  - consentimiento de primera descarga único y persistente (nunca de secretos);
 *  - degradación honesta: si la preparación falla, se informa un estado accionable.
 */

export type LocalProviderId = 'demo' | 'local' | 'ollama' | 'openai';

export type LocalAiStage =
  | 'idle'
  | 'unsupported'
  | 'consent-required'
  | 'preparing'
  | 'downloading'
  | 'compiling'
  | 'ready'
  | 'error';

export type LocalAiErrorCategory =
  | 'unsupported-browser'
  | 'download-failed'
  | 'initialization-failed'
  | 'insufficient-resources'
  | 'semantic-unavailable'
  | 'indexing-failed'
  | 'offline-uncached';

export interface LocalAiStatus {
  stage: LocalAiStage;
  progress: number;
  message: string;
  modelId?: string;
  modelName?: string;
  downloadSize?: string;
  errorCategory?: LocalAiErrorCategory;
  errorAction?: string;
}

export type SemanticStage = 'idle' | 'preparing' | 'indexing' | 'ready' | 'error';

export interface SemanticStatus {
  stage: SemanticStage;
  progress: number;
  message: string;
  indexed: number;
  total: number;
  errorCategory?: LocalAiErrorCategory;
}

interface LoadingProgress {
  progress: number;
  text: string;
}

export interface LocalAiStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LocalAiRuntimeDeps {
  llmEngine: {
    getStatus(): string;
    getLoadedModelId(): string | null;
    loadModel(id: string, onProgress?: (p: LoadingProgress) => void): Promise<void>;
  };
  embeddingEngine: {
    getStatus(): string;
    getLoadedModelId(): string | null;
    loadModel(id?: string): Promise<void>;
    indexChunks(chunks: SemanticChunk[], onProgress?: (indexed: number, total: number) => void): Promise<number>;
    cancelIndexing(): void;
  };
  detectCapabilities: () => Promise<WebGPUCapabilityReport>;
  isOnline: () => boolean;
  isBrowser: () => boolean;
  storage: LocalAiStorage;
  loadResources: () => Promise<any>;
  buildChunks: (resources: any) => Promise<SemanticChunk[]>;
  getModelDefinition: (id: string) => LocalModelDefinition | undefined;
}

export const LOCAL_AI_CONSENT_KEY = 'crossedarts_local_ai_consent';
export const LOCAL_AI_CACHED_MODEL_KEY = 'crossedarts_local_ai_cached_model';

const INITIAL_LLM_STATUS: LocalAiStatus = {
  stage: 'idle',
  progress: 0,
  message: 'IA local en reposo'
};

const INITIAL_SEMANTIC_STATUS: SemanticStatus = {
  stage: 'idle',
  progress: 0,
  message: 'Búsqueda semántica en reposo',
  indexed: 0,
  total: 0
};

function createMemoryStorage(): LocalAiStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key)
  };
}

function createDefaultStorage(): LocalAiStorage {
  if (typeof localStorage !== 'undefined') {
    return {
      getItem: (key) => {
        try { return localStorage.getItem(key); } catch { return null; }
      },
      setItem: (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* almacenamiento no disponible */ }
      },
      removeItem: (key) => {
        try { localStorage.removeItem(key); } catch { /* almacenamiento no disponible */ }
      }
    };
  }
  return createMemoryStorage();
}

function categorizeLlmError(err: any): Pick<LocalAiStatus, 'errorCategory' | 'errorAction'> {
  const raw = String(err?.message || err || '').toLowerCase();
  if (raw.includes('webgpu') || raw.includes('adapter') || raw.includes('unsupported')) {
    return {
      errorCategory: 'unsupported-browser',
      errorAction: 'Puedes seguir usando el modo demostración o conectar Ollama.'
    };
  }
  if (raw.includes('device lost') || raw.includes('out of memory') || raw.includes('memory')) {
    return {
      errorCategory: 'insufficient-resources',
      errorAction: 'Cierra otras pestañas pesadas e inténtalo de nuevo.'
    };
  }
  if (raw.includes('fetch') || raw.includes('network') || raw.includes('failed to load') || raw.includes('offline')) {
    return {
      errorCategory: 'offline-uncached',
      errorAction: 'Conéctate una vez para completar la descarga.'
    };
  }
  return {
    errorCategory: 'initialization-failed',
    errorAction: 'Vuelve a intentarlo cuando quieras; tus datos no se han modificado.'
  };
}

function stageFromProgress(progress: LoadingProgress): Pick<LocalAiStatus, 'stage' | 'message'> {
  const text = (progress.text || '').toLowerCase();
  if (text.includes('fetch') || text.includes('descarg') || text.includes('download')) {
    return { stage: 'downloading', message: `Descargando recursos… ${progress.progress}%` };
  }
  if (text.includes('compil') || text.includes('shader') || text.includes('wasm')) {
    return { stage: 'compiling', message: 'Compilando…' };
  }
  return { stage: 'preparing', message: 'Preparando tu IA…' };
}

export class LocalAiRuntime {
  private deps: LocalAiRuntimeDeps;
  private llmStatus: LocalAiStatus = { ...INITIAL_LLM_STATUS };
  private semanticStatus: SemanticStatus = { ...INITIAL_SEMANTIC_STATUS };
  private llmListeners: Set<(status: LocalAiStatus) => void> = new Set();
  private semanticListeners: Set<(status: SemanticStatus) => void> = new Set();
  private inFlightLlm: Promise<LocalAiStatus> | null = null;
  private inFlightSemantic: Promise<SemanticStatus> | null = null;

  constructor(deps: LocalAiRuntimeDeps) {
    this.deps = deps;
  }

  /* ------------------------------------------------------------------ */
  /* Estado                                                              */
  /* ------------------------------------------------------------------ */

  public getStatus(): LocalAiStatus {
    return this.llmStatus;
  }

  public getSemanticStatus(): SemanticStatus {
    return this.semanticStatus;
  }

  public subscribe(listener: (status: LocalAiStatus) => void): () => void {
    this.llmListeners.add(listener);
    listener(this.llmStatus);
    return () => void this.llmListeners.delete(listener);
  }

  public subscribeSemantic(listener: (status: SemanticStatus) => void): () => void {
    this.semanticListeners.add(listener);
    listener(this.semanticStatus);
    return () => void this.semanticListeners.delete(listener);
  }

  private setLlmStatus(next: Partial<LocalAiStatus>): LocalAiStatus {
    this.llmStatus = { ...this.llmStatus, ...next };
    for (const listener of this.llmListeners) {
      try { listener(this.llmStatus); } catch { /* listener aislado */ }
    }
    return this.llmStatus;
  }

  private setSemanticStatus(next: Partial<SemanticStatus>): SemanticStatus {
    this.semanticStatus = { ...this.semanticStatus, ...next };
    for (const listener of this.semanticListeners) {
      try { listener(this.semanticStatus); } catch { /* listener aislado */ }
    }
    return this.semanticStatus;
  }

  /* ------------------------------------------------------------------ */
  /* Consentimiento de primera descarga (preferencia, nunca secretos)    */
  /* ------------------------------------------------------------------ */

  public hasConsent(): boolean {
    try { return this.deps.storage.getItem(LOCAL_AI_CONSENT_KEY) === 'granted'; } catch { return false; }
  }

  public grantConsent(): void {
    try { this.deps.storage.setItem(LOCAL_AI_CONSENT_KEY, 'granted'); } catch { /* no persistible */ }
  }

  public revokeConsent(): void {
    try { this.deps.storage.removeItem(LOCAL_AI_CONSENT_KEY); } catch { /* no persistible */ }
  }

  private getCachedModelId(): string | null {
    try { return this.deps.storage.getItem(LOCAL_AI_CACHED_MODEL_KEY); } catch { return null; }
  }

  private markModelCached(modelId: string): void {
    try { this.deps.storage.setItem(LOCAL_AI_CACHED_MODEL_KEY, modelId); } catch { /* no persistible */ }
  }

  /* ------------------------------------------------------------------ */
  /* Preparación del LLM local (solo proveedor `local`)                  */
  /* ------------------------------------------------------------------ */

  public async ensureLocalAiReady(options?: {
    provider?: LocalProviderId;
    overrideModelId?: string;
  }): Promise<LocalAiStatus> {
    const provider = options?.provider ?? 'local';
    // Los demás proveedores NUNCA cargan WebLLM.
    if (provider !== 'local') return this.llmStatus;

    // Reutilizar un motor ya cargado: no se recarga entre acciones consecutivas.
    if (this.deps.llmEngine.getStatus() === 'ready') {
      const loadedId = this.deps.llmEngine.getLoadedModelId();
      return this.setLlmStatus({
        stage: 'ready',
        progress: 100,
        message: 'Listo',
        modelId: loadedId ?? undefined,
        modelName: loadedId ? this.deps.getModelDefinition(loadedId)?.name : undefined
      });
    }

    if (this.inFlightLlm) return this.inFlightLlm;

    this.inFlightLlm = this.prepareLlm(options)
      .catch((err: any) => this.setLlmStatus({
        stage: 'error',
        progress: 0,
        message: err?.message || 'No se pudo preparar la IA local.',
        ...categorizeLlmError(err)
      }))
      .finally(() => { this.inFlightLlm = null; });

    return this.inFlightLlm;
  }

  private async prepareLlm(options?: { overrideModelId?: string }): Promise<LocalAiStatus> {
    this.setLlmStatus({ stage: 'preparing', progress: 0, message: 'Preparando tu IA…', errorCategory: undefined, errorAction: undefined });

    const cap = await this.deps.detectCapabilities();
    if (cap.state !== 'supported') {
      return this.setLlmStatus({
        stage: 'unsupported',
        progress: 0,
        message: 'La IA local no está disponible en este dispositivo.',
        errorCategory: 'unsupported-browser',
        errorAction: 'Puedes seguir usando el modo demostración o conectar Ollama.'
      });
    }

    const profile = selectRuntimeProfile({
      webgpu: 'supported',
      supportedFeatures: cap.supportedFeatures ?? null,
      deviceTier: cap.deviceTier ?? 'unknown'
    });

    // El override explícito (solo avanzado) se respeta si es compatible con las
    // features conocidas; si no, se cae a la selección automática segura.
    const overrideCandidate = options?.overrideModelId ? this.deps.getModelDefinition(options.overrideModelId) : undefined;
    const overrideCompatible = overrideCandidate && (!overrideCandidate.requiredFeatures?.length
      || (cap.supportedFeatures ?? []).some((f) => overrideCandidate.requiredFeatures!.includes(f)));
    const model = (overrideCompatible ? overrideCandidate : undefined) ?? profile?.model;

    if (!model) {
      return this.setLlmStatus({
        stage: 'unsupported',
        progress: 0,
        message: 'La IA local no está disponible en este dispositivo.',
        errorCategory: 'unsupported-browser',
        errorAction: 'Puedes seguir usando el modo demostración o conectar Ollama.'
      });
    }

    // Consentimiento de primera descarga: sin él no se descarga nada.
    if (!this.hasConsent()) {
      return this.setLlmStatus({
        stage: 'consent-required',
        progress: 0,
        message: `Para activar la IA local necesitamos descargar aproximadamente ${model.downloadSizeApprox}. Después podrás usarla sin conexión.`,
        modelId: model.id,
        modelName: model.name,
        downloadSize: model.downloadSizeApprox
      });
    }

    // Sin conexión y sin registro de caché previo: no se intenta una descarga inútil.
    if (!this.deps.isOnline() && this.getCachedModelId() !== model.id) {
      return this.setLlmStatus({
        stage: 'error',
        progress: 0,
        message: 'La IA local todavía no está disponible sin conexión.',
        modelId: model.id,
        modelName: model.name,
        errorCategory: 'offline-uncached',
        errorAction: 'Conéctate una vez para prepararla y después podrás usarla sin conexión.'
      });
    }

    this.setLlmStatus({ stage: 'preparing', progress: 0, message: 'Preparando tu IA…', modelId: model.id, modelName: model.name });

    await this.deps.llmEngine.loadModel(model.id, (progress) => {
      const mapped = stageFromProgress(progress);
      this.setLlmStatus({
        stage: mapped.stage,
        progress: Math.max(0, Math.min(100, progress.progress || 0)),
        message: mapped.message,
        modelId: model.id,
        modelName: model.name
      });
    });

    this.markModelCached(model.id);
    return this.setLlmStatus({
      stage: 'ready',
      progress: 100,
      message: 'Listo',
      modelId: model.id,
      modelName: model.name,
      errorCategory: undefined,
      errorAction: undefined
    });
  }

  /**
   * Punto de entrada desde el tutor y las acciones de IA. Proveedor-aware:
   * solo prepara para `local`.
   */
  public async prepareForTutor(provider: LocalProviderId, overrideModelId?: string): Promise<LocalAiStatus> {
    return this.ensureLocalAiReady({ provider, overrideModelId });
  }

  /* ------------------------------------------------------------------ */
  /* Preparación automática de embeddings / índice semántico             */
  /* ------------------------------------------------------------------ */

  public async ensureSemanticIndexReady(): Promise<SemanticStatus> {
    // La preparación semántica puede requerir descargar el modelo de embeddings.
    // No se inicia ningún recurso nuevo hasta que el usuario haya aceptado la
    // activación de la IA local.
    if (!this.hasConsent()) {
      return this.setSemanticStatus({
        stage: 'idle',
        progress: 0,
        indexed: 0,
        total: 0,
        message: 'La búsqueda semántica se preparará al activar la IA local.',
        errorCategory: undefined
      });
    }

    if (this.inFlightSemantic) return this.inFlightSemantic;

    this.inFlightSemantic = this.prepareSemantic()
      .catch((err: any) => this.setSemanticStatus({
        stage: 'error',
        message: 'No se pudo preparar la búsqueda semántica.',
        errorCategory: 'indexing-failed'
      }))
      .finally(() => { this.inFlightSemantic = null; });

    return this.inFlightSemantic;
  }

  private async prepareSemantic(): Promise<SemanticStatus> {
    // En entornos sin navegador (p. ej. tests) no se descarga nada.
    if (!this.deps.isBrowser()) {
      return this.setSemanticStatus({
        stage: 'error',
        message: 'La búsqueda semántica no está disponible en este entorno.',
        errorCategory: 'semantic-unavailable'
      });
    }

    try {
      if (this.deps.embeddingEngine.getStatus() !== 'ready') {
        this.setSemanticStatus({ stage: 'preparing', progress: 0, message: 'Preparando búsqueda…' });
        await this.deps.embeddingEngine.loadModel(DEFAULT_EMBEDDING_MODEL_ID);
      }

      this.setSemanticStatus({ stage: 'indexing', progress: 0, message: 'Preparando búsqueda…' });
      const resources = await this.deps.loadResources();
      const chunks = await this.deps.buildChunks(resources);
      const total = chunks.length;

      await this.deps.embeddingEngine.indexChunks(chunks, (indexed, count) => {
        const safeTotal = count || total;
        this.setSemanticStatus({
          stage: 'indexing',
          indexed,
          total: safeTotal,
          progress: safeTotal > 0 ? Math.round((indexed / safeTotal) * 100) : 0,
          message: 'Preparando búsqueda…'
        });
      });

      return this.setSemanticStatus({ stage: 'ready', progress: 100, indexed: total, total, message: 'Búsqueda semántica lista' });
    } catch (err: any) {
      return this.setSemanticStatus({
        stage: 'error',
        message: 'No se pudo preparar la búsqueda semántica.',
        errorCategory: 'indexing-failed'
      });
    }
  }

  /**
   * Indexación en segundo plano tras importar contenido. Nunca lanza: si falla,
   * la recuperación léxica sigue funcionando.
   */
  public scheduleIndexing(): void {
    void this.ensureSemanticIndexReady().catch(() => { /* degradación silenciosa y segura */ });
  }

  public cancelIndexing(): void {
    this.deps.embeddingEngine.cancelIndexing();
  }
}

/* -------------------------------------------------------------------------- */
/* Instancia por defecto cableada a los motores reales                        */
/* -------------------------------------------------------------------------- */

export const localAiRuntime = new LocalAiRuntime({
  llmEngine: localLlmEngine,
  embeddingEngine: localEmbeddingEngine,
  detectCapabilities: detectWebGPUCapability,
  isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
  isBrowser: () => typeof window !== 'undefined',
  storage: createDefaultStorage(),
  loadResources: () => dao.getAllLearningResources(),
  buildChunks: (resources) => createSemanticChunksFromResourcesAsync(resources),
  getModelDefinition: (id) => getLocalModelById(id)
});
