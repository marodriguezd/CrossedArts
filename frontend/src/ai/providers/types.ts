import type { AIChatMessage, AssistantResponse, AISettings } from '../types.ts';
import { buildRagContext } from '../../lib/localRag/contextBuilder.ts';

export interface ProviderExecutionRequest {
  messages: AIChatMessage[];
  combinedContext: string;
  settings: AISettings;
  ragContext: ReturnType<typeof buildRagContext>;
  hasSubstantiveContext: boolean;
  retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
  /**
   * Callback de streaming. CONTRATO: cada invocación entrega un DELTA (solo
   * texto nuevo), nunca el acumulado ni la respuesta final completa.
   */
  onChunk?: (delta: string) => void;
}

export interface AIProviderStrategy {
  execute(request: ProviderExecutionRequest): Promise<AssistantResponse>;
}
