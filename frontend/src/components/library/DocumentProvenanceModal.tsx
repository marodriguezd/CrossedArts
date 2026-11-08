import React from 'react';
import { Bookmark, X } from 'lucide-react';
import type { LearningResource } from '../../types/models.ts';
import { Button } from '../ui/index.tsx';

export interface DocumentSourceMeta {
  resource: LearningResource | null;
  sourceType: string;
  fileName?: string;
  fingerprint?: string;
  sectionCount: number;
  notesCount: number;
}

export interface DocumentProvenanceModalProps {
  isOpen: boolean;
  data?: DocumentSourceMeta;
  onClose: () => void;
}

export const DocumentProvenanceModal: React.FC<DocumentProvenanceModalProps> = ({
  isOpen,
  data,
  onClose,
}) => {
  if (!isOpen || !data) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="source-title"
        className="w-full max-w-md animate-fade-in space-y-4 rounded-xl border border-line bg-raised p-6 shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h3 id="source-title" className="type-section flex items-center gap-2 text-ink">
            <Bookmark size={17} className="text-accent" aria-hidden="true" /> Origen del recurso
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar visor de origen"
            className="text-faint hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <dl className="space-y-2 rounded-lg border border-line bg-canvas p-3 text-meta">
          <div>
            <dt className="text-faint">Título:</dt>
            <dd className="font-semibold text-ink">{data.resource?.title}</dd>
          </div>
          <div>
            <dt className="text-faint">Tipo de fuente:</dt>
            <dd className="font-semibold text-accent">{data.sourceType}</dd>
          </div>
          {data.fileName && (
            <div>
              <dt className="text-faint">Archivo original:</dt>
              <dd className="break-all font-mono text-ink">{data.fileName}</dd>
            </div>
          )}
          {data.fingerprint && (
            <div>
              <dt className="text-faint">Huella digital (SHA-256):</dt>
              <dd className="break-all font-mono text-muted">{data.fingerprint}</dd>
            </div>
          )}
          <div>
            <dt className="text-faint">Fragmentos de estudio creados:</dt>
            <dd className="font-semibold text-success">{data.sectionCount} fragmentos</dd>
          </div>
        </dl>

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </div>
      </div>
    </div>
  );
};
