import type { AIProviderStrategy, ProviderExecutionRequest } from './types.ts';
import type { AssistantResponse } from '../types.ts';

export class OpenAIProviderStrategy implements AIProviderStrategy {
  async execute(req: ProviderExecutionRequest): Promise<AssistantResponse> {
    const { messages, combinedContext, settings, ragContext, hasSubstantiveContext, retrievalMode, onChunk } = req;
    if (!settings.apiKey) {
      return {
        answer: 'OpenAI está seleccionado pero no hay una clave de API configurada. Introduce una clave en Ajustes o selecciona otro proveedor.',
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'openai',
        isLocalOnDevice: false,
        retrievalMode
      };
    }

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
      if (onChunk) onChunk(reply);
      return {
        answer: reply,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'openai',
        isLocalOnDevice: false,
        retrievalMode
      };
    } catch (err: any) {
      return {
        answer: `Error OpenAI: ${String(err?.message || 'fallo de red').split(openAiKey).join('[clave]')}`,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'openai',
        isLocalOnDevice: false,
        retrievalMode
      };
    }
  }
}
