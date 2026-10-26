import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Directory (relative to `dist`) where the ONNX Runtime WASM artifacts are
 * emitted with STABLE names.
 */
const ORT_RUNTIME_DIRECTORY = 'ort';

/**
 * Artifacts copied from `node_modules/onnxruntime-web/dist`.
 *
 * `jsep` is the build Transformers.js bundles (it carries the WebGPU/JS
 * execution provider); the plain threaded build is kept as the CPU fallback.
 * Both keep their upstream filenames because ONNX Runtime derives the request
 * name from the build it was compiled with.
 */
const ORT_RUNTIME_FILES = [
  'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.wasm'
];

/**
 * JS glue modules that pair with the WASM binaries.
 *
 * ONNX Runtime receives `wasmPaths` as a DIRECTORY, so at runtime it does
 * `import('<wasmPaths>ort-wasm-simd-threaded.jsep.mjs')`; if that module is not
 * served from our own origin, the pipeline cannot start offline (and the proxy
 * worker cannot boot at all). `vite dev` needs them served too.
 */
const ORT_RUNTIME_GLUE_FILES = [
  'ort-wasm-simd-threaded.jsep.mjs',
  'ort-wasm-simd-threaded.mjs'
];

/** Everything the browser may request under `ort/`. */
const ORT_RUNTIME_SERVED_FILES = [...ORT_RUNTIME_FILES, ...ORT_RUNTIME_GLUE_FILES];

const ORT_DIST_DIRECTORY = fileURLToPath(new URL('./node_modules/onnxruntime-web/dist/', import.meta.url));

/**
 * Serves the ONNX Runtime artifacts from the local install in `vite dev`, so
 * development and production resolve the same relative `ort/` path.
 */
function serveOrtRuntimeInDev(): Plugin {
  return {
    name: 'crossedarts:serve-ort-runtime',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = (req.url || '').split('?')[0];
        const prefix = `/${ORT_RUNTIME_DIRECTORY}/`;
        if (!pathname.startsWith(prefix)) return next();

        const file = pathname.slice(prefix.length);
        if (!ORT_RUNTIME_SERVED_FILES.includes(file)) return next();

        readFile(path.join(ORT_DIST_DIRECTORY, file))
          .then((body) => {
            res.setHeader(
              'Content-Type',
              file.endsWith('.mjs') ? 'text/javascript' : 'application/wasm'
            );
            res.setHeader('Content-Length', String(body.byteLength));
            res.end(body);
          })
          .catch(() => next());
      });
    }
  };
}

/**
 * Emits the ONNX Runtime artifacts under `dist/ort/` with stable names.
 *
 * Two things are done here, both required for real offline support:
 *
 * 1. The runtime WASM is copied next to `index.html`, so `wasmPaths` can point
 *    at the site's own origin instead of the CDN that Transformers.js installs
 *    by default.
 * 2. Rollup's own hashed copy of that same 21 MB binary is dropped: every
 *    pipeline is configured with the stable `ort/` directory (main thread and
 *    worker), so the hashed duplicate would only double the deploy size.
 */
function emitOrtRuntime(): Plugin {
  return {
    name: 'crossedarts:emit-ort-runtime',
    apply: 'build',
    async generateBundle(_options, bundle) {
      for (const fileName of ORT_RUNTIME_SERVED_FILES) {
        let source: Buffer;
        try {
          source = await readFile(path.join(ORT_DIST_DIRECTORY, fileName));
        } catch (err) {
          this.warn(`No se pudo leer el runtime ONNX ${fileName}: ${String(err)}`);
          continue;
        }
        this.emitFile({
          type: 'asset',
          fileName: `${ORT_RUNTIME_DIRECTORY}/${fileName}`,
          source
        });
      }

      // Rollup emits the statically referenced WASM with a content hash. It is
      // the same binary just emitted under a stable name above.
      for (const chunkName of Object.keys(bundle)) {
        if (/^assets\/ort-wasm-.*\.wasm$/.test(chunkName)) {
          delete bundle[chunkName];
        }
      }
    }
  };
}

/**
 * Transformers.js hard-codes its CDN artifact base at import time:
 * `https://cdn.jsdelivr.net/npm/@huggingface/transformers@<version>/dist/`.
 *
 * The runtime override in `ortRuntime.ts` is authoritative, but a build that
 * still carries the CDN URL can silently reach out to the network if a new
 * entry point forgets to configure the env. The default is therefore rewritten
 * to the relative local directory, which also happens to be correct when the
 * app is served from a project subdirectory.
 */
