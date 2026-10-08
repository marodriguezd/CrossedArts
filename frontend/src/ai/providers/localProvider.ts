import type { AIProviderStrategy, ProviderExecutionRequest } from './types.ts';
import type { AssistantResponse } from '../types.ts';
import { localAiRuntime } from '../../services/localAiRuntime.ts';
import { localLlmEngine } from '../../lib/localLlm/engine.ts';
import { buildAssistantPrompt } from '../../lib/localLlm/prompts.ts';

export class LocalProviderStrategy implements AIProviderStrategy {
  async execute(req: ProviderExecutionRequest): Promise<AssistantResponse> {
    const { messages, combinedContext, ragContext, hasSubstantiveContext, retrievalMode, onChunk } = req;
    const lastUserQuery = messages[messages.length - 1]?.content || '';

    const readiness = await localAiRuntime.ensureLocalAiReady({ provider: 'local' });
    if (readiness.stage === 'consent-required') {
      return {
        answer: `Para activar la IA local necesitamos descargar aproximadamente ${readiness.downloadSize || 'los recursos necesarios'}. Después podrás usarla sin conexión. Abre el tutor o Ajustes para activarla.`,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'local',
        isLocalOnDevice: true,
        retrievalMode
      };
    }
    if (readiness.stage !== 'ready') {
      return {
        answer: `⚠️ ${readiness.message}${readiness.errorAction ? ` ${readiness.errorAction}` : ''}`,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'local',
        isLocalOnDevice: true,
        retrievalMode
      };
    }

    try {
      const { system, user } = buildAssistantPrompt(lastUserQuery, combinedContext);
      const promptMessages = [
        { role: 'system' as const, content: system },
        ...messages.slice(0, -1),
        { role: 'user' as const, content: user }
      ];

      const answer = await localLlmEngine.generate(promptMessages, {
        stream: !!onChunk,
        onChunk
      });

      return {
        answer,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'local',
        isLocalOnDevice: true,
        retrievalMode
      };
    } catch (err: any) {
      return {
        answer: `⚠️ La IA local no pudo completar la respuesta. ${err?.message || 'Fallo desconocido'}`,
        sources: ragContext.sourceTitles,
        citations: ragContext.citations,
        hasSubstantiveContext,
        providerUsed: 'local',
        isLocalOnDevice: true,
        retrievalMode
      };
    }
  }
}
