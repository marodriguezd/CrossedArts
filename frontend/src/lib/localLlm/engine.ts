import { DEFAULT_LOCAL_MODEL_ID, getLocalModelById } from './registry.ts';
import { detectWebGPUCapability } from './capabilities.ts';
import { WasmWorkerClient } from './wasmWorkerClient.ts';
import {
  DeltaStream,
  stripGenerationArtifacts,
  type ChatMessage,
  type GenerationOptions,
  type LocalModelRuntime
} from './runtime.ts';

export type { ChatMessage, GenerationOptions };

export type EngineStatus =
  | 'disabled'
  | 'checking'
  | 'unsupported'
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'error'
  | 'unloading';

export interface ModelLoadingProgress {
  progress: number;
  text: string;
  timeElapsed?: number;
}

export type ProgressCallback = (progress: ModelLoadingProgress) => void;

class LocalLlmEngine {
  private engineInstance: any = null;
  private wasmWorker = new WasmWorkerClient();
  private currentModelId: string | null = null;
  private currentBackend: 'webgpu' | 'wasm' = 'webgpu';
  private status: EngineStatus = 'idle';
  private lastError: string | null = null;
  private currentProgress: ModelLoadingProgress = { progress: 0, text: '' };
  private listeners: Set<(status: EngineStatus, progress: ModelLoadingProgress) => void> = new Set();
  
  // Control de concurrencia y solicitudes obsoletas
  private activeLoadPromise: Promise<void> | null = null;
  private loadSessionId: number = 0;

  public getStatus(): EngineStatus {
    return this.status;
  }

  public getBackend(): 'webgpu' | 'wasm' {
    return this.currentBackend;
  }

  public getLoadedModelId(): string | null {
    return this.currentModelId;
  }

  public getLastError(): string | null {
    return this.lastError;
  }

  public getProgress(): ModelLoadingProgress {
    return this.currentProgress;
  }

