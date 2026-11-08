import React from 'react';
import { Check, Edit3, Sparkles } from 'lucide-react';
import type { Book } from '../../types/models.ts';
import { adjustBookPage } from '../../services/domainLogic.ts';
import { Button } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export interface BookMetaFormData {
  author: string;
  pageCount: string;
}

export interface BookProgressEditorProps {
  book: Book;
  isEditingMeta: boolean;
  onToggleMeta: () => void;
  metaForm: BookMetaFormData;
  onMetaFormChange: React.Dispatch<React.SetStateAction<BookMetaFormData>>;
  onSaveMeta: (book: Book) => void;
  isEditingProgress: boolean;
  onToggleProgress: () => void;
  inputPage: string;
  onInputPageChange: (val: string) => void;
  onSaveProgress: (book: Book) => void;
  onExplain?: () => void;
}

export const BookProgressEditor: React.FC<BookProgressEditorProps> = ({
  book,
  isEditingMeta,
  onToggleMeta,
  metaForm,
  onMetaFormChange,
  onSaveMeta,
  isEditingProgress,
  onToggleProgress,
  inputPage,
  onInputPageChange,
  onSaveProgress,
  onExplain,
}) => {
  const { t } = useLanguage();

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-3 pt-1">
        {onExplain && (
          <button
            type="button"
            onClick={onExplain}
            className="flex items-center gap-0.5 text-meta text-accent hover:opacity-80"
          >
            <Sparkles size={11} aria-hidden="true" /> Explicar
          </button>
        )}
        <button
          type="button"
          onClick={onToggleMeta}
          className="flex items-center gap-0.5 text-meta text-muted hover:text-ink"
        >
          <Edit3 size={11} aria-hidden="true" /> Metadatos
        </button>
      </div>

      {isEditingMeta && (
        <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-canvas p-2">
          <label className="sr-only" htmlFor={`meta-author-${book.id}`}>
            Autor del libro
          </label>
          <input
            id={`meta-author-${book.id}`}
            type="text"
            value={metaForm.author}
            onChange={(e) => onMetaFormChange((f) => ({ ...f, author: e.target.value }))}
            placeholder="Autor"
            className="w-full rounded-md border border-line bg-surface px-2 py-1 text-meta text-ink focus:border-accent/50 focus:outline-none"
          />
          <div className="flex items-center gap-1.5">
            <label className="sr-only" htmlFor={`meta-pages-${book.id}`}>
              Páginas totales
            </label>
            <input
              id={`meta-pages-${book.id}`}
              type="number"
              min="1"
              value={metaForm.pageCount}
              onChange={(e) => onMetaFormChange((f) => ({ ...f, pageCount: e.target.value }))}
              placeholder={t('library.pagesPlaceholder')}
              className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-right text-meta text-ink focus:border-accent/50 focus:outline-none"
            />
            <span className="text-meta">páginas totales</span>
            <Button size="sm" variant="solid" className="ml-auto" onClick={() => onSaveMeta(book)}>
              <Check size={11} aria-hidden="true" /> Guardar
            </Button>
          </div>
        </div>
      )}

      {isEditingProgress && (
        <div className="mt-2 space-y-2.5 rounded-xl border border-accent/40 bg-accent-soft/30 p-3 shadow-sm">
          <div className="flex items-center justify-between text-meta">
            <span className="font-semibold text-ink">Progreso de lectura</span>
            <span className="font-semibold text-accent">
              {Math.round(((parseInt(inputPage, 10) || 0) / (book.page_count || 1)) * 100)}%
            </span>
          </div>

          <div className="space-y-1">
            <input
              type="range"
              min="0"
              max={book.page_count}
              value={parseInt(inputPage, 10) || 0}
              onChange={(e) => onInputPageChange(e.target.value)}
              className="w-full accent-accent cursor-pointer"
              aria-label={`Deslizador de lectura para ${book.title}`}
            />
            <div className="flex items-center justify-between text-micro text-muted">
              <span>0 pág</span>
              <span className="font-medium text-ink">
                Página {parseInt(inputPage, 10) || 0} de {book.page_count}
              </span>
              <span>{book.page_count} pág</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
            <button
              type="button"
              onClick={() =>
                onInputPageChange(
                  String(adjustBookPage(parseInt(inputPage, 10) || 0, 10, book.page_count ?? 0))
                )
              }
              className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
              title={t('library.advance10')}
            >
              +10 pág
            </button>
            <button
              type="button"
              onClick={() =>
                onInputPageChange(
                  String(adjustBookPage(parseInt(inputPage, 10) || 0, 25, book.page_count ?? 0))
                )
              }
              className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
              title={t('library.advance25')}
            >
              +25 pág
            </button>
            <button
              type="button"
              onClick={() =>
                onInputPageChange(
                  String(adjustBookPage(parseInt(inputPage, 10) || 0, 50, book.page_count ?? 0))
                )
              }
              className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
              title={t('library.advance50')}
            >
              +50 pág
            </button>
            <button
              type="button"
              onClick={() => onInputPageChange(String(book.page_count))}
              className="rounded-md border border-success/40 bg-success-soft px-2 py-0.5 text-micro font-medium text-success hover:opacity-80 transition-colors cursor-pointer"
              title="Marcar libro como completado"
            >
              Terminado (100%)
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-2">
            <div className="flex items-center gap-1.5">
              <label htmlFor={`page-input-${book.id}`} className="text-micro text-muted">
                Pág:
              </label>
              <input
                id={`page-input-${book.id}`}
                type="number"
                min="0"
                max={book.page_count}
                value={inputPage}
                onChange={(e) => onInputPageChange(e.target.value)}
                className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-right text-meta text-ink focus:border-accent/50 focus:outline-none"
              />
              <span className="text-meta text-muted">/ {book.page_count}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="quiet" onClick={onToggleProgress}>
                Cancelar
              </Button>
              <Button size="sm" variant="solid" onClick={() => onSaveProgress(book)}>
                <Check size={12} aria-hidden="true" /> Guardar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
