import type { AIProviderStrategy, ProviderExecutionRequest } from './types.ts';
import type { AssistantResponse } from '../types.ts';

export class OllamaProviderStrategy implements AIProviderStrategy {
  async execute(req: ProviderExecutionRequest): Promise<AssistantResponse> {
    const { messages, combinedContext, settings, ragContext, hasSubstantiveContext, retrievalMode, onChunk } = req;
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
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'ollama',
        isLocalOnDevice: false,
        retrievalMode
      };
    } catch (err: any) {
      return {
        answer: `⚠️ Error conectando a Ollama en ${settings.ollamaUrl}. Asegúrate de que Ollama esté iniciado y de que su origen esté permitido (por ejemplo OLLAMA_ORIGINS="http://localhost:5173", nunca "*" si puedes evitarlo). Detalle: ${err.message}`,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'ollama',
        isLocalOnDevice: false,
        retrievalMode
      };
    }
  }
}
