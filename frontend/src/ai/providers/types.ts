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
  /**
   * Replacement event (delta contract preserved): the text already delivered for
   * this generation was rewritten, so the consumer discards it and continues
   * from `text`. Only providers that stream ACCUMULATED snapshots can emit it;
   * the one-shot providers (demo, Ollama, OpenAI) send a single delta and never
   * rewrite.
   */
  onReplace?: (text: string) => void;
  /** Cancellation token for a long generation (aborted stream). */
  signal?: AbortSignal;
}

export interface AIProviderStrategy {
  execute(request: ProviderExecutionRequest): Promise<AssistantResponse>;
}
