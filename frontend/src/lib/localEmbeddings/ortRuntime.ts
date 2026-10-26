/**
 * ONNX Runtime hosting contract.
 *
 * `@huggingface/transformers` ships a default that points ONNX Runtime's WASM
 * artifacts at a public CDN. That default breaks the project's zero-web-access
 * invariant (and fails outright offline), so every entry point that creates a
 * pipeline — the main thread and the inference worker — configures the runtime
 * through this module BEFORE the pipeline exists.
 *
 * The artifacts are emitted by the build into `ort/` next to `index.html`, so
 * the resolved URL honours GitHub Pages' project subdirectory without any
 * hardcoded repository name.
 */

/** Directory (relative to `document.baseURI`) that holds the WASM artifacts. */
export const ORT_RUNTIME_DIRECTORY = 'ort';

/** Stable WASM filenames emitted by the build (see `vite.config.ts`). */
export const ORT_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.wasm'
] as const;

/**
 * JS glue modules emitted next to the WASM binaries.
 *
 * A `wasmPaths` DIRECTORY makes ONNX Runtime `import()` the glue from that
 * directory at runtime (`ort-wasm-simd-threaded.jsep.mjs`); the `.wasm` alone
 * is not enough. The proxy worker needs it too, because it boots inside a fresh
 * realm that re-imports the same glue.
 */
export const ORT_RUNTIME_GLUE_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.mjs'
] as const;

/**
 * Structural view of the Transformers.js `env` object.
 *
 * `wasm` stays `unknown` on purpose: the library declares its own
 * `WebAssemblyFlags` type (no index signature), so a stricter local interface
 * would reject the very object it hands us. It is narrowed once, locally.
 */
export interface OnnxWasmEnvTarget {
  backends?: {
    onnx?: {
      wasm?: unknown;
    };
  };
}

interface OnnxWasmFlags {
  /** A directory prefix (what this module sets) or ONNX's per-file map. */
  wasmPaths?: unknown;
  numThreads?: number;
  proxy?: boolean;
}

export interface OnnxRuntimeConfig {
  /** Page base URI (main thread: `document.baseURI`). */
  baseUri?: string;
  /** Explicit absolute artifact directory (worker: passed by the client). */
  wasmPaths?: string;
  /** `crossOriginIsolated` of the realm that will run inference. */
  crossOriginIsolated?: boolean;
  /** Overrides the derived thread count (tests). */
  numThreads?: number;
  /**
   * Runs the WASM backend inside ONNX Runtime's own worker (`wasm.proxy`).
   *
   * This is what keeps the main thread free during embedding: each forward pass
   * happens in a separate realm, so indexing no longer competes with rendering.
   * ONNX Runtime only honours it where `document` exists, and the execution
   * provider must be CPU: with `webgpu` the proxy rejects non-CPU tensors, so
   * callers enable it for the `wasm` device only.
   */
  proxy?: boolean;
}

/**
 * Absolute directory URL for the locally hosted ONNX Runtime artifacts.
 *
 * `new URL('ort/', baseURI)` keeps working under a project subdirectory
 * (`https://host/CrossedArts/` -> `https://host/CrossedArts/ort/`).
 */
export function resolveOrtRuntimeBase(baseUri?: string | null): string {
  const base = baseUri && baseUri.length > 0 ? baseUri : 'http://localhost/';
  return new URL(`${ORT_RUNTIME_DIRECTORY}/`, base).href;
}

/**
 * Threads ONNX Runtime may spawn.
 *
 * Multi-threaded WASM needs `SharedArrayBuffer`, which requires
 * `crossOriginIsolated === true` (COOP/COEP headers). GitHub Pages serves
 * without them, so the honest setting there is a single thread: requesting more
 * makes ORT fail or silently fall back, and the UI must never promise
 * multithreading the page cannot deliver.
 */
export function resolveOrtThreadCount(
  crossOriginIsolated: boolean | undefined,
  hardwareConcurrency: number | undefined
): number {
  if (!crossOriginIsolated) return 1;
  const cores = typeof hardwareConcurrency === 'number' && hardwareConcurrency > 0 ? hardwareConcurrency : 2;
  return Math.max(1, Math.min(4, cores));
}

/**
 * Points `env.backends.onnx.wasm` at the locally hosted artifacts and bounds
 * its thread count. Returns the applied `wasmPaths` (`null` when the env has no
 * ONNX backend, i.e. nothing to configure).
 *
 * Must run AFTER importing Transformers.js (the import installs the CDN
 * default) and BEFORE creating a pipeline.
 */
export function configureOnnxRuntimeWasm(
  env: OnnxWasmEnvTarget,
  config: OnnxRuntimeConfig = {}
): string | null {
  const wasm = env?.backends?.onnx?.wasm as OnnxWasmFlags | undefined;
  if (!wasm) return null;

  const paths = config.wasmPaths ?? resolveOrtRuntimeBase(config.baseUri);
  wasm.wasmPaths = paths;
  wasm.numThreads =
    config.numThreads ??
    resolveOrtThreadCount(
      config.crossOriginIsolated ?? (globalThis as any)?.crossOriginIsolated,
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined
    );
  // Set explicitly (never left to a previous realm's value) so the main thread
  // and the proxy worker cannot disagree about who runs the inference.
  wasm.proxy = config.proxy === true;
  return paths;
}
