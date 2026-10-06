import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './', // Vital para GitHub Pages (rutas relativas)
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
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
          if (id.includes('sql.js')) return 'vendor-sqljs';
          if (id.includes('lucide-react')) return 'vendor-icons';
          if (id.includes('react-dom') || id.includes('/react/')) return 'vendor-react';
          return undefined;
        }
      }
    }
  },
  optimizeDeps: {
    exclude: ['sql.js']
  }
});
