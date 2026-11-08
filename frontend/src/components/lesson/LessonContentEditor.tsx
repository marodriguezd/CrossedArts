import React from 'react';
import { Edit3, X, Save } from 'lucide-react';
import type { Lesson } from '../../types/models.ts';
import { MarkdownViewer } from '../common/MarkdownViewer.tsx';
import { Button, EmptyState, INPUT_CLS, cn } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export interface LessonContentEditorProps {
  lesson: Lesson;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  editForm: { title: string; content: string; durationMinutes: number };
  setEditForm: React.Dispatch<React.SetStateAction<{ title: string; content: string; durationMinutes: number }>>;
  isSaving: boolean;
  onSaveLesson: () => Promise<void>;
  onSeekTo: (seconds: number) => void;
}

export const LessonContentEditor: React.FC<LessonContentEditorProps> = ({
  lesson,
  isEditing,
  setIsEditing,
  editForm,
  setEditForm,
  isSaving,
  onSaveLesson,
  onSeekTo
}) => {
  const { t } = useLanguage();

  return (
    <section className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-7" aria-label={t('lessonWorkspace.contentSectionLabel')}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-line pb-3">
        <h3 className="type-section text-ink">Contenido</h3>
        {!isEditing && (
          <Button
            size="sm"
            variant="quiet"
            onClick={() => setIsEditing(true)}
            aria-label={`Editar contenido de la lección ${lesson.title}`}
          >
            <Edit3 size={13} aria-hidden="true" /> Editar
          </Button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div>
            <label className="sr-only" htmlFor="lesson-title-input">{t('lessonWorkspace.titleLabel')}</label>
            <input
              id="lesson-title-input"
              type="text"
              value={editForm.title}
              onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              aria-label={t('lessonWorkspace.titleLabel')}
              className={INPUT_CLS}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-meta text-muted" htmlFor="lesson-duration">Duración (min)</label>
            <input
              id="lesson-duration"
              type="number"
              min="0"
              value={editForm.durationMinutes}
              onChange={e => setEditForm(f => ({ ...f, durationMinutes: parseInt(e.target.value, 10) || 0 }))}
              className="w-20 rounded-lg border border-line bg-canvas px-2 py-1.5 text-right text-body text-ink focus:border-accent/50 focus:outline-none"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="lesson-content-input">{t('lessonWorkspace.contentLabel')}</label>
            <textarea
              id="lesson-content-input"
              value={editForm.content}
              onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
              rows={12}
              aria-label={t('lessonWorkspace.contentLabel')}
              placeholder={t('lessonWorkspace.contentPlaceholder')}
              className={cn(INPUT_CLS, 'min-h-56 resize-y font-mono text-secondary')}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={() => setIsEditing(false)}>
              <X size={13} aria-hidden="true" /> Cancelar
            </Button>
            <Button size="sm" variant="solid" onClick={() => void onSaveLesson()} disabled={isSaving}>
              <Save size={13} aria-hidden="true" /> {isSaving ? 'Guardando…' : 'Guardar'}
            </Button>
          </div>
        </div>
      ) : lesson.content && lesson.content.trim() ? (
        <MarkdownViewer
          content={lesson.content}
          onSeekTimestamp={seconds => onSeekTo(seconds)}
        />
      ) : (
        <EmptyState
          title={t('lessonWorkspace.emptyContentTitle')}
          hint={t('lessonWorkspace.emptyContentHint')}
        />
      )}
    </section>
  );
};
