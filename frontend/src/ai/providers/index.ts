import type { AIProvider } from '../types.ts';
import type { AIProviderStrategy } from './types.ts';
import { LocalProviderStrategy } from './localProvider.ts';
import { OllamaProviderStrategy } from './ollamaProvider.ts';
import { OpenAIProviderStrategy } from './openaiProvider.ts';
import { DemoProviderStrategy } from './demoProvider.ts';

export * from './types.ts';
export * from './localProvider.ts';
export * from './ollamaProvider.ts';
export * from './openaiProvider.ts';
export * from './demoProvider.ts';

const strategies: Record<AIProvider, AIProviderStrategy> = {
  local: new LocalProviderStrategy(),
  ollama: new OllamaProviderStrategy(),
  openai: new OpenAIProviderStrategy(),
  demo: new DemoProviderStrategy()
};

export function getProviderStrategy(provider: AIProvider): AIProviderStrategy {
  return strategies[provider] || strategies.demo;
}
