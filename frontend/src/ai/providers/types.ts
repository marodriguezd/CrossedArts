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
   * Streaming callback. CONTRACT: each invocation delivers a DELTA (new text
   * only), never the accumulated text or the full final answer.
   */
  onChunk?: (delta: string) => void;
}

export interface AIProviderStrategy {
  execute(request: ProviderExecutionRequest): Promise<AssistantResponse>;
}
