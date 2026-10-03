import { localLlmEngine } from '../lib/localLlm/engine.ts';
import { DEFAULT_LOCAL_MODEL_ID } from '../lib/localLlm/registry.ts';
import { buildAssistantPrompt, buildExplainPrompt, buildSummarizePrompt } from '../lib/localLlm/prompts.ts';
import { retrieveLocalContext } from '../lib/localRag/retrieval.ts';
import type { RetrievalScope } from '../lib/localRag/retrieval.ts';
import { buildRagContext } from '../lib/localRag/contextBuilder.ts';

export type AIProvider = 'demo' | 'local' | 'ollama' | 'openai';

export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AISettings {
  provider: AIProvider;
  ollamaUrl: string;
  ollamaModel: string;
  apiKey: string;
  apiModel: string;
  localModelId: string;
  localAiEnabled: boolean;
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
  localAiEnabled: false
};

let inMemorySettings: AISettings | null = null;

export const aiService = {
  getSettings(): AISettings {
    try {
      if (typeof localStorage === 'undefined') {
        return inMemorySettings || DEFAULT_SETTINGS;
      }
      const saved = localStorage.getItem('crossedarts_ai_settings');
      if (saved) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      }
      return DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AISettings) {
    if (typeof localStorage === 'undefined') {
      inMemorySettings = settings;
      return;
    }
    localStorage.setItem('crossedarts_ai_settings', JSON.stringify(settings));
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

    // 1. Recuperación RAG local de SQLite (con ámbito determinista opcional)
    const retrieval = await retrieveLocalContext(lastUserQuery, 3, scope);
    const rag = buildRagContext(retrieval.documents);
    const combinedContext = [contextInfo, rag.formattedContextText].filter(Boolean).join('\n\n');

    // 2. Proveedor LOCAL (WebLLM / WebGPU on-device)
    if (settings.provider === 'local') {
      if (localLlmEngine.getStatus() !== 'ready') {
        return {
          answer: '⚠️ El modelo de IA local no está cargado o listo. Ve a **Ajustes** y carga el modelo local WebGPU antes de consultar.',
          sources: rag.sourceTitles,
          providerUsed: 'local',
          isLocalOnDevice: true
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
          answer: `⚠️ Error en inferencia local WebGPU: ${err?.message || 'Fallo desconocido'}. Verifica los recursos de tu navegador.`,
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
    if (settings.provider === 'openai' && settings.apiKey) {
      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${settings.apiKey}`
          },
          body: JSON.stringify({
            model: settings.apiModel || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: `Tutor de CrossedArts. Contexto:\n${combinedContext}` },
              ...messages
            ]
          })
        });
        const data = await res.json();
        const reply = data.choices[0]?.message?.content || 'Sin respuesta de OpenAI.';
        if (onChunk) onChunk(reply);
        return {
          answer: reply,
          sources: rag.sourceTitles,
          providerUsed: 'openai',
          isLocalOnDevice: false,
          retrievalMode: retrieval.retrievalMode
        };
      } catch (err: any) {
        return {
          answer: `Error OpenAI: ${err.message}`,
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

    const retrieval = await retrieveLocalContext(query, 4, buildRetrievalScope(options.resourceId, options.lessonId));
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
      if (localLlmEngine.getStatus() !== 'ready') {
        return {
          cards: [],
          sourceIds,
          sourceTitles: rag.sourceTitles,
          error: 'El modelo local WebGPU no está inicializado. Actívalo en Ajustes.'
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

    const retrieval = await retrieveLocalContext(query, 4, buildRetrievalScope(options.resourceId, options.lessonId));
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
      if (localLlmEngine.getStatus() !== 'ready') {
        return {
          questions: [],
          sourceIds,
          sourceTitles: rag.sourceTitles,
          error: 'El modelo local WebGPU no está inicializado. Actívalo en Ajustes.'
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
