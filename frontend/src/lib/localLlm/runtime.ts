export type RuntimeBackend = 'webgpu' | 'wasm' | 'none';

export type RuntimeStatus =
  | 'disabled'
  | 'checking'
  | 'unsupported'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error'
  | 'unloading';

export interface RuntimeLoadingProgress {
  progress: number;
  text: string;
  timeElapsed?: number;
}

export type RuntimeProgressCallback = (progress: RuntimeLoadingProgress) => void;

export interface GenerationOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  /**
   * Streaming callback.
   *
   * STREAMING CONTRACT (single one for all backends): each invocation delivers a
   * DELTA, that is ONLY the new text. Never the accumulated text nor the full
   * final answer. Therefore:
   *
   *   chunks.join('') === final answer
   *
   * Backends that naturally produce accumulated text (Transformers.js on WASM,
   * in the main thread and in a worker alike) compute the delta BEFORE invoking
   * the callback, and the final answer is NOT emitted a second time. Backends
   * that already emit deltas (WebGPU) pass them through unchanged.
   */
  onChunk?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Local Model Runtime abstraction (WebLLM, Transformers.js WASM, WebGPU).
 *
 * Single contract: `generate()` is the canonical name of the generation API.
 * Historic names (`generateChat`) exist only as a thin alias so external callers
 * keep working: they are not a second contract.
 */
export interface LocalModelRuntime {
  loadModel(modelId: string, onProgress?: RuntimeProgressCallback): Promise<void>;
  unload(): Promise<void>;
  /** Canonical generation API. ALWAYS returns the complete final text. */
  generate(messages: ChatMessage[], options?: GenerationOptions): Promise<string>;
  /**
   * Compatibility alias of `generate`. Same behavior, including the delta
   * streaming contract.
   */
  generateChat?(
    messages: ChatMessage[],
    options?: GenerationOptions & { stream?: boolean }
  ): Promise<string>;
  /** Delta iterator (same contract as `onChunk`). */
  generateStream?(messages: ChatMessage[], options?: GenerationOptions): AsyncIterable<string>;
  getStatus(): RuntimeStatus;
  getLoadedModelId(): string | null;
  getBackend(): RuntimeBackend;
  getLastError(): string | null;
  getProgress(): RuntimeLoadingProgress;
  subscribe(listener: (status: RuntimeStatus, progress: RuntimeLoadingProgress) => void): () => void;
}

/**
 * Delta emitter for backends that can only produce ACCUMULATED text.
 *
 * It turns a sequence of accumulated snapshots into real deltas and guarantees
 * that concatenating everything emitted reproduces exactly the final text (once
 * normalized). When the accumulated text is "corrected" (the backend rewrites
 * the tail), the emitter emits only the suffix not yet delivered and discards
 * the already-emitted prefix, so content is never duplicated or lost.
 *
 * Deterministic with no global state: each generation uses its own instance.
 */
export class DeltaStream {
  private emitted = '';
  /** Trailing whitespace held back from the last snapshot. */
  private pendingWhitespace = '';
  private readonly chunks: string[] = [];
  private readonly onChunk: (delta: string) => void;
  private readonly normalize: (text: string) => string;

  constructor(onChunk: (delta: string) => void, normalize?: (text: string) => string) {
    this.onChunk = onChunk;
    // MARKER normalization, not whitespace: outer trimming applies once over the
    // final answer, not on every snapshot (otherwise a word split would lose the
    // space joining it to the next one).
    this.normalize = normalize ?? stripTemplateMarkers;
  }

  /**
   * Ingests a text snapshot (accumulated or delta) and emits ONLY what is new.
   *
   * Trailing whitespace of each snapshot is HELD BACK until more content arrives
   * (or until `finish`), so a word split does not force emitting a
   * space-terminated delta that is later trimmed: deltas reconstruct the answer
   * EXACTLY.
   *
   * Idempotent with the same accumulated content and never emits empty output.
   */
  push(snapshot: string): void {
    const normalized = this.normalize(snapshot);
    if (normalized.length <= this.emitted.length) return;

    if (!normalized.startsWith(this.emitted)) {
      // The backend rewrote already-emitted text: only the genuinely new suffix
      // is delivered, never the duplicated prefix.
      const commonPrefix = commonPrefixLength(normalized, this.emitted);
      this.emitted = normalized;
      this.pendingWhitespace = '';
      this.emit(normalized.slice(commonPrefix));
      return;
    }

    const diff = normalized.slice(this.emitted.length);
    this.emitted = normalized;

    const trailing = diff.length - diff.replace(/\s+$/, '').length;
    if (trailing === diff.length) {
      // Whitespace only: held back until real content arrives.
      this.pendingWhitespace += diff;
      return;
    }

    const head = this.pendingWhitespace + diff.slice(0, diff.length - trailing);
    this.pendingWhitespace = diff.slice(diff.length - trailing);
    this.emit(head);
  }

  /**
   * Closes the stream. When the normalized final text has content not yet
   * emitted, it is delivered as a final delta; the complete answer that already
   * arrived via deltas is never re-emitted. The held-back whitespace is dropped
   * because the final answer is normalized (no outer whitespace).
   */
  finish(finalText: string): void {
    this.push(this.normalize(finalText));
    this.pendingWhitespace = '';
  }

  private emit(delta: string): void {
    if (!delta) return;
    this.chunks.push(delta);
    this.onChunk(delta);
  }

  /** Text rebuilt by concatenating the emitted deltas. */
  get text(): string {
    return this.chunks.join('');
  }
}

/**
 * Strips chat-template end markers (`<|im_end|>`, `<|endoftext|>`) WITHOUT
 * trimming outer whitespace: this is the normalization applied to each snapshot
 * during streaming.
 */
export function stripTemplateMarkers(text: string): string {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<\|im_end\|>[\s\S]*$/, '')
    .replace(/<\|endoftext\|>[\s\S]*$/, '');
}

/**
 * FINAL-ANSWER normalization: template markers plus outer whitespace trimming.
 * This is the exact shape `generate()` returns, so streamed output and returned
 * output match.
 */
export function stripGenerationArtifacts(text: string): string {
  return stripTemplateMarkers(text).trim();
}

function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a[i] === b[i]) i++;
  return i;
}