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
   * OpenAI key. Kept IN MEMORY ONLY by default (see `saveSettings`): never
   * written to `localStorage` unless the user explicitly enables it via
   * `persistApiKey`.
   */
  apiKey: string;
  apiModel: string;
  localModelId: string;
  localAiEnabled: boolean;
  /**
   * Explicit opt-in to persist the OpenAI key in `localStorage`.
   * Defaults to `false`. See the `saveSettings` security note.
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
   * Structured citations for the sources ACTUALLY retrieved for this answer.
   * Empty list (not absent) when the answer used no retrieved material: the
   * UI tells it apart from "no information".
   */
  citations?: RagSourceCitation[];
  /** Concrete model or mechanism that produced the answer. */
  modelUsed?: string;
  /**
   * False when retrieved context rests only on weak title/metadata matches:
   * the answer must not pose as solidly grounded even with citations.
   */
  hasSubstantiveContext?: boolean;
  /**
   * `true` when the final anti-hallucination gate replaced the answer with a
   * controlled message. The UI may render it as a warning instead of an answer.
   */
  groundedAnswerRejected?: boolean;
}

/**
 * Generation options that avoid unneeded or unwanted retrievals.
 */
export interface AskTutorOptions {
  /**
   * Caller-ALREADY-retrieved context. When provided, generation uses exactly
   * those sources and citations: NO second retrieval runs, so ranking cannot
   * shift between first and second search and citations match the model-supplied
   * context precisely.
   */
  prebuiltContext?: {
    documents: RetrievedDocument[];
    retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
    hasSubstantiveContext?: boolean;
    totalCandidates?: number;
    diversifiedCandidates?: number;
  };
  /**
   * Disables RAG retrieval entirely. Used when the authoritative source is the
   * caller's own text (e.g. summarizing a passage) and a global search would
   * pollute the answer with foreign material.
   */
  disableRetrieval?: boolean;
}

/** Honest description of the model behind a provider answer. */
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

/** Builds a retrieval scope only when at least one valid anchor exists. */
function buildRetrievalScope(resourceId?: string, lessonId?: string): RetrievalScope | undefined {
  if (!resourceId && !lessonId) return undefined;
  return { resourceId, lessonId };
}

/**
 * Applies the final grounding gate to a conversational answer.
 *
 * Deterministic and dependency-free: the same text with the same context
 * always yields the same verdict. Returns a new answer and never mutates the
 * input.
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
    // A replaced answer cannot keep citations the model may have invented:
    // cleared so the UI never presents them as evidence.
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
 * In-memory OpenAI key (never stored by default).
 *
 * A pure client-side app has no secure secret storage: any script running on
 * the origin can read both `localStorage` and memory. Client-side encryption
 * is not presented as XSS-safe; hence the default never persists the key.
 */
let inMemoryApiKey = '';