const TRANSFORMERS_CDN_BASE = /https:\/\/cdn\.jsdelivr\.net\/npm\/@huggingface\/transformers@[^`"']*\/dist\//g;

function localizeTransformersArtifactBase(): Plugin {
  return {
    name: 'crossedarts:localize-transformers-artifacts',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('@huggingface/transformers')) return null;
      if (!code.includes('cdn.jsdelivr.net')) return null;
      const rewritten = code.replace(TRANSFORMERS_CDN_BASE, './ort/');
      return rewritten === code ? null : { code: rewritten, map: null };
    },
    /**
     * The inference worker is bundled in its own Rollup pass, so the `transform`
     * hook above does not see it. The emitted chunks are swept once the build
     * has finished; the sweep is idempotent and only rewrites the CDN default.
     */
    async closeBundle() {
      const assetsDir = path.join(fileURLToPath(new URL('.', import.meta.url)), 'dist', 'assets');
      let entries: string[];
      try {
        entries = await readdir(assetsDir);
      } catch {
        return;
      }
      for (const name of entries) {
        if (!name.endsWith('.js')) continue;
        const filePath = path.join(assetsDir, name);
        const content = await readFile(filePath, 'utf8');
        if (!content.includes('cdn.jsdelivr.net')) continue;
        const rewritten = content.replace(TRANSFORMERS_CDN_BASE, './ort/');
        if (rewritten !== content) await writeFile(filePath, rewritten);
      }
    }
  };
}

/** Everything the shell needs offline, independent of the emitted chunks. */
const STATIC_SHELL_ASSETS = ['./', './index.html', './favicon.svg', './manifest.json', './sql-wasm.wasm'];

/**
 * Injects the real chunk list into `dist/sw.js`.
 *
 * The service worker lives in `public/`, so it is copied verbatim and cannot
 * import the Vite manifest. Without an injected list it can only discover the
 * entry assets referenced by `index.html`, which is exactly why opening a lazy
 * view offline used to fail: its chunk had never been requested.
 *
 * The injected build id also makes `sw.js` byte-different on every deploy, which
 * is what tells the browser an update exists.
 */
function injectServiceWorkerManifest(): Plugin {
  return {
    name: 'crossedarts:inject-sw-manifest',
    apply: 'build',
    async closeBundle() {
      const root = fileURLToPath(new URL('.', import.meta.url));
      const distDir = path.join(root, 'dist');
      const manifestPath = path.join(distDir, '.vite', 'manifest.json');

      let manifest: Record<string, { file?: string; css?: string[]; assets?: string[] }>;
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch (err) {
        this.warn(`No se pudo leer el manifest de Vite; el precache queda incompleto: ${String(err)}`);
        return;
      }

      const chunks = new Set<string>();
      // The manifest describes the module graph (entry + lazy chunks); the
      // directory scan also catches bundles Rollup emits outside that graph,
      // such as the inference worker (`wasmWorker-*.js`).
      for (const entry of Object.values(manifest)) {
        if (entry?.file && /\.(?:js|mjs|css)$/.test(entry.file)) chunks.add(`./${entry.file}`);
        for (const css of entry?.css ?? []) chunks.add(`./${css}`);
        for (const asset of entry?.assets ?? []) {
          if (/\.(?:js|mjs|css|woff2?|svg|png)$/.test(asset)) chunks.add(`./${asset}`);
        }
      }
      try {
        for (const file of await readdir(path.join(distDir, 'assets'))) {
          if (/\.(?:js|mjs|css)$/.test(file)) chunks.add(`./assets/${file}`);
        }
      } catch {
        /* sin assets no hay nada extra que precachear */
      }

      const assets = Array.from(chunks).sort();
      const buildId = createHash('sha256')
        .update([...STATIC_SHELL_ASSETS, ...assets].join('\n'))
        .digest('hex')
        .slice(0, 12);

      const swPath = path.join(distDir, 'sw.js');
      let sw = await readFile(swPath, 'utf8');
      sw = sw.replace("/*__BUILD_ID__*/ 'dev'", JSON.stringify(buildId));
      sw = sw.replace('/*__PRECACHE_ASSETS__*/ []', JSON.stringify(assets));
      await writeFile(swPath, sw);
    }
  };
}

export default defineConfig({
  plugins: [
    react(),
    serveOrtRuntimeInDev(),
    emitOrtRuntime(),
    localizeTransformersArtifactBase(),
    injectServiceWorkerManifest()
  ],
  base: './', // Vital para GitHub Pages (rutas relativas)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    // El service worker necesita la lista completa de chunks emitidos para
    // precachear también las vistas perezosas.
    manifest: true,
    rollupOptions: {
      output: {
        // Separa las dependencias pesadas (LLM local, transformers, grafo, sql.js)
        // en chunks propios: mantiene pequeño el bundle inicial y permite que
        // cada motor se cargue de forma perezosa cuando se usa de verdad.
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('@mlc-ai/web-llm')) return 'vendor-webllm';
          if (id.includes('@huggingface/transformers') || id.includes('onnxruntime')) {
            return 'vendor-transformers';
          }
          if (id.includes('vis-network') || id.includes('vis-data')) return 'vendor-graph';
          if (id.includes('pdfjs-dist')) return 'vendor-pdfjs';
          if (id.includes('sql.js')) return 'vendor-sqljs';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          return undefined;
        }
      }
    }
  }
});
