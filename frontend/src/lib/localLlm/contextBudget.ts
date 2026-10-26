import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './registry.ts';

/**
 * Chat-history budget for the local model.
 *
 * The drawer used to send the WHOLE conversation to a model with a 2k-4k
 * context window: after a dozen turns the prompt overflowed, the model truncated
 * it silently, or generation failed. The history is now fitted to the window,
 * system prompt included, and the UI says when older messages were left out.
 */
export interface ChatTurn {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface TrimResult {
  /** Turns that fit, oldest-dropped, original order preserved. */
  messages: ChatTurn[];
  /** Turns left out (only from the middle of the conversation). */
  omitted: number;
  usedTokens: number;
  budgetTokens: number;
}

/**
 * Conservative tokens-per-character estimate.
 *
 * There is no tokenizer in the browser for the local models, so the budget is
 * measured in characters with a safety margin (Spanish text runs ~3.5 chars per
 * token; 3 is used on purpose).
 */
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(text: string): number {
  return Math.ceil((text || '').length / CHARS_PER_TOKEN);
}

/**
 * Context window of the model that will actually run, minus the room reserved
 * for the answer (a reply can be as long as the whole question).
 */
export function resolveContextBudget(modelId?: string | null): number {
  const def = getLocalModelById(modelId || DEFAULT_LOCAL_MODEL_ID);
  const windowSize = def?.contextWindowSize ?? 2048;
  const reserveForAnswer = Math.max(256, Math.floor(windowSize * 0.25));
  return Math.max(256, windowSize - reserveForAnswer);
}

/**
 * Fits `history` into `budgetTokens`, keeping the system turn and the newest
 * turns.
 *
 * Turns are dropped from the OLDEST first: recent exchanges are what the model
 * needs to follow the conversation. A single very long turn is kept as-is (the
 * caller caps the outgoing query) so the model never loses the actual question.
 */
export function trimChatHistory(history: ChatTurn[], budgetTokens: number): TrimResult {
  // The system turn is always kept: it carries the tutor's pedagogical rules.
  const system = history.filter((turn) => turn.role === 'system');
  const conversational = history.filter((turn) => turn.role !== 'system');

  let used = system.reduce((sum, turn) => sum + estimateTokens(turn.content), 0);
  const kept: ChatTurn[] = [];

  for (let i = conversational.length - 1; i >= 0; i--) {
    const cost = estimateTokens(conversational[i].content);
    // The newest turn is always kept: dropping the question would be absurd.
    if (kept.length > 0 && used + cost > budgetTokens) break;
    kept.unshift(conversational[i]);
    used += cost;
  }

  return {
    messages: [...system, ...kept],
    omitted: conversational.length - kept.length,
    usedTokens: used,
    budgetTokens
  };
}

/** Spanish notice for the UI; `null` when nothing was omitted. */
export function describeTrimNotice(result: TrimResult): string | null {
  if (result.omitted <= 0) return null;
  const noun = result.omitted === 1 ? 'mensaje antiguo' : 'mensajes antiguos';
  return `Se ${result.omitted === 1 ? 'ha' : 'han'} omitido ${result.omitted} ${noun} para no superar el contexto del modelo local.`;
}
