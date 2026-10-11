import { test } from 'node:test';
import assert from 'node:assert';
import {
  LOCAL_MODELS_REGISTRY,
  getLocalModelById,
  DEFAULT_LOCAL_MODEL_ID,
  DEFAULT_WASM_MODEL_ID
} from '../src/lib/localLlm/registry.ts';
import {
  detectBrowserFamily,
  detectOsPlatform
} from '../src/lib/localLlm/browserDetection.ts';

test('WebGPU Models Registry: Validates multilingual focus and Spanish support', () => {
  assert.ok(LOCAL_MODELS_REGISTRY.length >= 6, 'Debe haber al menos 6 modelos en el catálogo');

  // Comprobar que el modelo multilingüe recomendado soporta español y otros idiomas
  const defaultModel = getLocalModelById(DEFAULT_LOCAL_MODEL_ID);
  assert.ok(defaultModel, 'El modelo por defecto debe existir');
  assert.ok(defaultModel.languages?.includes('es'), 'Debe incluir español');
  assert.strictEqual(defaultModel.category, 'multilingual');

  // Comprobar Qwen2.5 1.5B Instruct
  const qwen25 = getLocalModelById('Qwen2.5-1.5B-Instruct-q4f16_1-MLC');
  assert.ok(qwen25, 'Qwen2.5-1.5B debe estar registrado en el catálogo');
  assert.ok(qwen25.languages?.includes('es'));
  assert.ok(qwen25.languages?.includes('fr'));
  assert.ok(qwen25.languages?.includes('pt'));
  assert.strictEqual(qwen25.category, 'multilingual');

  // Comprobar modelo WASM por defecto (CPU)
  const wasmModel = getLocalModelById(DEFAULT_WASM_MODEL_ID);
  assert.ok(wasmModel, 'El modelo CPU por defecto debe existir');
  assert.strictEqual(wasmModel.runtimeBackend, 'wasm');
  assert.strictEqual(wasmModel.category, 'cpu_wasm');
  assert.ok(wasmModel.languages?.includes('es'));
});

test('WebGPU Diagnostic: Validates browser and OS platform detection heuristics', () => {
  // Brave on Linux
  const braveNav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    brave: { isBrave: () => true }
  };
  assert.strictEqual(detectBrowserFamily(braveNav), 'brave');
  assert.strictEqual(detectOsPlatform(braveNav), 'linux');

  // Firefox on Windows
  const firefoxNav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:122.0) Gecko/20100101 Firefox/122.0'
  };
  assert.strictEqual(detectBrowserFamily(firefoxNav), 'firefox');
  assert.strictEqual(detectOsPlatform(firefoxNav), 'windows');

  // Safari on macOS
  const safariNav = {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15'
  };
  assert.strictEqual(detectBrowserFamily(safariNav), 'safari');
  assert.strictEqual(detectOsPlatform(safariNav), 'macos');

  // Edge
  const edgeNav = {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0'
  };
  assert.strictEqual(detectBrowserFamily(edgeNav), 'edge');

  // Chrome on Linux
  const chromeNav = {
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  assert.strictEqual(detectBrowserFamily(chromeNav), 'chrome');
  assert.strictEqual(detectOsPlatform(chromeNav), 'linux');
});
