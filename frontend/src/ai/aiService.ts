import { localLlmEngine } from '../lib/localLlm/engine.ts';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/localLlm/registry.ts';
import { buildAssistantPrompt, buildExplainPrompt, buildSummarizePrompt } from '../lib/localLlm/prompts.ts';
import { retrieveLocalContext } from '../lib/localRag/retrieval.ts';
import type { RetrievalScope, RetrievedDocument } from '../lib/localRag/retrieval.ts';
import { buildRagContext, type RagSourceCitation } from '../lib/localRag/contextBuilder.ts';
import { localAiRuntime } from '../services/localAiRuntime.ts';
import { validateAntiHallucination } from '../lib/localLlm/validators.ts';

export type AIProvider = 'demo' | 'local' | 'ollama' | 'openai';

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AISettings {
  provider: AIProvider;
  ollamaUrl: string;
  ollamaModel: string;
  /**
   * Clave de OpenAI. Se mantiene SOLO EN MEMORIA por defecto (ver
   * `saveSettings`): no se escribe en `localStorage` salvo que el usuario lo
   * active explícitamente con `persistApiKey`.
   */
  apiKey: string;
  apiModel: string;
  localModelId: string;
  localAiEnabled: boolean;
  /**
   * Opt-in explícito para guardar la clave de OpenAI en `localStorage`.
   * Por defecto es `false`. Ver la nota de seguridad de `saveSettings`.
   */
  persistApiKey?: boolean;
}

export interface AssistantResponse {
  answer: string;
  sources: string[];
  providerUsed: AIProvider;
  isLocalOnDevice: boolean;
  retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
  /**
   * Citas estructuradas de las fuentes REALMENTE recuperadas para esta
   * respuesta. Lista vacía (no ausente) cuando la respuesta no se apoyó en
   * material recuperado: la UI lo distingue de "sin información".
   */
  citations?: RagSourceCitation[];
  /** Modelo o mecanismo concreto que generó la respuesta. */
  modelUsed?: string;
  /**
   * Falso cuando el contexto recuperado se apoya solo en coincidencias débiles
   * de título/metadatos: la respuesta no debe presentarse como sólidamente
   * fundamentada aunque haya citas.
   */
  hasSubstantiveContext?: boolean;
  /**
   * `true` cuando la barrera final anti-alucinación sustituyó la respuesta por un
   * mensaje controlado. La UI puede mostrarlo como aviso en lugar de respuesta.
   */
  groundedAnswerRejected?: boolean;
}

/**
 * Opciones de generación que evitan recuperaciones innecesarias o no deseadas.
 */
export interface AskTutorOptions {
  /**
   * Contexto YA recuperado por el llamador. Cuando se aporta, la generación usa
   * exactamente esas fuentes y sus citas: NO se vuelve a recuperar, de modo que
   * el ranking no puede cambiar entre la primera y la segunda búsqueda y las
   * citas corresponden con precisión al contexto suministrado al modelo.
   */
  prebuiltContext?: {
    documents: RetrievedDocument[];
    retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
    hasSubstantiveContext?: boolean;
    totalCandidates?: number;
    diversifiedCandidates?: number;
  };
  /**
   * Desactiva por completo la recuperación RAG. Se usa cuando la fuente
   * autoritativa es el propio texto del llamador (p. ej. resumir un texto) y una
   * búsqueda global contaminaría la respuesta con material ajeno.
   */
  disableRetrieval?: boolean;
}

/** Descripción honesta del modelo que produjo una respuesta de un proveedor. */
function describeModelForProvider(provider: AIProvider): string {
  const settings = aiService.getSettings();
  switch (provider) {
    case 'local':
      return localLlmEngine.getLoadedModelId() || settings.localModelId || 'modelo local';
    case 'ollama':
      return settings.ollamaModel;
    case 'openai':
      return settings.apiModel;
    case 'demo':
    default:
      return 'demo local';
  }
}

/** Construye un ámbito de recuperación solo cuando hay al menos un ancla válida. */
function buildRetrievalScope(resourceId?: string, lessonId?: string): RetrievalScope | undefined {
  if (!resourceId && !lessonId) return undefined;
  return { resourceId, lessonId };
}

