import React from 'react';
import { FileUp, X, AlertTriangle, Loader2, Check } from 'lucide-react';
import type { Course } from '../../types/models.ts';
import type { ParsedDocument, ResourceDestinationType } from '../../lib/localIngestion/types.ts';
import { Button, InlineStatus, INPUT_CLS } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

const LABEL_CLS = 'block text-meta font-medium text-ink mb-1';

export interface DocumentPreviewData {
  file: File;
  parsed: ParsedDocument;
  isDuplicate: boolean;
  existingResourceId?: string;
}

export interface DocumentImportModalProps {
  previewDoc: DocumentPreviewData | null;
  previewDestinationType: ResourceDestinationType;
  onDestinationTypeChange: (type: ResourceDestinationType) => void;
  previewTargetId: string;
  onTargetIdChange: (id: string) => void;
  previewEnableSemantic: boolean;
  onEnableSemanticChange: (enabled: boolean) => void;
  isImporting: boolean;
  courses: Course[];
  onClose: () => void;
  onConfirm: () => void;
}

export const DocumentImportModal: React.FC<DocumentImportModalProps> = ({
  previewDoc,
  previewDestinationType,
  onDestinationTypeChange,
  previewTargetId,
  onTargetIdChange,
  previewEnableSemantic,
  onEnableSemanticChange,
  isImporting,
  courses,
  onClose,
  onConfirm,
}) => {
  const { t } = useLanguage();

  if (!previewDoc) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="preview-title"
        className="max-h-[90vh] w-full max-w-lg animate-fade-in space-y-4 overflow-y-auto rounded-xl border border-line bg-raised p-6 shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h3 id="preview-title" className="type-section flex items-center gap-2 text-ink">
            <FileUp size={17} className="text-accent" aria-hidden="true" /> Previsualización de importación
          </h3>
          <button
            onClick={onClose}
            aria-label={t('library.closePreview')}
            className="text-faint hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-2.5 text-body">
          <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-canvas p-3 text-meta">
            <div>
              <dt className="text-faint">Archivo:</dt>
              <dd className="break-all font-semibold text-ink">{previewDoc.parsed.fileName}</dd>
            </div>
            <div>
              <dt className="text-faint">Formato:</dt>
              <dd className="font-semibold uppercase text-accent">{previewDoc.parsed.fileType}</dd>
            </div>
            <div>
              <dt className="text-faint">Título detectado:</dt>
              <dd className="font-semibold text-ink">{previewDoc.parsed.title}</dd>
            </div>
            <div>
              <dt className="text-faint">Autor:</dt>
              <dd className="text-muted">{previewDoc.parsed.author || 'No especificado'}</dd>
            </div>
            <div>
              <dt className="text-faint">Páginas/Secciones:</dt>
              <dd className="font-semibold text-ink">
                {previewDoc.parsed.pageCount || previewDoc.parsed.sections.length}
              </dd>
            </div>
            <div>
              <dt className="text-faint">Palabras aproximadas:</dt>
              <dd className="font-semibold text-ink">{previewDoc.parsed.estimatedWords || '~'}</dd>
            </div>
          </dl>

          {previewDoc.isDuplicate && (
            <InlineStatus tone="warning">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Documento ya existente.</strong> Este archivo tiene la misma huella SHA-256
                que un recurso ya registrado en CrossedArts.
              </span>
            </InlineStatus>
          )}

          <div className="space-y-1.5 pt-1">
            <label className={LABEL_CLS} htmlFor="preview-destination">
              Destino del recurso:
            </label>
            <select
              id="preview-destination"
              value={previewDestinationType}
              onChange={(e) => onDestinationTypeChange(e.target.value as ResourceDestinationType)}
              className={INPUT_CLS}
            >
              <option value="standalone">Recurso independiente (Standalone)</option>
              <option value="book">Nuevo libro / manual en Biblioteca</option>
              <option value="course">Asociar a curso existente</option>
              <option value="lesson">Asociar a lección existente</option>
            </select>
          </div>

          {previewDestinationType === 'course' && (
            <div className="space-y-1">
              <label className={LABEL_CLS} htmlFor="preview-target">
                Selecciona el curso:
              </label>
              <select
                id="preview-target"
                value={previewTargetId}
                onChange={(e) => onTargetIdChange(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">-- Elige un curso --</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center justify-between rounded-lg border border-line bg-canvas p-2.5">
            <label htmlFor="preview-semantic" className="text-meta font-medium text-ink">
              Indexación semántica en segundo plano
            </label>
            <input
              id="preview-semantic"
              type="checkbox"
              checked={previewEnableSemantic}
              onChange={(e) => onEnableSemanticChange(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-accent"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
          <Button variant="quiet" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="solid"
            onClick={onConfirm}
            disabled={isImporting || previewDoc.isDuplicate}
          >
            {isImporting ? (
              <Loader2 size={14} className="animate-spin" aria-hidden="true" />
            ) : (
              <Check size={14} aria-hidden="true" />
            )}
            Importar a CrossedArts
          </Button>
        </div>
      </div>
    </div>
  );
};
