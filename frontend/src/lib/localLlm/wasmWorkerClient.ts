import type { ModelLoadingProgress } from './engine.ts';
import { resolveOrtRuntimeBase } from '../localEmbeddings/ortRuntime.ts';

/** Per-request ceilings. Loading downloads weights; generation is bounded work. */
export const WASM_WORKER_TIMEOUTS = {
  load: 15 * 60 * 1000,
  generate: 3 * 60 * 1000,
  unload: 5 * 1000
} as const;

export interface WasmWorkerClientOptions {
  /** Overrides for tests. */
  timeouts?: Partial<typeof WASM_WORKER_TIMEOUTS>;
  /** Worker factory, injectable so lifecycle tests never spawn a real thread. */
  createWorker?: () => Worker;
}

interface PendingRequest {
  resolve: (val: any) => void;
  reject: (err: any) => void;
  onChunk?: (text: string) => void;
  onProgress?: (p: ModelLoadingProgress) => void;
  timer: ReturnType<typeof setTimeout> | null;
  detachAbort?: () => void;
}

/**
 * Message channel to the CPU inference worker.
 *
 * The worker is treated as CRASHABLE: an `onerror` now terminates it and rejects
 * every pending promise (before, `this.worker` stayed set to a dead thread, so
 * every later call hung forever). Requests also carry a timeout, and `unload`
 * cannot block on a busy worker.
 */
export class WasmWorkerClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<number, PendingRequest>();
  private readonly timeouts: typeof WASM_WORKER_TIMEOUTS;
  private readonly createWorker: () => Worker;

  constructor(options: WasmWorkerClientOptions = {}) {
    this.timeouts = { ...WASM_WORKER_TIMEOUTS, ...(options.timeouts ?? {}) };
    this.createWorker =
      options.createWorker ??
      (() => new Worker(new URL('./wasmWorker.ts', import.meta.url), { type: 'module' }));
  }

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Worker !== 'undefined';
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, type, payload, error } = e.data || {};
        const handler = this.pending.get(id);
        if (!handler) return;

        if (type === 'progress') {
          handler.onProgress?.(payload);
        } else if (type === 'chunk') {
          handler.onChunk?.(payload.accumulatedText);
        } else if (type === 'load-success' || type === 'generate-success' || type === 'unload-success') {
          this.settle(id);
          handler.resolve(payload?.text ?? payload);
        } else if (type === 'error') {
          this.settle(id);
          handler.reject(new Error(error || 'Error en Worker de inferencia WASM'));
        }
      };

      this.worker.onerror = (err) => {
        console.error('WASM Worker error:', err);
        this.failAll('WASM Worker error: ' + (err.message || 'error desconocido'));
        this.terminateWorker();
      };
    }
    return this.worker;
  }

  /** Terminates the thread and drops the handle so the next call can recreate it. */
  private terminateWorker(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    try {
      worker.terminate();
    } catch {
      /* ya terminado */
    }
  }

  private settle(id: number): void {
    const handler = this.pending.get(id);
    if (!handler) return;
    if (handler.timer !== null) clearTimeout(handler.timer);
    handler.detachAbort?.();
    this.pending.delete(id);
  }

  private failAll(message: string): void {
    for (const [, handler] of this.pending.entries()) {
      if (handler.timer !== null) clearTimeout(handler.timer);
      handler.detachAbort?.();
      handler.reject(new Error(message));
    }
    this.pending.clear();
  }

  private track(
    id: number,
    entry: Omit<PendingRequest, 'timer' | 'detachAbort'>,
    timeoutMs: number,
    signal?: AbortSignal
  ): void {
    const timer = setTimeout(() => {
      this.pending.delete(id);
      entry.reject(new Error('Tiempo de espera agotado en el motor de inferencia local.'));
      // A worker that cannot answer is not reused.
      if (this.pending.size === 0) this.terminateWorker();
    }, timeoutMs);

    const detachAbort = signal
      ? (() => {
          const onAbort = () => {
            this.settle(id);
            entry.reject(abortError());
            // Cancelling must actually stop the work: a CPU generation cannot be
            // interrupted cooperatively, so the thread is discarded.
            this.failAll('Generación cancelada.');
            this.terminateWorker();
          };
          signal.addEventListener('abort', onAbort, { once: true });
          return () => signal.removeEventListener('abort', onAbort);
        })()
      : undefined;

    this.pending.set(id, { ...entry, timer, detachAbort });
  }

  public async load(modelId: string, onProgress?: (p: ModelLoadingProgress) => void): Promise<void> {
    const worker = this.getWorker();
    const id = ++this.reqId;
    // The worker cannot see `document`; the page base is handed over so ONNX
    // Runtime resolves its artifacts under the deployed subdirectory.
    const wasmPaths = resolveOrtRuntimeBase(
      typeof document !== 'undefined' ? document.baseURI : undefined
    );
    return new Promise<void>((resolve, reject) => {
      this.track(id, { resolve: () => resolve(), reject, onProgress }, this.timeouts.load);
      worker.postMessage({ id, type: 'load', payload: { modelId, wasmPaths } });
    });
  }

  public async generate(
    prompt: string,
    maxTokens: number,
    temperature: number,
    onChunk?: (chunk: string) => void,
    signal?: AbortSignal
  ): Promise<string> {
    if (signal?.aborted) throw abortError();
    const worker = this.getWorker();
    const id = ++this.reqId;
    return new Promise<string>((resolve, reject) => {
      this.track(id, { resolve, reject, onChunk }, this.timeouts.generate, signal);
      worker.postMessage({ id, type: 'generate', payload: { prompt, maxTokens, temperature } });
    });
  }

  /**
   * Asks the worker to release the model and then terminates it.
   *
   * The wait is bounded: a busy worker used to leave `unload()` waiting for a
   * response that never came.
   */
  public async unload(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    const id = ++this.reqId;
    try {
      await new Promise<void>((resolve, reject) => {
        this.track(id, { resolve: () => resolve(), reject }, this.timeouts.unload);
        worker.postMessage({ id, type: 'unload' });
      });
    } catch {
      /* timeout o worker roto: se termina igualmente */
    }
    this.failAll('Motor de inferencia local descargado.');
    this.terminateWorker();
  }
}

/** Error shape the rest of the app recognizes as a user cancellation. */
export function abortError(): Error {
  const err = new Error('Generación cancelada.');
  err.name = 'AbortError';
  return err;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