/**
 * Aplica la barrera final de fundamentación a una respuesta conversacional.
 *
 * Determinista y sin dependencies: el mismo texto con el mismo contexto produce
 * siempre el mismo veredicto. Devuelve una respuesta nueva; no muta la entrada.
 */
function applyResponseGroundingGate(
  response: AssistantResponse,
  input: {
    hasContext: boolean;
    hasSubstantiveContext: boolean;
    sourceTitles: string[];
  }
): AssistantResponse {
  const verdict = validateAntiHallucination(response.answer, input.hasContext, {
    hasSubstantiveContext: response.hasSubstantiveContext ?? input.hasSubstantiveContext,
    availableSourceTitles: input.sourceTitles
  });

  if (verdict.text === response.answer && !verdict.reason) {
    return response;
  }

  return {
    ...response,
    answer: verdict.text,
    // Una respuesta sustituida no sostiene las citas que el modelo pudo haber
    // inventado: se vacían para que la UI no las presente como respaldo.
    sources: verdict.passed ? response.sources : [],
    citations: verdict.passed ? response.citations : [],
    groundedAnswerRejected: !verdict.passed
  };
}

const DEFAULT_SETTINGS: AISettings = {
  provider: 'demo',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3:8b',
  apiKey: '',
  apiModel: 'gpt-4o-mini',
  localModelId: DEFAULT_LOCAL_MODEL_ID,
  localAiEnabled: false,
  persistApiKey: false
};

/**
 * Clave de OpenAI en memoria (nunca por defecto en almacenamiento).
 *
 * Una aplicación puramente de cliente no tiene almacenamiento seguro de
 * secretos: cualquier script que se ejecute en el origen puede leer tanto
 * `localStorage` como la memoria. No se finge que cifrar en el cliente lo haga
 * seguro frente a XSS; por eso la opción por defecto es no persistir la clave.
 */
let inMemoryApiKey = '';

/** Ajustes completos tal como los usa el resto del servicio (clave incluida). */
let inMemorySettings: AISettings | null = null;

const STORAGE_KEY = 'crossedarts_ai_settings';

const settingsListeners = new Set<(settings: AISettings) => void>();

