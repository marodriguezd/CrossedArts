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
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        onClick={e => e.stopPropagation()}
        className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-start gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${tone === 'danger' ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' : 'bg-purple-500/10 text-purple-300 border border-purple-500/30'}`}>
            <AlertTriangle size={18} />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-sm font-bold text-white">{title}</h2>
            <p id={descId} className="text-xs text-slate-300 mt-1.5 leading-relaxed">{consequence}</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${tone === 'danger' ? 'bg-rose-600 hover:bg-rose-500' : 'bg-purple-600 hover:bg-purple-500'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
