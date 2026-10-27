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
   * final answer. Backends that naturally produce accumulated text
   * (Transformers.js on WASM, in the main thread and in a worker alike) compute
   * the delta BEFORE invoking the callback, and the final answer is NOT emitted
   * a second time. Backends that already emit deltas (WebGPU) pass them through
   * unchanged.
   *
   * `onChunk` is APPEND-ONLY: it never retracts what it already delivered. A
   * backend rewrite is announced through `onReplace`, which is why the
   * reconstruction guarantee reads:
   *
   *   chunks.join('') === final answer   (monotonic snapshots)
   *
   * Monotonic means every accumulated snapshot extends the previous text, which
   * is what the WASM backends emit. When a snapshot rewrites or shortens the
   * streamed text, see `DeltaStream` for the per-case behavior; the answer
   * returned by `generate()` is authoritative in every case.
   */
  onChunk?: (delta: string) => void;
  /**
   * REPLACEMENT EVENT: the backend rewrote text that was already delivered.
   *
   * DELTA CONTRACT UNCHANGED: `onChunk` keeps carrying new text only. Since an
   * append-only stream cannot un-send characters, the retraction travels as a
   * distinct event: DISCARD every delta received in this generation and continue
   * from `text`. After a generation ends, a consumer that honors this event holds
   * exactly the authoritative answer.
   *
   * Optional on purpose: consumers that only implement `onChunk` (deltas are
   * enough to render progressively) keep working, with the documented caveat
   * that streamed text can then differ from the final answer. The WASM backends
   * emit it through `DeltaStream`; the WebGPU path emits real deltas and never
   * rewrites, so it does not need it.
   */
  onReplace?: (text: string) => void;
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
 * It turns accumulated snapshots into real deltas and, when the consumer accepts
 * replacement events, keeps the streamed text equal to the backend's current
 * answer even across rewrites. What it guarantees, stated per case:
 *
 *  - MONOTONIC snapshots (each one extends the previous text, what
 *    Transformers.js emits): concatenating the deltas reproduces the final
 *    answer EXACTLY. Held-back trailing whitespace is dropped at `finish`,
 *    matching the trimmed value `generate()` returns.
 *  - A snapshot that does NOT extend what was already emitted (equal, shorter,
 *    or a same-length rewrite), either alone or as a longer snapshot whose
 *    prefix diverges: with a replacement handler, the consumer is told to
 *    DISCARD what it holds and continue from the new text, so `text` is again the
 *    backend's own answer — the stale characters are really retracted.
 *  - Same case WITHOUT a replacement handler (deltas-only consumer): nothing can
 *    be retracted, so a shorter snapshot emits nothing and a longer divergent one
 *    delivers only the part after the common prefix, which can leave stale text
 *    and even repeat a fragment (emitted "Hola mundo" + rewritten
 *    "Hola Mundo!!" join as "Hola mundoMundo!!"). Behavior unchanged from before
 *    replacements existed: the answer returned by `generate()` is authoritative.
 *
 * Deterministic with no global state: each generation uses its own instance.
 */
export class DeltaStream {
  private emitted = '';
  /** Trailing whitespace held back from the last snapshot. */
  private pendingWhitespace = '';
  /**
   * What the consumer currently holds: the deltas emitted since the last
   * replacement. Identical to the concatenation of every delivery when no
   * replacement happened, which is the common case.
   */
  private readonly chunks: string[] = [];
  private readonly onChunk: (delta: string) => void;
  private readonly onReplace?: (text: string) => void;
  private readonly normalize: (text: string) => string;

  constructor(
    onChunk: (delta: string) => void,
    normalize?: (text: string) => string,
    onReplace?: (text: string) => void
  ) {
    this.onChunk = onChunk;
    this.onReplace = onReplace;
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
   * space-terminated delta that is later trimmed. With monotonic snapshots the
   * emitted deltas therefore reconstruct the answer exactly; when the backend
   * rewrites streamed text the class contract says what is delivered instead.
   *
   * Idempotent with the same accumulated content and never emits empty output.
   */
  push(snapshot: string): void {
    const normalized = this.normalize(snapshot);
    if (normalized === this.emitted) return;

    const extendsEmitted =
      normalized.length > this.emitted.length && normalized.startsWith(this.emitted);

    if (!extendsEmitted) {
      // The backend rewrote (or shortened) text the consumer already holds.
      // Deltas are append-only, so only a replacement event can express it.
      if (this.tryReplace(normalized)) return;
      if (normalized.length <= this.emitted.length) return;

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
   * Closes the stream, and REPAIRS a non-monotonic one: whatever the backend
   * rewrote, a consumer that honors replacements ends this call holding exactly
   * `finalText`.
   *
   * When the normalized final text extends what was delivered, the missing part
   * arrives as one last delta and the answer that already arrived is never
   * re-emitted. When it does not extend it (equality aside, which emits nothing),
   * the correction is announced as a replacement, so the stale text the consumer
   * was showing really disappears. The held-back whitespace is dropped because
   * the final answer is normalized (no outer whitespace).
   */
  finish(finalText: string): void {
    const normalized = this.normalize(finalText);
    if (normalized !== this.emitted && !normalized.startsWith(this.emitted)) {
      if (this.tryReplace(normalized)) return;
    }
    this.push(normalized);
    this.pendingWhitespace = '';
  }

  /**
   * Announces a replacement when the consumer accepts them. Returns whether it
   * happened, so callers know whether they still owe the append-only fallback.
   */
  private tryReplace(text: string): boolean {
    if (!this.onReplace) return false;
    this.emitted = text;
    // The consumer discarded everything, so the reconstruction restarts here.
    this.chunks.length = 0;
    if (text) this.chunks.push(text);
    this.pendingWhitespace = '';
    this.onReplace(text);
    return true;
  }

  private emit(delta: string): void {
    if (!delta) return;
    this.chunks.push(delta);
    this.onChunk(delta);
  }

  /**
   * Text the consumer holds: the deltas emitted since the last replacement (all
   * of them when none happened).
   */
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