export const aiService = {
  subscribeSettings(listener: (settings: AISettings) => void): () => void {
    settingsListeners.add(listener);
    listener(this.getSettings());
    return () => void settingsListeners.delete(listener);
  },

  getSettings(): AISettings {
    try {
      if (typeof localStorage === 'undefined') {
        return inMemorySettings || { ...DEFAULT_SETTINGS, apiKey: inMemoryApiKey };
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      const persisted = saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : { ...DEFAULT_SETTINGS };
      // La clave solo se recupera del almacenamiento si el usuario lo aceptó.
      const key = persisted.persistApiKey ? (persisted.apiKey || '') : inMemoryApiKey;
      return { ...persisted, apiKey: key };
    } catch {
      return { ...DEFAULT_SETTINGS, apiKey: inMemoryApiKey };
    }
  },

  /**
   * Guarda la configuración de IA.
   *
   * La clave de OpenAI se conserva en memoria salvo que `persistApiKey` sea
   * `true`. Cuando es `true` se escribe en `localStorage` sin cifrar: es una
   * decisión informada del usuario y la interfaz lo advierte de forma explícita,
   * porque el almacenamiento del navegador NO es un almacén seguro de secretos.
   *
   * Si el proveedor deja de ser `openai`, la clave se descarta: no queda
   * zombi lista para usarse por accidente.
   */
  saveSettings(settings: AISettings) {
    const persist = settings.persistApiKey === true;
    const providerIsOpenAI = settings.provider === 'openai';
    // La clave solo sobrevive si el proveedor sigue siendo OpenAI.
    inMemoryApiKey = providerIsOpenAI && settings.apiKey ? settings.apiKey : '';

    if (typeof localStorage === 'undefined') {
      inMemorySettings = { ...settings, apiKey: inMemoryApiKey };
      for (const listener of settingsListeners) {
        try { listener(inMemorySettings); } catch {}
      }
      return;
    }

    // Nunca se escribe la clave en el payload persistido salvo opt-in explícito.
    const payload: AISettings = {
      ...settings,
      apiKey: persist ? (providerIsOpenAI ? settings.apiKey || '' : '') : '',
      persistApiKey: persist
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    const current = this.getSettings();
    for (const listener of settingsListeners) {
      try { listener(current); } catch {}
    }
  },

  /** Descarta la clave de OpenAI de la memoria y del almacenamiento. */
  clearApiKey(): void {
    inMemoryApiKey = '';
    if (typeof localStorage !== 'undefined') {
      try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...parsed, apiKey: '', persistApiKey: false }));
        }
      } catch {
        /* almacenamiento no disponible: la clave en memoria ya está borrada */
      }
    }
  },

  /**
   * Responde a una consulta pedagógica usando RAG local + proveedor configurado.
   * Si el proveedor es 'local', garantiza que la inferencia se ejecute 100% en el dispositivo con WebLLM
   * sin llamadas a APIs externas.
   */
  async askTutor(
    messages: AIChatMessage[],
    contextInfo: string = '',
    onChunk?: (token: string) => void,
    scope?: RetrievalScope,
    options?: AskTutorOptions
  ): Promise<AssistantResponse> {
    const response = await this.askTutorCore(messages, contextInfo, onChunk, scope, options);
    return {
      ...response,
      // Toda respuesta final expone SUS citas (vacías si no hubo contexto
      // recuperado) y el modelo que la generó: la UI distingue fuente
      // recuperada, respuesta generada y proveedor sin ambigüedad.
      citations: response.citations ?? [],
      modelUsed: response.modelUsed ?? describeModelForProvider(response.providerUsed)
    };
  },

  /** Implementación interna de `askTutor` (envuelta para enriquecer la respuesta). */
  async askTutorCore(
    messages: AIChatMessage[],
    contextInfo: string = '',
    onChunk?: (token: string) => void,
    scope?: RetrievalScope,
    options?: AskTutorOptions
  ): Promise<AssistantResponse> {
    const settings = this.getSettings();
    const lastUserQuery = messages[messages.length - 1]?.content || '';

    // 1. Recuperación RAG local (UNA sola vez por respuesta).
    //
    // Si el llamador ya recuperó el contexto (`prebuiltContext`), se usa
    // EXACTAMENTE ese material y sus citas: no hay una segunda recuperación que
    // pudiera reordenar fuentes ni romper la correspondencia cita-contexto.
    // `disableRetrieval` (p. ej. resumir un texto aportado) evita por completo la
    // recuperación global. La recuperación semántica solo se prepara para el
    // proveedor local.
    let retrieval: { retrievalMode: 'hybrid' | 'lexical' | 'semantic'; hasSubstantiveContext: boolean };
    let documents: RetrievedDocument[];
    if (options?.prebuiltContext) {
      documents = options.prebuiltContext.documents;
      retrieval = {
        retrievalMode: options.prebuiltContext.retrievalMode ?? (documents.length ? 'hybrid' : 'lexical'),
        hasSubstantiveContext:
          options.prebuiltContext.hasSubstantiveContext ??
          documents.some((doc) => doc.substantive === true)
      };
    } else if (options?.disableRetrieval) {
      documents = [];
      retrieval = { retrievalMode: 'lexical', hasSubstantiveContext: false };
    } else {
      const result = await retrieveLocalContext(lastUserQuery, 3, scope, {
        semantic: settings.provider === 'local' && localAiRuntime.hasConsent()
      });
      documents = result.documents;
      retrieval = {
        retrievalMode: result.retrievalMode,
        hasSubstantiveContext: result.hasSubstantiveContext
      };
    }
    const hasSubstantiveContext = retrieval.hasSubstantiveContext;
    const rag = buildRagContext(documents);
    const combinedContext = [contextInfo, rag.formattedContextText].filter(Boolean).join('\n\n');

    const strategy = (await import('./providers/index.ts')).getProviderStrategy(settings.provider);
    const response = await strategy.execute({
      messages,
      combinedContext,
      settings,
      ragContext: rag,
      hasSubstantiveContext,
      retrievalMode: retrieval.retrievalMode,
      onChunk
    });

    // BARRERA FINAL anti-alucinación: se aplica a TODA respuesta conversacional,
    // sea cual sea el proveedor, y es determinista. Sin material visible no se
    // puede afirmar una fuente que no existe; con material débil la respuesta
    // queda marcada como no fundamentada. Las respuestas honestas que declaran
    // su propia incertidumbre se conservan intactas.
    return applyResponseGroundingGate(response, {
      // Hay contexto visible si el modelo recibió material recuperado (RAG) o el
      // texto autoritativo que aportó el propio llamante (p. ej. resumir).
      hasContext: rag.hasContext || Boolean(options?.disableRetrieval && contextInfo.trim().length > 0),
      hasSubstantiveContext,
      sourceTitles: rag.sourceTitles
    });
  },

  /**
   * Explica un concepto utilizando contexto recuperado localmente.
   *
   * Recupera UNA vez y pasa ese mismo contexto a la generación: así no hay una
   * segunda búsqueda que pudiera cambiar el ranking ni las citas.
   */
  async explainConcept(conceptName: string): Promise<string> {
    const retrieval = await retrieveLocalContext(conceptName, 2);
    const rag = buildRagContext(retrieval.documents);
    const { system, user } = buildExplainPrompt(conceptName, rag.formattedContextText);
    const response = await this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], '', undefined, undefined, {
      prebuiltContext: {
        documents: retrieval.documents,
        retrievalMode: retrieval.retrievalMode,
        hasSubstantiveContext: retrieval.hasSubstantiveContext
      }
    });
    return response.answer;
  },

  /**
   * Acción pedagógica aterrizada: Explicar un recurso o documento específico utilizando
   * exclusivamente contexto recuperado de CrossedArts con citación verificable.
   */
  async explainResource(resourceTitle: string, resourceDescription?: string, scope?: RetrievalScope): Promise<AssistantResponse> {
    const query = `${resourceTitle} ${resourceDescription || ''}`.trim();
    const retrieval = await retrieveLocalContext(query, 3, scope);

    // Si no hay contexto local suficiente, responder honestamente sin inventar
    if (!retrieval.hasContext || retrieval.documents.length === 0) {
      return {
        answer: `⚠️ El contexto local de CrossedArts no contiene suficiente información sobre "${resourceTitle}" para generar una explicación fundamentada sin inventar detalles.`,
        sources: [],
        citations: [],
        providerUsed: this.getSettings().provider,
        isLocalOnDevice: this.getSettings().provider === 'demo' || this.getSettings().provider === 'local',
        retrievalMode: retrieval.retrievalMode
      };
    }

    const rag = buildRagContext(retrieval.documents);
    const { system, user } = buildExplainPrompt(resourceTitle, rag.formattedContextText);

    // Se reutiliza EXACTAMENTE el contexto ya recuperado: la generación no
    // vuelve a buscar, por lo que el ranking y las citas no pueden divergir.
    return this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], `Recurso objetivo: ${resourceTitle}`, undefined, scope, {
      prebuiltContext: {
        documents: retrieval.documents,
        retrievalMode: retrieval.retrievalMode,
        hasSubstantiveContext: retrieval.hasSubstantiveContext
      }
    });
  },

  /**
   * Resume un texto de estudio.
   *
   * El texto aportado es la fuente AUTORITATIVA: no se realiza recuperación
   * global, porque buscar en la biblioteca sobre el texto del usuario
   * contamina el resumen con material ajeno no solicitado.
   */
  async summarizeText(text: string): Promise<string> {
    const { system, user } = buildSummarizePrompt(text);
    const response = await this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], '', undefined, undefined, { disableRetrieval: true });
    return response.answer;
  },

  /**
   * Genera tarjetas de memoria (flashcards) fundamentadas en el contenido recuperado de CrossedArts.
   */
  async generateFlashcards(
    options: import('../lib/studyGeneration/types.ts').StudyGenerationOptions
  ): Promise<{
    cards: import('../lib/studyGeneration/types.ts').GeneratedFlashcard[];
    sourceIds: string[];
    sourceTitles: string[];
    error?: string;
  }> {
    const { buildFlashcardGenerationPrompt } = await import('../lib/studyGeneration/prompts.ts');
    const { validateFlashcardBatch } = await import('../lib/studyGeneration/validators.ts');
    const { validateStructuredJson } = await import('../lib/localLlm/validators.ts');

    const count = Math.min(Math.max(options.count || 3, 3), 10);
    const difficulty = options.difficulty || 'medium';
    const query = [options.resourceTitle, options.topic].filter(Boolean).join(' ') || 'conceptos clave';

    const retrieval = await retrieveLocalContext(query, 4, buildRetrievalScope(options.resourceId, options.lessonId), {
      semantic: this.getSettings().provider === 'local' && localAiRuntime.hasConsent()
    });
    if (!retrieval.hasContext || retrieval.documents.length === 0) {
      return {
        cards: [],
        sourceIds: [],
        sourceTitles: [],
        error: 'No se encontró contexto suficiente en CrossedArts para generar tarjetas fundamentadas.'
      };
    }

    const rag = buildRagContext(retrieval.documents);
    const sourceIds = retrieval.documents.map(d => d.id);
    const contextSnippets = retrieval.documents.map(d => d.snippet);
    const { system, user } = buildFlashcardGenerationPrompt(count, difficulty, rag.formattedContextText, options.resourceTitle || options.topic);

    const settings = this.getSettings();
    let rawOutput = '';

    if (settings.provider === 'local') {
      const readiness = await localAiRuntime.ensureLocalAiReady({ provider: 'local', task: 'flashcard_generation' });
      if (readiness.stage !== 'ready') {
        return {
          cards: [],
          sourceIds,
          sourceTitles: rag.sourceTitles,
          error: readiness.stage === 'consent-required'
            ? 'Activa la IA local para generar tarjetas automáticamente.'
            : readiness.message
        };
      }
      rawOutput = await localLlmEngine.generate([
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]);
    } else if (settings.provider === 'demo') {
      // Plantillas deterministas basadas en los documentos recuperados para testing offline y demo
      const demoCards = retrieval.documents.slice(0, count).map((doc, idx) => ({
        front: `¿Qué aspecto clave define a "${doc.title}"?`,
        back: doc.snippet.length > 80 ? doc.snippet.slice(0, 80) + '...' : doc.snippet
      }));
      rawOutput = JSON.stringify({ cards: demoCards });
    } else {
      // Para ollama / openai, reutilizar askTutor internamente sin disparar una segunda recuperación RAG
      const res = await this.askTutor(
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        '',
        undefined,
        undefined,
        {
          prebuiltContext: {
            documents: retrieval.documents,
            retrievalMode: retrieval.retrievalMode,
            hasSubstantiveContext: retrieval.hasSubstantiveContext
          },
          disableRetrieval: true
        }
      );
      rawOutput = res.answer;
    }

    const validated = validateStructuredJson<{ cards: Array<{ front: string; back: string }> }>(
      rawOutput,
      (parsed) => validateFlashcardBatch(parsed, contextSnippets)
    );

    if (!validated.valid || !validated.data) {
      return {
        cards: [],
        sourceIds,
        sourceTitles: rag.sourceTitles,
        error: validated.error || 'Fallo de validación de estructura o fundamentación en las tarjetas generadas.'
      };
    }

    const validatedCards = (validated.data as any).cards || (Array.isArray(validated.data) ? validated.data : []);
    const resultCards: import('../lib/studyGeneration/types.ts').GeneratedFlashcard[] = validatedCards.map((c: any, i: number) => ({
      id: `gen_fc_${Date.now()}_${i}`,
      front: c.front,
      back: c.back,
      sourceIds,
      sourceTitles: rag.sourceTitles,
      difficulty,
      resourceId: options.resourceId
    }));

    return {
      cards: resultCards,
      sourceIds,
      sourceTitles: rag.sourceTitles
    };
  },

  /**
   * Genera preguntas de práctica tipo test (opción múltiple) fundamentadas en el contenido recuperado.
   */
  async generatePracticeQuestions(
    options: import('../lib/studyGeneration/types.ts').StudyGenerationOptions
  ): Promise<{
    questions: import('../lib/studyGeneration/types.ts').GeneratedQuestion[];
    sourceIds: string[];
    sourceTitles: string[];
    error?: string;
  }> {
    const { buildQuestionsGenerationPrompt } = await import('../lib/studyGeneration/prompts.ts');
    const { validateQuestionBatch } = await import('../lib/studyGeneration/validators.ts');
    const { validateStructuredJson } = await import('../lib/localLlm/validators.ts');

    const count = Math.min(Math.max(options.count || 3, 3), 10);
    const difficulty = options.difficulty || 'medium';
    const query = [options.resourceTitle, options.topic].filter(Boolean).join(' ') || 'conceptos clave';

    const retrieval = await retrieveLocalContext(query, 4, buildRetrievalScope(options.resourceId, options.lessonId), {
      semantic: this.getSettings().provider === 'local' && localAiRuntime.hasConsent()
    });
    if (!retrieval.hasContext || retrieval.documents.length === 0) {
      return {
        questions: [],
        sourceIds: [],
        sourceTitles: [],
        error: 'No se encontró contexto suficiente en CrossedArts para generar preguntas fundamentadas.'
      };
    }

    const rag = buildRagContext(retrieval.documents);
    const sourceIds = retrieval.documents.map(d => d.id);
    const contextSnippets = retrieval.documents.map(d => d.snippet);
    const { system, user } = buildQuestionsGenerationPrompt(count, difficulty, rag.formattedContextText, options.resourceTitle || options.topic);

    const settings = this.getSettings();
    let rawOutput = '';

    if (settings.provider === 'local') {
      const readiness = await localAiRuntime.ensureLocalAiReady({ provider: 'local', task: 'question_generation' });
      if (readiness.stage !== 'ready') {
        return {
          questions: [],
          sourceIds,
          sourceTitles: rag.sourceTitles,
          error: readiness.stage === 'consent-required'
            ? 'Activa la IA local para generar preguntas automáticamente.'
            : readiness.message
        };
      }
      rawOutput = await localLlmEngine.generate([
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]);
    } else if (settings.provider === 'demo') {
      // Generación determinista para modo demo y tests offline
      const demoQuestions = retrieval.documents.slice(0, count).map((doc, idx) => ({
        question: `Respecto a "${doc.title}", ¿cuál de las siguientes afirmaciones se deriva directamente del texto?`,
        options: [
          `Describe: ${doc.snippet.slice(0, 50)}...`,
          `Es un concepto completamente ajeno a este material de estudio.`,
          `Invalida la arquitectura del sistema sin justificación.`,
          `Fue descartado en las versiones iniciales.`
        ],
        correctIndex: 0,
        explanation: `Afirmación respaldada por la fuente: ${doc.title}.`
      }));
      rawOutput = JSON.stringify({ questions: demoQuestions });
    } else {
      const res = await this.askTutor(
        [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        '',
        undefined,
        undefined,
        {
          prebuiltContext: {
            documents: retrieval.documents,
            retrievalMode: retrieval.retrievalMode,
            hasSubstantiveContext: retrieval.hasSubstantiveContext
          },
          disableRetrieval: true
        }
      );
      rawOutput = res.answer;
    }

    const validated = validateStructuredJson<{ questions: Array<any> }>(
      rawOutput,
      (parsed) => validateQuestionBatch(parsed, contextSnippets)
    );

    if (!validated.valid || !validated.data) {
      return {
        questions: [],
        sourceIds,
        sourceTitles: rag.sourceTitles,
        error: validated.error || 'Fallo de validación de estructura o fundamentación en las preguntas generadas.'
      };
    }

    const validatedQuestions = (validated.data as any).questions || (Array.isArray(validated.data) ? validated.data : []);
    const resultQuestions: import('../lib/studyGeneration/types.ts').GeneratedQuestion[] = validatedQuestions.map((q: any, i: number) => ({
      id: `gen_q_${Date.now()}_${i}`,
      question: q.question,
      options: q.options,
      correctIndex: q.correctIndex,
      explanation: q.explanation,
      sourceIds,
      sourceTitles: rag.sourceTitles,
      difficulty
    }));

    return {
      questions: resultQuestions,
      sourceIds,
      sourceTitles: rag.sourceTitles
    };
  }
};