  public subscribe(listener: (status: EngineStatus, progress: ModelLoadingProgress) => void): () => void {
    this.listeners.add(listener);
    listener(this.status, this.currentProgress);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener(this.status, this.currentProgress);
      } catch (err) {
        console.error('Error en listener de LocalLlmEngine:', err);
      }
    }
  }

  /**
   * Carga perezosamente el motor WebLLM con el modelo especificado.
   * Si ya está cargado con ese modelo, reutiliza la instancia existente.
   * Previene duplicación de descargas concurrentes y maneja peticiones obsoletas.
   */
  public async loadModel(modelId: string = DEFAULT_LOCAL_MODEL_ID, onProgress?: ProgressCallback): Promise<void> {
    if (this.status === 'ready' && this.currentModelId === modelId && this.engineInstance) {
      return;
    }

    // Si ya hay una carga en progreso para el MISMO modelo, reutilizar su promesa para evitar doble descarga
    if (this.activeLoadPromise && this.currentModelId === modelId && (this.status === 'loading' || this.status === 'checking')) {
      return this.activeLoadPromise;
    }

    // Incrementar ID de sesión para invalidar cualquier callback asíncrono previo
    const sessionId = ++this.loadSessionId;
    this.currentModelId = modelId;

    this.activeLoadPromise = (async () => {
      this.status = 'checking';
      this.lastError = null;
      this.currentProgress = { progress: 0, text: 'Comprobando compatibilidad WebGPU...' };
      this.notify();

      const gpuCap = await detectWebGPUCapability();
      if (sessionId !== this.loadSessionId) return; // Sesión obsoleta

      const modelDef = getLocalModelById(modelId);
      if (!modelDef) {
        this.status = 'error';
        this.lastError = `Modelo local desconocido: ${modelId}`;
        this.notify();
        throw new Error(this.lastError);
      }

      // Validación de hardware según el backend requerido por el modelo
      if (modelDef.runtimeBackend === 'webgpu' && gpuCap.state !== 'supported') {
        this.status = 'unsupported';
        this.lastError = gpuCap.reason || 'WebGPU no está disponible en este dispositivo.';
        this.notify();
        throw new Error(this.lastError);
      }

      // Si había un modelo previo diferente o instancia existente, descargarlo primero limpiamente
      if (this.engineInstance) {
        await this.disposeInstance();
        if (sessionId !== this.loadSessionId) return;
      }

      // -------------------------------------------------------------
      // BACKEND CPU / WASM VÍA TRANSFORMERS.JS
      // -------------------------------------------------------------
      if (modelDef.runtimeBackend === 'wasm') {
        this.status = 'loading';
        this.lastError = null;
        this.currentModelId = modelId;
        this.currentBackend = 'wasm';
        this.currentProgress = { progress: 0, text: 'Iniciando runtime ONNX/WASM en CPU...' };
        this.notify();

        try {
          if (this.wasmWorker.isSupported()) {
            await this.wasmWorker.load(modelId, (p) => {
              if (sessionId !== this.loadSessionId) return;
              this.currentProgress = p;
              this.notify();
              if (onProgress) {
                try { onProgress(this.currentProgress); } catch {}
              }
            });
            if (sessionId !== this.loadSessionId) return;
            this.engineInstance = { backend: 'wasm-worker' };
          } else {
            const { pipeline, env } = await import('@huggingface/transformers');
            if (sessionId !== this.loadSessionId) return;

            env.allowLocalModels = false;
            env.useBrowserCache = true;
            if (env.backends?.onnx?.wasm) {
              env.backends.onnx.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2);
            }

            const instance = await pipeline('text-generation', modelId, {
              device: 'wasm',
              dtype: 'q4',
              progress_callback: (item: any) => {
                if (sessionId !== this.loadSessionId) return;
                if (item.status === 'progress' && item.progress !== undefined) {
                  const pct = Math.round(item.progress);
                  this.currentProgress = {
                    progress: pct,
                    text: `Descargando modelo CPU (${item.file || ''}): ${pct}%`
                  };
                  this.notify();
                  if (onProgress) {
                    try { onProgress(this.currentProgress); } catch {}
                  }
                }
              }
            });

            if (sessionId !== this.loadSessionId) return;
            this.engineInstance = instance;
          }

          this.currentBackend = 'wasm';
          this.status = 'ready';
          this.currentProgress = { progress: 100, text: 'Modelo CPU (WASM) listo para inferencia.' };
          this.notify();
          return;
        } catch (err: any) {
          if (sessionId !== this.loadSessionId) return;
          this.status = 'error';
          this.lastError = err?.message || 'Error cargando modelo CPU/WASM.';
          this.currentModelId = null;
          this.engineInstance = null;
          this.notify();
          throw err;
        }
      }

      // -------------------------------------------------------------
      // BACKEND WEBGPU VÍA MLC WEB-LLM
      // -------------------------------------------------------------
      this.status = 'loading';
      this.lastError = null;
      this.currentModelId = modelId;
      this.currentBackend = 'webgpu';
      this.currentProgress = { progress: 0, text: 'Iniciando runtime WebLLM...' };
      this.notify();

      try {
        // Importación dinámica para code-splitting
        const webllm = await import('@mlc-ai/web-llm');
        if (sessionId !== this.loadSessionId) return;

        const initProgressCallback = (report: any) => {
          if (sessionId !== this.loadSessionId) return;
          const pct = report.progress !== undefined ? Math.round(report.progress * 100) : 0;
          this.currentProgress = {
            progress: pct,
            text: report.text || 'Cargando artefactos del modelo...'
          };
          this.notify();
          if (onProgress) {
            try {
              onProgress(this.currentProgress);
            } catch {
              // Ignorar errores del callback de progreso
            }
          }
        };

        // Crear instancia del motor MLC
        const instance = await webllm.CreateMLCEngine(modelId, {
          initProgressCallback
        });

        if (sessionId !== this.loadSessionId) {
          // Si otra carga reemplazó a esta mientras se inicializaba, limpiar la instancia huérfana
          try {
            if (instance && typeof instance.unload === 'function') {
              await instance.unload();
            }
          } catch {}
          return;
        }

        this.engineInstance = instance;
        this.status = 'ready';
        this.currentProgress = { progress: 100, text: 'Modelo listo para inferencia.' };
        this.notify();
      } catch (err: any) {
        if (sessionId !== this.loadSessionId) return;
        this.status = 'error';
        const rawMsg = err?.message || String(err || '');
        if (/ShaderModule|index_kernel|compute stage|validating compute stage|WGSL/i.test(rawMsg)) {
          this.lastError = 'Incompatibilidad de shaders WebGPU con el driver gráfico para este modelo (entryPoint: index_kernel). Prueba con Llama 3.2 1B (Instruct) o el modelo CPU (WASM).';
        } else {
          this.lastError = rawMsg || 'Error desconocido al inicializar el modelo local.';
        }
        this.currentModelId = null;
        this.engineInstance = null;
        this.notify();
        throw new Error(this.lastError ?? 'Error desconocido al inicializar el modelo local.');
      }
    })();

    try {
      await this.activeLoadPromise;
    } finally {
      if (sessionId === this.loadSessionId) {
        this.activeLoadPromise = null;
      }
    }
  }

  /**
   * Genera texto con el modelo local de forma conservadora.
   *
   * API CANÓNICA del contrato `LocalModelRuntime`. Acepta tanto las opciones
   * canónicas (`maxTokens`) como el alias histórico (`max_tokens`, `stream`).
   *
   * CONTRATO DE STREAMING: `onChunk` recibe SIEMPRE deltas. Los backends que
   * generan texto acumulado (WASM, hilo principal o worker) pasan por
   * `DeltaStream`, que calcula el delta antes de invocar el callback y evita
   * emitir dos veces la respuesta final.
   */
  public async generate(
    messages: ChatMessage[],
    options?: GenerationOptions & { stream?: boolean; max_tokens?: number }
  ): Promise<string> {
    if (this.status !== 'ready' || !this.engineInstance) {
      throw new Error('El motor local no está listo. Carga el modelo antes de generar.');
    }

    this.status = 'generating';
    this.notify();

    // Parámetros conservadores pedagógicos
    const temperature = options?.temperature ?? 0.2;
    const requestedMaxTokens = options?.maxTokens ?? options?.max_tokens ?? 800;
    const max_tokens = Math.min(requestedMaxTokens, 1024);
    const onChunk = options?.onChunk;

    try {
      // -----------------------------------------------------------
      // GENERACIÓN EN CPU / WASM VÍA TRANSFORMERS.JS CON STREAMING
      // -----------------------------------------------------------
      if (this.currentBackend === 'wasm') {
        const prompt = messages
          .map(m => `<|im_start|>${m.role}\n${m.content}<|im_end|>`)
          .join('\n') + '\n<|im_start|>assistant\n';

        // En CPU configuramos 220 tokens: respuesta pedagógica ágil sin saturar el hilo
        const wasmMaxTokens = Math.min(options?.max_tokens ?? 220, 250);

        if (this.wasmWorker.isSupported() && this.engineInstance?.backend === 'wasm-worker') {
          // El worker entrega texto ACUMULADO: `DeltaStream` lo convierte en
          // deltas y garantiza que la respuesta final no se emita dos veces.
          const stream = onChunk ? new DeltaStream(onChunk) : null;
          const cleanReply = await this.wasmWorker.generate(
            prompt,
            wasmMaxTokens,
            temperature,
            accumulated => stream?.push(accumulated)
          );
          stream?.finish(cleanReply);
          this.status = 'ready';
          this.notify();
          return cleanReply;
        }

        const { TextStreamer } = await import('@huggingface/transformers');
        let accumulatedText = '';
        // Mismo contrato que en el worker: el streamer entrega deltas, se
        // acumulan y `DeltaStream` decide qué se emite realmente al consumidor.
        const deltaStream = onChunk ? new DeltaStream(onChunk) : null;

        const streamer = new TextStreamer(this.engineInstance.tokenizer, {
          skip_prompt: true,
          skip_special_tokens: true,
          callback_function: (chunk: string) => {
            accumulatedText += chunk;
            deltaStream?.push(accumulatedText);
          }
        });

        // Dar un respiro a la UI antes de arrancar los tensores de inferencia
        await new Promise(r => setTimeout(r, 10));

        const out = await this.engineInstance(prompt, {
          max_new_tokens: wasmMaxTokens,
          temperature,
          do_sample: temperature > 0,
          return_full_text: false,
          streamer
        });

        const generated = out?.[0]?.generated_text || accumulatedText || '';
        const cleanReply = stripGenerationArtifacts(
          typeof generated === 'string' ? generated : String(generated)
        );

        // Solo el sufijo que aún no se había entregado: la respuesta final no se
        // reemite por completo.
        deltaStream?.finish(cleanReply);
        this.status = 'ready';
        this.notify();
        return cleanReply;
      }

      // -----------------------------------------------------------
      // GENERACIÓN EN GPU VÍA WEB-LLM
      // -----------------------------------------------------------
      if ((options?.stream ?? !!onChunk) && onChunk) {
        const stream = await this.engineInstance.chat.completions.create({
          messages,
          temperature,
          max_tokens,
          stream: true
        });

        // WebGPU ya emite DELTAS: se entregan tal cual, sin reprocesar.
        let fullText = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        }
        this.status = 'ready';
        this.notify();
        return fullText;
      } else {
        const response = await this.engineInstance.chat.completions.create({
          messages,
          temperature,
          max_tokens,
          stream: false
        });

        const reply = response.choices[0]?.message?.content || '';
        this.status = 'ready';
        this.notify();
        return reply;
      }
    } catch (err: any) {
      // Manejar fallo de GPU o contexto
      const isGpuLoss = err?.message?.toLowerCase().includes('device lost') ||
                        err?.message?.toLowerCase().includes('device destroyed') ||
                        err?.message?.toLowerCase().includes('out of memory');
      
      if (isGpuLoss) {
        this.status = 'error';
        this.lastError = `Fallo crítico de GPU/memoria: ${err.message}. Requiere recarga del modelo.`;
        this.engineInstance = null;
        this.currentModelId = null;
      } else {
        // En error de generación estándar, volver a 'ready' para permitir reintentos sin recarga completa
        this.status = 'ready';
      }
      this.notify();
      throw err;
    }
  }


  /**
   * Alias de compatibilidad: `generateChat` delega en `generate`. No es un segundo
   * contrato; existe solo para no romper llamantes externos que usaban el nombre
   * histórico.
   */
  public async generateChat(
    messages: ChatMessage[],
    options?: GenerationOptions & { stream?: boolean }
  ): Promise<string> {
    return this.generate(messages, options);
  }

  /**
   * Iterador de deltas con el mismo contrato que `onChunk`: cada elemento es el
   * texto nuevo, nunca el acumulado.
   */
  public async *generateStream(
    messages: ChatMessage[],
    options?: GenerationOptions
  ): AsyncIterable<string> {
    const queue: string[] = [];
    let resolveWait: (() => void) | null = null;
    let finished = false;

    const wake = () => {
      resolveWait?.();
      resolveWait = null;
    };

    const generation = this.generate(messages, {
      ...options,
      stream: true,
      onChunk: (delta: string) => {
        queue.push(delta);
        wake();
      }
    }).then(
      () => { finished = true; wake(); },
      (err) => { finished = true; wake(); throw err; }
    );

    while (!finished || queue.length) {
      if (!queue.length) {
        await new Promise<void>((resolve) => { resolveWait = resolve; });
        continue;
      }
      yield queue.shift() as string;
    }

    await generation;
  }

  /**
   * Libera internamente las instancias activas de inferencia sin alterar el contador de sesión de carga.
   */
  private async disposeInstance(): Promise<void> {
    if (this.currentBackend === 'wasm') {
      try {
        await this.wasmWorker.unload();
      } catch {}
    }

    if (this.engineInstance) {
      try {
        if (typeof this.engineInstance.unload === 'function') {
          await this.engineInstance.unload();
        } else if (typeof this.engineInstance.dispose === 'function') {
          await this.engineInstance.dispose();
        }
      } catch (err) {
        console.warn('Advertencia al descargar modelo local:', err);
      }
      this.engineInstance = null;
    }
  }

  /**
   * Descarga el modelo y libera recursos de memoria/GPU limpiamente.
   */
  public async unload(): Promise<void> {
    this.loadSessionId++; // Cancelar cargas activas
    this.activeLoadPromise = null;
    this.status = 'unloading';
    this.notify();

    await this.disposeInstance();

    this.currentModelId = null;
    this.status = 'idle';
    this.currentProgress = { progress: 0, text: '' };
    this.lastError = null;
    this.notify();
  }
}

export const localLlmEngine = new LocalLlmEngine() satisfies LocalModelRuntime;

