import type { ModelLoadingProgress } from './engine.ts';

export class WasmWorkerClient {
  private worker: Worker | null = null;
  private reqId = 0;
  private pending = new Map<
    number,
    {
      resolve: (val: any) => void;
      reject: (err: any) => void;
      onChunk?: (text: string) => void;
      onProgress?: (p: ModelLoadingProgress) => void;
    }
  >();

  public isSupported(): boolean {
    return typeof window !== 'undefined' && typeof Worker !== 'undefined';
  }

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL('./wasmWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent) => {
        const { id, type, payload, error } = e.data || {};
        const handler = this.pending.get(id);
        if (!handler) return;

        if (type === 'progress') {
          handler.onProgress?.(payload);
        } else if (type === 'chunk') {
          handler.onChunk?.(payload.accumulatedText);
        } else if (type === 'load-success' || type === 'generate-success' || type === 'unload-success') {
          this.pending.delete(id);
          handler.resolve(payload?.text ?? payload);
        } else if (type === 'error') {
          this.pending.delete(id);
          handler.reject(new Error(error || 'Error en Worker de inferencia WASM'));
        }
      };

      this.worker.onerror = (err) => {
        console.error('WASM Worker error:', err);
        for (const [, handler] of this.pending.entries()) {
          handler.reject(new Error('WASM Worker error: ' + (err.message || 'error desconocido')));
        }
        this.pending.clear();
      };
    }
    return this.worker;
  }

  public async load(modelId: string, onProgress?: (p: ModelLoadingProgress) => void): Promise<void> {
    const worker = this.getWorker();
    const id = ++this.reqId;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve: () => resolve(), reject, onProgress });
      worker.postMessage({ id, type: 'load', payload: { modelId } });
    });
  }

  public async generate(
    prompt: string,
    maxTokens: number,
    temperature: number,
    onChunk?: (chunk: string) => void
  ): Promise<string> {
    const worker = this.getWorker();
    const id = ++this.reqId;
    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onChunk });
      worker.postMessage({ id, type: 'generate', payload: { prompt, maxTokens, temperature } });
    });
  }

  public async unload(): Promise<void> {
    if (!this.worker) return;
    const worker = this.worker;
    const id = ++this.reqId;
    try {
      await new Promise<void>((resolve, reject) => {
        this.pending.set(id, { resolve: () => resolve(), reject });
        worker.postMessage({ id, type: 'unload' });
      });
    } catch {}
    worker.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
