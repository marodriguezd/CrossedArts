/**
 * Embedding-model memory lifecycle.
 *
 * A 300M embedding model stays resident after the last query (~300 MB), which is
 * a large, invisible cost on a laptop. The model is released after a period of
 * inactivity, but NEVER while it is indexing or loading: dropping the pipeline
 * mid-pass would cancel real work.
 *
 * All timing is injected so the policy is testable without real clocks.
 */

import { localEmbeddingEngine } from '../lib/localEmbeddings/engine.ts';

export interface EmbeddingEngineLike {
  getStatus(): string;
  unload(): Promise<void>;
}

export interface EmbeddingMemoryTimers {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EmbeddingMemoryReleaserOptions {
  engine: EmbeddingEngineLike;
  /** Inactivity window before the model is released. */
  idleMs?: number;
  timers?: EmbeddingMemoryTimers;
  /** Called after a release (UI refresh). */
  onRelease?: () => void;
}

export interface EmbeddingMemoryReleaser {
  /** Restarts the inactivity window (any embedding activity calls this). */
  touch(): void;
  /** Releases now when it is safe; returns whether it did. */
  releaseNow(): Promise<boolean>;
  /** Cancels the pending timer (page teardown). */
  dispose(): void;
}

export const DEFAULT_EMBEDDING_IDLE_MS = 5 * 60 * 1000;

const browserTimers: EmbeddingMemoryTimers = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** States in which releasing the model would destroy in-flight work. */
const BUSY_STATES = new Set(['loading', 'checking', 'embedding', 'unloading']);

export function createEmbeddingMemoryReleaser(
  options: EmbeddingMemoryReleaserOptions
): EmbeddingMemoryReleaser {
  const idleMs = options.idleMs ?? DEFAULT_EMBEDDING_IDLE_MS;
  const timers = options.timers ?? browserTimers;
  let handle: unknown = null;

  const clear = () => {
    if (handle !== null) {
      timers.clearTimeout(handle);
      handle = null;
    }
  };

  const canRelease = (): boolean => {
    if (BUSY_STATES.has(options.engine.getStatus())) return false;
    // Only a loaded model consumes memory worth releasing.
    return options.engine.getStatus() === 'ready';
  };

  const releaseNow = async (): Promise<boolean> => {
    clear();
    if (!canRelease()) return false;
    try {
      await options.engine.unload();
      options.onRelease?.();
      return true;
    } catch {
      return false;
    }
  };

  const arm = () => {
    clear();
    handle = timers.setTimeout(() => {
      handle = null;
      void releaseNow();
    }, idleMs);
  };

  const touch = () => {
    // Arming while busy is a no-op: the timer restarts when work finishes.
    if (!canRelease()) {
      clear();
      return;
    }
    arm();
  };

  return { touch, releaseNow, dispose: clear };
}

/**
 * `pagehide` policy: cancel the pending timer and release right away.
 *
 * Closing or backgrounding the tab is the last chance to give back the ~300 MB
 * of a loaded model. `releaseNow()` refuses while the engine is loading or
 * indexing, so an in-flight pass is never destroyed.
 */
export function releaseOnPageHide(releaser: EmbeddingMemoryReleaser): Promise<boolean> {
  releaser.dispose();
  return releaser.releaseNow();
}

/**
 * Process-wide policy instance bound to the real engine.
 *
 * It is a singleton on purpose: two releasers would arm two timers and release
 * the model twice.
 */
export const embeddingMemoryReleaser = createEmbeddingMemoryReleaser({
  engine: localEmbeddingEngine
});
