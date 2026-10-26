import { pipeline, env, TextStreamer } from '@huggingface/transformers';
import { configureOnnxRuntimeWasm, resolveOrtRuntimeBase } from '../localEmbeddings/ortRuntime.ts';

// ONNX WASM environment inside the inference Worker: models resolve from the
// Hub and cache in the browser, and the runtime itself is served from this same
// origin. The worker has no `document`, so the artifact base either comes from
// the client (`load` payload) or defaults to the origin root.
env.allowLocalModels = false;
env.useBrowserCache = true;
const configureRuntime = (wasmPaths?: string) => {
  configureOnnxRuntimeWasm(env, {
    wasmPaths: wasmPaths || resolveOrtRuntimeBase(typeof self !== 'undefined' ? self.location?.href : undefined)
  });
};
configureRuntime();

let generator: any = null;
let loadedModelId: string | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { id, type, payload } = e.data || {};

  try {
    if (type === 'load') {
      const { modelId, wasmPaths } = payload;
      // Re-applied per load: the first `load` carries the page's base URI, so
      // the artifacts resolve under a project subdirectory too.
      if (wasmPaths) configureRuntime(wasmPaths);
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
