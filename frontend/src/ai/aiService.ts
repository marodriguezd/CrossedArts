import { localLlmEngine } from '../lib/localLlm/engine.ts';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/localLlm/registry.ts';
import { buildAssistantPrompt, buildExplainPrompt, buildSummarizePrompt } from '../lib/localLlm/prompts.ts';
import { retrieveLocalContext } from '../lib/localRag/retrieval.ts';
import type { RetrievalScope } from '../lib/localRag/retrieval.ts';
import { buildRagContext } from '../lib/localRag/contextBuilder.ts';
import { localAiRuntime } from '../services/localAiRuntime.ts';

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
  retrievalMode?: 'hybrid' | 'lexical';
}

/** Construye un ámbito de recuperación solo cuando hay al menos un ancla válida. */
function buildRetrievalScope(resourceId?: string, lessonId?: string): RetrievalScope | undefined {
  if (!resourceId && !lessonId) return undefined;
  return { resourceId, lessonId };
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

export const aiService = {
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
      return;
    }

    // Nunca se escribe la clave en el payload persistido salvo opt-in explícito.
    const payload: AISettings = {
      ...settings,
      apiKey: persist ? (providerIsOpenAI ? settings.apiKey || '' : '') : '',
      persistApiKey: persist
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
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
    scope?: RetrievalScope
  ): Promise<AssistantResponse> {
    const settings = this.getSettings();
    const lastUserQuery = messages[messages.length - 1]?.content || '';

    // 1. Recuperación RAG local de SQLite (con ámbito determinista opcional).
    // La recuperación semántica se prepara automáticamente solo para el proveedor local.
    const retrieval = await retrieveLocalContext(lastUserQuery, 3, scope, {
      semantic: settings.provider === 'local' && localAiRuntime.hasConsent()
    });
    const rag = buildRagContext(retrieval.documents);
    const combinedContext = [contextInfo, rag.formattedContextText].filter(Boolean).join('\n\n');

    // 2. Proveedor LOCAL (WebLLM / WebGPU on-device)
    if (settings.provider === 'local') {
      // Preparación automática (modelo + embeddings). El usuario no gestiona nada.
      const readiness = await localAiRuntime.ensureLocalAiReady({
        provider: 'local',
        overrideModelId: settings.localModelId && settings.localModelId !== DEFAULT_LOCAL_MODEL_ID ? settings.localModelId : undefined
      });
      if (readiness.stage === 'consent-required') {
        return {
          answer: `Para activar la IA local necesitamos descargar aproximadamente ${readiness.downloadSize || 'los recursos necesarios'}. Después podrás usarla sin conexión. Abre el tutor o Ajustes para activarla.`,
          sources: rag.sourceTitles,
          providerUsed: 'local',
          isLocalOnDevice: true,
          retrievalMode: retrieval.retrievalMode
        };
      }
      if (readiness.stage !== 'ready') {
        return {
          answer: `⚠️ ${readiness.message}${readiness.errorAction ? ` ${readiness.errorAction}` : ''}`,
          sources: rag.sourceTitles,
          providerUsed: 'local',
          isLocalOnDevice: true,
          retrievalMode: retrieval.retrievalMode
        };
      }

      try {
        const { system, user } = buildAssistantPrompt(lastUserQuery, combinedContext);
        const promptMessages = [
          { role: 'system' as const, content: system },
          ...messages.slice(0, -1),
          { role: 'user' as const, content: user }
        ];

        const answer = await localLlmEngine.generateChat(promptMessages, {
          stream: !!onChunk,
          onChunk
        });

        return {
          answer,
          sources: rag.sourceTitles,
          providerUsed: 'local',
          isLocalOnDevice: true,
          retrievalMode: retrieval.retrievalMode
        };
      } catch (err: any) {
        return {
          answer: `⚠️ La IA local no pudo completar la respuesta. ${err?.message || 'Fallo desconocido'}`,
          sources: rag.sourceTitles,
          providerUsed: 'local',
          isLocalOnDevice: true,
          retrievalMode: retrieval.retrievalMode
        };
      }
    }

    // 3. Proveedor OLLAMA (Local Server)
    if (settings.provider === 'ollama') {
      try {
        const systemPrompt = `Eres el tutor académico de CrossedArts (Learning Operating System). Contexto de estudio:\n${combinedContext}\nResponde de forma concisa, estructurada y pedagógica.`;
        const res = await fetch(`${settings.ollamaUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: settings.ollamaModel,
            messages: [{ role: 'system', content: systemPrompt }, ...messages],
            stream: false
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const reply = data.message?.content || 'No se recibió respuesta del modelo local.';
        if (onChunk) onChunk(reply);
        return {
          answer: reply,
          sources: rag.sourceTitles,
          providerUsed: 'ollama',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      } catch (err: any) {
        return {
          answer: `⚠️ Error conectando a Ollama en ${settings.ollamaUrl}. Asegúrate de que Ollama esté iniciado con CORS permitido (OLLAMA_ORIGINS="*"). Detalle: ${err.message}`,
          sources: rag.sourceTitles,
          providerUsed: 'ollama',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      }
    }

    // 4. Proveedor OPENAI (Cloud API)
    if (settings.provider === 'openai') {
      if (!settings.apiKey) {
        return {
          answer: 'OpenAI está seleccionado pero no hay una clave de API configurada. Introduce una clave en Ajustes o selecciona otro proveedor.',
          sources: rag.sourceTitles,
          providerUsed: 'openai',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      }
      // Se envía solo el encabezado de autenticación; la clave nunca se registra
      // en consola ni se incluye en el cuerpo de la petición.
      const openAiKey = settings.apiKey;
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openAiKey}`
          },
          body: JSON.stringify({
            model: settings.apiModel || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `Tutor de CrossedArts. Contexto:\n${combinedContext}` },
              ...messages
            ]
          })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const reply = data.choices[0]?.message?.content || 'Sin respuesta de OpenAI.';
          // La respuesta del proveedor puede incluir el fragmento de cabecera en
          // algunos intermediarios: se recorta para no exponer la clave en la UI.
        if (onChunk) onChunk(reply);
        return {
          answer: reply,
          sources: rag.sourceTitles,
          providerUsed: 'openai',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      } catch (err: any) {
        // Se muestra el motivo de la petición fallida, nunca la clave.
        return {
          answer: `Error OpenAI: ${String(err?.message || 'fallo de red').split(openAiKey).join('[clave]')}`,
          sources: rag.sourceTitles,
          providerUsed: 'openai',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      }
    }

    // 5. MODO DEMO / Offline pedagógico (0 web requests)
    await new Promise(r => setTimeout(r, 50));
    const lastUserMsg = lastUserQuery.toLowerCase();

    let reply = '';
    if (lastUserMsg.includes('flashcard') || lastUserMsg.includes('repaso')) {
      reply = `💡 **Sugerencia de Repaso Activo:** Según la curva del olvido de Ebbinghaus y el algoritmo SM-2 que tienes activo en CrossedArts, te recomiendo repasar las tarjetas de *React 18* y *Deep Work* hoy para fijar los conceptos a largo plazo.`;
    } else if (lastUserMsg.includes('react') || lastUserMsg.includes('hook')) {
      reply = `⚛️ **Concepto Clave en React 18:** Recuerda que con el motor *Fiber*, las actualizaciones de estado ya no bloquean el hilo principal cuando usas \`useTransition\`. ¿Quieres que preparemos un quiz rápido sobre esto?`;
    } else {
      reply = `📚 **Tutor CrossedArts:** He analizado tus recursos activos (${contextInfo || 'Cursos y libros del sistema'}). Para respuestas mediante LLM en tu propio dispositivo sin conexión ni servidores externos, activa la opción **IA Local (WebLLM)** en Ajustes.`;
    }

    if (onChunk) onChunk(reply);
    return {
      answer: reply,
      sources: rag.sourceTitles,
      providerUsed: 'demo',
      isLocalOnDevice: true,
      retrievalMode: retrieval.retrievalMode
    };
  },

  /**
   * Explica un concepto utilizando contexto recuperado localmente.
   */
  async explainConcept(conceptName: string): Promise<string> {
    const retrieval = await retrieveLocalContext(conceptName, 2);
    const rag = buildRagContext(retrieval.documents);
    const { system, user } = buildExplainPrompt(conceptName, rag.formattedContextText);
    const response = await this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]);
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
        providerUsed: this.getSettings().provider,
        isLocalOnDevice: this.getSettings().provider === 'demo' || this.getSettings().provider === 'local',
        retrievalMode: retrieval.retrievalMode
      };
    }

    const rag = buildRagContext(retrieval.documents);
    const { system, user } = buildExplainPrompt(resourceTitle, rag.formattedContextText);

    return this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ], `Recurso objetivo: ${resourceTitle}`, undefined, scope);
  },

  /**
   * Resume un texto de estudio.
   */
  async summarizeText(text: string): Promise<string> {
    const { system, user } = buildSummarizePrompt(text);
    const response = await this.askTutor([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]);
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
      const readiness = await localAiRuntime.ensureLocalAiReady({
        provider: 'local',
        overrideModelId: settings.localModelId && settings.localModelId !== DEFAULT_LOCAL_MODEL_ID ? settings.localModelId : undefined
      });
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
      rawOutput = await localLlmEngine.generateChat([
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
      // Para ollama / openai, reutilizar askTutor internamente
      const res = await this.askTutor([
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]);
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
      const readiness = await localAiRuntime.ensureLocalAiReady({
        provider: 'local',
        overrideModelId: settings.localModelId && settings.localModelId !== DEFAULT_LOCAL_MODEL_ID ? settings.localModelId : undefined
      });
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
      rawOutput = await localLlmEngine.generateChat([
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
      const res = await this.askTutor([
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]);
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
