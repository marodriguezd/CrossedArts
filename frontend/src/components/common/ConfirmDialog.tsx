import React, { useEffect, useId, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  /** Descripción explícita de la consecuencia de la acción. */
  consequence: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Diálogo de confirmación accesible y reutilizable para acciones destructivas.
 * No es un framework de diálogos: solo cubre la confirmación segura.
 *
 * Accesibilidad:
 * - `role="dialog"` + `aria-modal` con título y consecuencia enlazados.
 * - Escape cancela.
 * - El foco inicial va al botón Cancelar, de modo que pulsar Enter nunca
 *   confirma por accidente.
 * - Al cerrar, el foco se restaura al elemento que lo abrió.
 */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  isOpen,
  title,
  consequence,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  onCancel
}) => {
  const titleId = useId();
  const descId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    previouslyFocused.current = (typeof document !== 'undefined' ? document.activeElement : null) as HTMLElement | null;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    const focusTimer = setTimeout(() => cancelRef.current?.focus(), 20);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(focusTimer);
      previouslyFocused.current?.focus?.();
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md space-y-4 rounded-xl border border-line bg-raised p-5 shadow-pop"
      >
        <div className="flex items-start gap-3">
          <div className={`shrink-0 rounded-lg border p-2 ${tone === 'danger' ? 'border-error/30 bg-error-soft text-error' : 'border-accent/30 bg-accent-soft text-accent'}`}>
            <AlertTriangle size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="type-section text-ink">{title}</h2>
            <p id={descId} className="mt-1.5 text-body leading-relaxed text-muted">{consequence}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-line pt-3">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-9 rounded-lg border border-line-strong bg-surface px-4 text-secondary font-medium text-ink transition-colors hover:bg-accent-soft/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-9 rounded-lg px-4 text-secondary font-medium text-on-accent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${tone === 'danger' ? 'bg-error hover:opacity-90' : 'bg-accent hover:opacity-90'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
