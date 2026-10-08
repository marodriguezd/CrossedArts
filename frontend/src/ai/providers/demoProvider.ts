import type { AIProviderStrategy, ProviderExecutionRequest } from './types.ts';
import type { AssistantResponse } from '../types.ts';

export class DemoProviderStrategy implements AIProviderStrategy {
  async execute(req: ProviderExecutionRequest): Promise<AssistantResponse> {
    const { messages, ragContext, hasSubstantiveContext, retrievalMode, onChunk } = req;
    const lastUserQuery = (messages[messages.length - 1]?.content || '').toLowerCase();

    await new Promise(r => setTimeout(r, 50));

    let reply = '';
    if (lastUserQuery.includes('flashcard') || lastUserQuery.includes('repaso')) {
      reply = `💡 **Sugerencia de Repaso Activo:** Según la curva del olvido de Ebbinghaus y el algoritmo SM-2 que tienes activo en CrossedArts, te recomiendo repasar las tarjetas de *React 18* y *Deep Work* hoy para fijar los conceptos a largo plazo.`;
    } else if (lastUserQuery.includes('react') || lastUserQuery.includes('hook')) {
      reply = `⚛️ **Concepto Clave en React 18:** Recuerda que con el motor *Fiber*, las actualizaciones de estado ya no bloquean el hilo principal cuando usas \`useTransition\`. ¿Quieres que preparemos un quiz rápido sobre esto?`;
    } else {
      reply = `📚 **Tutor CrossedArts:** He analizado tus recursos activos. Para respuestas mediante LLM en tu propio dispositivo sin conexión ni servidores externos, activa la opción **IA Local (WebLLM)** en Ajustes.`;
    }

    if (onChunk) onChunk(reply);
    return {
      answer: reply,
      sources: ragContext.sourceTitles,
      citations: ragContext.citations,
      hasSubstantiveContext,
      providerUsed: 'demo',
      isLocalOnDevice: true,
      retrievalMode
    };
  }
}
