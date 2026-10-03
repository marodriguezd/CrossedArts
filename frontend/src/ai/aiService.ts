export interface AIChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface AISettings {
  provider: 'ollama' | 'openai' | 'gemini' | 'demo';
  ollamaUrl: string;
  ollamaModel: string;
  apiKey: string;
  apiModel: string;
}

const DEFAULT_SETTINGS: AISettings = {
  provider: 'demo',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3:8b',
  apiKey: '',
  apiModel: 'gemini-1.5-flash'
};

let inMemorySettings: AISettings | null = null;

export const aiService = {
  getSettings(): AISettings {
    try {
      if (typeof localStorage === 'undefined') {
        return inMemorySettings || DEFAULT_SETTINGS;
      }
      const saved = localStorage.getItem('domestik_ai_settings');
      return saved ? JSON.parse(saved) : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  },

  saveSettings(settings: AISettings) {
    if (typeof localStorage === 'undefined') {
      inMemorySettings = settings;
      return;
    }
    localStorage.setItem('domestik_ai_settings', JSON.stringify(settings));
  },

  async askTutor(messages: AIChatMessage[], contextInfo: string = ''): Promise<string> {
    const settings = this.getSettings();

    if (settings.provider === 'ollama') {
      try {
        const systemPrompt = `Eres el tutor académico de DomestiK (Learning Operating System). Contexto de estudio del usuario:\n${contextInfo}\nResponde de forma concisa, estructurada y pedagógica.`;
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
        return data.message?.content || 'No se recibió respuesta del modelo local.';
      } catch (err: any) {
        return `⚠️ Error conectando a Ollama en ${settings.ollamaUrl}. Asegúrate de que Ollama esté iniciado con CORS permitido (OLLAMA_ORIGINS="*"). Detalle: ${err.message}`;
      }
    }

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
              { role: 'system', content: `Tutor de DomestiK. Contexto:\n${contextInfo}` },
              ...messages
            ]
          })
        });
        const data = await res.json();
        return data.choices[0]?.message?.content || 'Sin respuesta de OpenAI.';
      } catch (err: any) {
        return `Error OpenAI: ${err.message}`;
      }
    }

    // Modo Demo / Fallback pedagógico sin conexión (0 web requests)
    await new Promise(r => setTimeout(r, 50));
    const lastUserMsg = messages[messages.length - 1]?.content.toLowerCase() || '';

    if (lastUserMsg.includes('flashcard') || lastUserMsg.includes('repaso')) {
      return `💡 **Sugerencia de Repaso Activo:** Según la curva del olvido de Ebbinghaus y el algoritmo SM-2 que tienes activo en DomestiK, te recomiendo repasar las tarjetas de *React 18* y *Deep Work* hoy para fijar los conceptos a largo plazo.`;
    }
    if (lastUserMsg.includes('react') || lastUserMsg.includes('hook')) {
      return `⚛️ **Concepto Clave en React 18:** Recuerda que con el motor *Fiber*, las actualizaciones de estado ya no bloquean el hilo principal cuando usas \`useTransition\`. ¿Quieres que preparemos un quiz rápido sobre esto?`;
    }

    return `📚 **Tutor DomestiK:** He analizado tus recursos activos (${contextInfo || 'Cursos y libros del sistema'}). Para profundizar en este tema, revisa las notas vinculadas y realiza una autoevaluación en el **Centro de Repaso**. Configura tu proveedor de Ollama o API Key en **Ajustes** para respuestas con LLM en tiempo real.`;
  }
};
