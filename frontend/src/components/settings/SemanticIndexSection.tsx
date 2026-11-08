import React from 'react';
import { Database, RefreshCw, RotateCcw, Trash2 } from 'lucide-react';
import { EMBEDDING_MODELS_REGISTRY } from '../../lib/localEmbeddings/registry.ts';
import type { EmbeddingRuntimeBackend, EmbeddingEngineStatus } from '../../lib/localEmbeddings/engine.ts';
import { Badge, Button, INPUT_CLS } from '../ui/index.tsx';

const LABEL_CLS = 'block text-meta font-medium text-ink mb-1';

export interface SemanticIndexSectionProps {
  selectedEmbeddingModel: string;
  onSelectEmbeddingModel: (modelId: string) => void;
  selectedEmbeddingModelDef: (typeof EMBEDDING_MODELS_REGISTRY)[number] | undefined;
  embBackend: EmbeddingRuntimeBackend;
  embStatus: EmbeddingEngineStatus;
  embCount: number;
  onReleaseMemory: () => void;
  onClearCache: () => void;
  onCancelIndexing: () => void;
  onBuildIndex: () => void;
  indexingText: string | null;
  embError: string | null;
}

export const SemanticIndexSection: React.FC<SemanticIndexSectionProps> = ({
  selectedEmbeddingModel,
  onSelectEmbeddingModel,
  selectedEmbeddingModelDef,
  embBackend,
  embStatus,
  embCount,
  onReleaseMemory,
  onClearCache,
  onCancelIndexing,
  onBuildIndex,
  indexingText,
  embError,
}) => {
  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="flex items-center gap-1.5 text-item text-ink">
            <Database size={14} className="text-accent" aria-hidden="true" />
            Índice semántico local (embeddings en navegador)
          </h4>
          <p className="type-meta mt-0.5 max-w-xl">
            La búsqueda semántica se prepara e indexa automáticamente al usarla o al importar
            contenido. Este panel es una acción avanzada de mantenimiento o recuperación.
          </p>
        </div>
        <div className="flex items-center gap-2 text-meta">
          <span className="font-mono text-muted">{embCount}</span>
          <span className="text-faint">fragmentos en caché</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className={LABEL_CLS} htmlFor="embedding-model">
          Modelo de embeddings para búsqueda semántica
        </label>
        <select
          id="embedding-model"
          value={selectedEmbeddingModel}
          onChange={(e) => onSelectEmbeddingModel(e.target.value)}
          className={INPUT_CLS}
        >
          <optgroup label="Recomendados y multilingües">
            {EMBEDDING_MODELS_REGISTRY.filter((m) => m.recommended || m.tier === 'advanced').map(
              (m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.downloadSizeApprox} ({m.dimensions || m.dimension}d)
                  {m.recommended ? ' · RECOMENDADO' : ''}
                </option>
              )
            )}
          </optgroup>
          <optgroup label="Otros modelos de embeddings">
            {EMBEDDING_MODELS_REGISTRY.filter((m) => !m.recommended && m.tier !== 'advanced').map(
              (m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.downloadSizeApprox} ({m.dimensions || m.dimension}d)
                </option>
              )
            )}
          </optgroup>
        </select>
        {selectedEmbeddingModelDef && (
          <div className="rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
            <p className="text-ink">{selectedEmbeddingModelDef.description}</p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-micro text-faint">
              <Badge tone={embBackend === 'webgpu' ? 'accent' : 'neutral'}>
                {embBackend === 'webgpu'
                  ? 'WebGPU (GPU)'
                  : embBackend === 'wasm'
                    ? 'CPU · WASM'
                    : 'Sin cargar'}
              </Badge>
              {selectedEmbeddingModelDef.preferredBackend === 'wasm' && (
                <span>Este modelo se ejecuta siempre en CPU/WASM.</span>
              )}
            </p>
            <p className="mt-1 text-micro text-faint">
              Dimensión vectorial:{' '}
              {selectedEmbeddingModelDef.dimensions || selectedEmbeddingModelDef.dimension}d · Idiomas:{' '}
              {selectedEmbeddingModelDef.languages} · Licencia: {selectedEmbeddingModelDef.license}
            </p>
          </div>
        )}
      </div>

      <div className="space-y-2 rounded-lg border border-line bg-canvas p-3 text-meta text-muted">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong className="text-ink">Aislamiento de vectores:</strong> Los embeddings se
            persisten en una base de datos IndexedDB dedicada (
            <span className="font-mono text-accent">CrossedArts_Embeddings</span>). Tu SQLite
            canónico permanece ligero y libre de matrices binarias.
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {embStatus === 'ready' && (
              <Button size="sm" variant="quiet" onClick={onReleaseMemory}>
                <Trash2 size={12} aria-hidden="true" /> Liberar memoria
              </Button>
            )}
            {embCount > 0 && (
              <Button size="sm" variant="quiet" onClick={onClearCache}>
                <Trash2 size={12} aria-hidden="true" /> Vaciar caché
              </Button>
            )}
            {embStatus === 'embedding' ? (
              <Button size="sm" variant="danger" onClick={onCancelIndexing}>
                <RotateCcw size={12} aria-hidden="true" /> Cancelar
              </Button>
            ) : (
              <Button
                size="sm"
                variant="solid"
                disabled={embStatus === 'loading'}
                onClick={onBuildIndex}
              >
                {embStatus === 'loading' ? (
                  <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Database size={12} aria-hidden="true" />
                )}
                {embStatus === 'loading' ? 'Preparando…' : 'Reindexar contenido (avanzado)'}
              </Button>
            )}
          </div>
        </div>

        {indexingText && (
          <div className="flex items-center gap-1.5 pt-1 text-accent">
            <RefreshCw size={12} className="animate-spin" aria-hidden="true" />
            <span>{indexingText}</span>
          </div>
        )}

        {embError && <div className="pt-1 text-error">⚠️ {embError}</div>}
      </div>
    </div>
  );
};
