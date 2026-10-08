import type { RagSourceCitation } from '../lib/localRag/contextBuilder.ts';
import type { RetrievedDocument } from '../lib/localRag/retrieval.ts';

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
  persistApiKey?: boolean;
}

export interface AssistantResponse {
  answer: string;
  sources: string[];
  providerUsed: AIProvider;
  isLocalOnDevice: boolean;
  retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
  citations?: RagSourceCitation[];
  modelUsed?: string;
  hasSubstantiveContext?: boolean;
}

export interface AskTutorOptions {
  prebuiltContext?: {
    documents: RetrievedDocument[];
    retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
    hasSubstantiveContext?: boolean;
    totalCandidates?: number;
    diversifiedCandidates?: number;
  };
  disableRetrieval?: boolean;
}