/** Full settings as the rest of the service uses them (key included). */
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
      // The key is only restored from storage after explicit user opt-in.
      const key = persisted.persistApiKey ? (persisted.apiKey || '') : inMemoryApiKey;
      return { ...persisted, apiKey: key };
    } catch {
      return { ...DEFAULT_SETTINGS, apiKey: inMemoryApiKey };
    }
  },

  /**
   * Saves the AI settings.
   *
   * The OpenAI key stays in memory unless `persistApiKey` is `true`. When
   * `true` it is written to `localStorage` unencrypted: an informed user
   * decision the UI warns about explicitly, because browser storage is NOT a
   * secure secret store.
   *
   * When the provider stops being `openai`, the key is dropped: no zombie key
   * lingers for accidental reuse.
   */
  saveSettings(settings: AISettings) {
    const persist = settings.persistApiKey === true;
    const providerIsOpenAI = settings.provider === 'openai';
    // The key only survives while the provider stays OpenAI.
    inMemoryApiKey = providerIsOpenAI && settings.apiKey ? settings.apiKey : '';

    if (typeof localStorage === 'undefined') {
      inMemorySettings = { ...settings, apiKey: inMemoryApiKey };
      for (const listener of settingsListeners) {
        try { listener(inMemorySettings); } catch {}
      }
      return;
    }

    // The key is never written to the persisted payload without explicit opt-in.
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

  /** Drops the OpenAI key from memory and storage. */
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
        /* storage unavailable: the in-memory key is already cleared */
      }
    }
  },

  /**
   * Answers a tutoring query with local RAG plus the configured provider.
   * With the 'local' provider, inference runs 100% on-device via WebLLM with
   * no external API calls.
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
      // Every final answer exposes ITS citations (empty when nothing was
      // retrieved) plus the model that produced it: the UI cleanly separates
      // retrieved source, generated answer, and provider.
      citations: response.citations ?? [],
      modelUsed: response.modelUsed ?? describeModelForProvider(response.providerUsed)
    };
  },

  /** Internal `askTutor` implementation (wrapped to enrich the answer). */
  async askTutorCore(
    messages: AIChatMessage[],
    contextInfo: string = '',
    onChunk?: (token: string) => void,
    scope?: RetrievalScope,
    options?: AskTutorOptions
  ): Promise<AssistantResponse> {
    const settings = this.getSettings();
    const lastUserQuery = messages[messages.length - 1]?.content || '';

    // 1. Local RAG retrieval (ONCE per answer).
    //
    // When the caller already retrieved context (`prebuiltContext`), that exact
    // material and its citations are used: no second retrieval can reorder
    // sources or break citation-context alignment. `disableRetrieval` (e.g.
    // summarizing caller-supplied text) skips global retrieval entirely.
    // Semantic retrieval is only primed for the local provider.
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

    // FINAL anti-hallucination gate: applies to EVERY conversational answer,
    // whatever the provider, and is deterministic. Without visible material no
    // source can be claimed; with weak material the answer is flagged as
    // ungrounded. Honest answers declaring their own uncertainty pass through.
    return applyResponseGroundingGate(response, {
      // Visible context exists when the model received retrieved (RAG) material
      // or caller-supplied authoritative text (e.g. summarizing).
      hasContext: rag.hasContext || Boolean(options?.disableRetrieval && contextInfo.trim().length > 0),
      hasSubstantiveContext,
      sourceTitles: rag.sourceTitles
    });
  },

  /**
   * Explains a concept with locally retrieved context.
   *
   * Retrieves ONCE and forwards that same context to generation: no second
   * search can shift ranking or citations.
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
   * Grounded tutoring action: explain one specific resource or document using
   * only retrieved CrossedArts context with verifiable citations.
   */
  async explainResource(resourceTitle: string, resourceDescription?: string, scope?: RetrievalScope): Promise<AssistantResponse> {
    const query = `${resourceTitle} ${resourceDescription || ''}`.trim();
    const retrieval = await retrieveLocalContext(query, 3, scope);

    // Without enough local context, answer honestly without inventing
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

    // The ALREADY-retrieved context is reused exactly: generation never
    // re-searches, so ranking and citations cannot diverge.
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
   * Summarizes study text.
   *
   * The supplied text is the AUTHORITATIVE source: no global retrieval runs,
   * because library search over user text would pollute the summary with
   * unsolicited foreign material.
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
   * Generates flashcards grounded in retrieved CrossedArts content.
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
      // Deterministic templates from retrieved documents for offline testing and demo
      const demoCards = retrieval.documents.slice(0, count).map((doc, idx) => ({
        front: `¿Qué aspecto clave define a "${doc.title}"?`,
        back: doc.snippet.length > 80 ? doc.snippet.slice(0, 80) + '...' : doc.snippet
      }));
      rawOutput = JSON.stringify({ cards: demoCards });
    } else {
      // For Ollama / OpenAI, reuse askTutor internally without firing a second RAG retrieval
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
   * Generates multiple-choice practice questions grounded in retrieved content.
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
      // Deterministic generation for demo mode and offline tests
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
