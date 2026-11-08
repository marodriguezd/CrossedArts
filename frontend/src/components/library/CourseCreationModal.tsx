import React from 'react';
import { GraduationCap, X } from 'lucide-react';
import { Button, cn, INPUT_CLS } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

const LABEL_CLS = 'block text-meta font-medium text-ink mb-1';

export interface CourseFormData {
  title: string;
  description: string;
  category: string;
  instructor: string;
}

export interface CourseCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  form: CourseFormData;
  onChange: React.Dispatch<React.SetStateAction<CourseFormData>>;
  error: string | null;
}

export const CourseCreationModal: React.FC<CourseCreationModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  form,
  onChange,
  error,
}) => {
  const { t } = useLanguage();

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <form
        onSubmit={onSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-course-title"
        className="max-h-[90vh] w-full max-w-md animate-fade-in space-y-4 overflow-y-auto rounded-xl border border-line bg-raised p-6 shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-line pb-3">
          <h3 id="create-course-title" className="type-section flex items-center gap-2 text-ink">
            <GraduationCap size={17} className="text-accent" aria-hidden="true" /> Crear curso
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('library.closeDialog')}
            className="text-faint hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className={LABEL_CLS} htmlFor="course-title">
              Título
            </label>
            <input
              id="course-title"
              type="text"
              value={form.title}
              onChange={(e) => onChange((f) => ({ ...f, title: e.target.value }))}
              placeholder="Ej. Arquitectura de Sistemas"
              className={INPUT_CLS}
              required
            />
          </div>
          <div>
            <label className={LABEL_CLS} htmlFor="course-desc">
              Descripción
            </label>
            <textarea
              id="course-desc"
              rows={3}
              value={form.description}
              onChange={(e) => onChange((f) => ({ ...f, description: e.target.value }))}
              className={cn(INPUT_CLS, 'resize-none')}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL_CLS} htmlFor="course-category">
                Categoría
              </label>
              <input
                id="course-category"
                type="text"
                value={form.category}
                onChange={(e) => onChange((f) => ({ ...f, category: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
            <div>
              <label className={LABEL_CLS} htmlFor="course-instructor">
                Instructor
              </label>
              <input
                id="course-instructor"
                type="text"
                value={form.instructor}
                onChange={(e) => onChange((f) => ({ ...f, instructor: e.target.value }))}
                className={INPUT_CLS}
              />
            </div>
          </div>
        </div>

        {error && (
          <div
            className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-meta text-error"
            role="alert"
          >
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="quiet" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="solid" type="submit">
            Crear curso
          </Button>
        </div>
      </form>
    </div>
  );
};
