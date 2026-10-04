import { pipeline, env, TextStreamer } from '@huggingface/transformers';

// Configurar entorno ONNX WASM en el Worker (hilo secundario)
env.allowLocalModels = false;
env.useBrowserCache = true;
if (env.backends?.onnx?.wasm) {
  env.backends.onnx.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 2) : 2);
}

let generator: any = null;
let loadedModelId: string | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data || {};

  try {
    if (type === 'load') {
      const { modelId } = payload;
      if (generator && loadedModelId === modelId) {
        self.postMessage({ id, type: 'load-success' });
        return;
      }

      generator = await pipeline('text-generation', modelId, {
        device: 'wasm',
        dtype: 'q4',
        progress_callback: (item: any) => {
          if (item.status === 'progress' && item.progress !== undefined) {
            self.postMessage({
              id,
              type: 'progress',
              payload: {
                progress: Math.round(item.progress),
                text: `Descargando modelo CPU (${item.file || ''}): ${Math.round(item.progress)}%`
              }
            });
          }
        }
      });

      loadedModelId = modelId;
      self.postMessage({ id, type: 'load-success' });
    } else if (type === 'generate') {
      if (!generator) {
        throw new Error('El modelo CPU (WASM) no está inicializado.');
      }

      const { prompt, maxTokens, temperature } = payload;
      let accumulatedText = '';

      const streamer = new TextStreamer(generator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (chunk: string) => {
          accumulatedText += chunk;
          self.postMessage({
            id,
            type: 'chunk',
            payload: { chunk, accumulatedText }
          });
        }
      });

      const out = await generator(prompt, {
        max_new_tokens: maxTokens,
        temperature,
        do_sample: temperature > 0,
        return_full_text: false,
        streamer
      });

      const generated = out?.[0]?.generated_text || accumulatedText || '';
      const cleanReply = (typeof generated === 'string'
        ? generated.replace(/<\|im_end\|>.*$/s, '').replace(/<\|endoftext\|>.*$/s, '')
        : String(generated)
      ).trim();

      self.postMessage({ id, type: 'generate-success', payload: { text: cleanReply } });
    } else if (type === 'unload') {
      generator = null;
      loadedModelId = null;
      self.postMessage({ id, type: 'unload-success' });
    }
  } catch (err: any) {
    self.postMessage({ id, type: 'error', error: err?.message || String(err) });
  }
};
