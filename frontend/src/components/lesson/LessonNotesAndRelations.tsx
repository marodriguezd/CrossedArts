import React from 'react';
import {
  Plus,
  Save,
  Clock,
  ArrowRight,
  Brain,
  Sparkles,
  Lightbulb
} from 'lucide-react';
import type { LessonWorkspace as LessonWorkspaceModel, StudySessionMode } from '../../types/models.ts';
import {
  GRAPH_NODE_LABELS,
  GRAPH_RELATION_LABELS,
  formatPlaybackTime,
  extractTimestampParts
} from '../../services/domainLogic.ts';
import { Button, EntityIcon, INPUT_CLS, cn } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export interface LessonNotesAndRelationsProps {
  notes: LessonWorkspaceModel['notes'];
  resources: LessonWorkspaceModel['resources'];
  concepts: LessonWorkspaceModel['concepts'];
  relatedBooks: LessonWorkspaceModel['relatedBooks'];
  flashcardCount: number;
  nextLesson: { id: string; title: string; moduleTitle: string; allCompleted: boolean } | null;
  isCreatingNote: boolean;
  setIsCreatingNote: (creating: boolean | ((v: boolean) => boolean)) => void;
  noteForm: { title: string; content: string };
  setNoteForm: React.Dispatch<React.SetStateAction<{ title: string; content: string }>>;
  onCreateNote: (e: React.FormEvent) => Promise<void>;
  playbackUrl: string | null;
  currentPlaybackSeconds: number;
  onSeekTo: (seconds: number) => void;
  onOpenNote: (noteId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onStudyResource: (resourceId: string, mode?: StudySessionMode) => void;
  onExplainResource: (resourceId: string, label: string) => void;
  onSelectLesson: (lessonId: string) => void;
}

export const LessonNotesAndRelations: React.FC<LessonNotesAndRelationsProps> = ({
  notes,
  resources,
  concepts,
  relatedBooks,
  flashcardCount,
  nextLesson,
  isCreatingNote,
  setIsCreatingNote,
  noteForm,
  setNoteForm,
  onCreateNote,
  playbackUrl,
  currentPlaybackSeconds,
  onSeekTo,
  onOpenNote,
  onOpenResource,
  onOpenConcept,
  onStudyResource,
  onExplainResource,
  onSelectLesson
}) => {
  const { t } = useLanguage();

  return (
    <>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label={t('lessonWorkspace.notesSectionLabel')}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="type-section text-ink">Notas ({notes.length})</h3>
            <Button size="sm" variant="quiet" onClick={() => setIsCreatingNote(v => !v)}>
              <Plus size={13} aria-hidden="true" /> Crear nota
            </Button>
          </div>

          {isCreatingNote && (
            <form onSubmit={onCreateNote} className="mb-3 space-y-2 rounded-lg border border-accent/30 bg-accent-soft/50 p-3">
              <div>
                <label className="sr-only" htmlFor="new-note-title">{t('lessonWorkspace.newNoteTitleLabel')}</label>
                <input
                  id="new-note-title"
                  type="text"
                  value={noteForm.title}
                  onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
                  placeholder={t('lessonWorkspace.noteTitlePlaceholder')}
                  required
                  aria-label={t('lessonWorkspace.newNoteTitleLabel')}
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-micro font-medium text-muted" htmlFor="new-note-content">Contenido</label>
                  {playbackUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const cur = currentPlaybackSeconds || 0;
                        const stamp = `[${formatPlaybackTime(cur)}]`;
                        setNoteForm(f => ({
                          ...f,
                          content: f.content ? `${f.content} ${stamp} ` : `${stamp} `
                        }));
                      }}
                      className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-micro font-medium text-muted hover:border-line-strong hover:text-ink transition-colors"
                      title={t('lessonWorkspace.insertTimestampTitle')}
                    >
                      <Clock size={11} className="text-accent" aria-hidden="true" />
                      <span>Marca [{formatPlaybackTime(currentPlaybackSeconds || 0)}]</span>
                    </button>
                  )}
                </div>
                <textarea
                  id="new-note-content"
                  value={noteForm.content}
                  onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
                  rows={3}
                  placeholder={t('lessonWorkspace.noteContentPlaceholder')}
                  aria-label="Contenido de la nueva nota"
                  className={cn(INPUT_CLS, 'resize-y')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="quiet" onClick={() => setIsCreatingNote(false)}>
                  Cancelar
                </Button>
                <Button size="sm" variant="solid" type="submit">
                  <Save size={13} aria-hidden="true" /> Guardar nota
                </Button>
              </div>
            </form>
          )}

          {notes.length === 0 ? (
            <p className="type-meta">Aún no hay notas asociadas a esta lección.</p>
          ) : (
            <ul className="space-y-1.5">
              {notes.map(note => (
                <li key={note.id} className="space-y-1.5 rounded-lg border border-line bg-canvas p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-meta font-semibold text-ink">{note.title}</span>
                    <Button
                      size="sm"
                      variant="quiet"
                      className="shrink-0"
                      onClick={() => onOpenNote(note.id)}
                      aria-label={`Abrir nota ${note.title}`}
                    >
                      Abrir <ArrowRight size={12} aria-hidden="true" />
                    </Button>
                  </div>
                  <div className="text-micro text-muted break-words leading-relaxed">
                    {extractTimestampParts(note.content.slice(0, 160)).map((part, pIdx) => {
                      if (part.isTimestamp && part.seconds !== undefined) {
                        return (
                          <button
                            key={pIdx}
                            type="button"
                            onClick={() => onSeekTo(part.seconds!)}
                            className="mx-0.5 inline-flex items-center gap-0.5 rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-micro font-semibold text-accent transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
                            title={`Saltar a ${part.rawTimestamp} en el video`}
                          >
                            <Clock size={10} aria-hidden="true" />
                            {part.rawTimestamp}
                          </button>
                        );
                      }
                      return <span key={pIdx}>{part.text}</span>;
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label="Recursos relacionados">
          <h3 className="type-section mb-3 text-ink">Recursos relacionados ({resources.length})</h3>
          {resources.length === 0 ? (
            <p className="type-meta">Sin recursos asociados. Puedes añadirlos desde el Grafo de Conocimiento.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5">
              {resources.map(item => {
                const relationLabel = (GRAPH_RELATION_LABELS as Record<string, string>)[item.relation] || item.relation;
                return (
                  <li key={`${item.id}-${item.relation}`} className="rounded-lg border border-line bg-canvas p-2.5">
                    <button
                      onClick={() => onOpenResource(item.id)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-label={`Abrir ${GRAPH_NODE_LABELS[item.type]}: ${item.title}`}
                    >
                      <EntityIcon type={item.type} size={14} className="mt-0.5 shrink-0 text-accent" />
                      <span className="min-w-0">
                        <span className="block truncate text-meta font-semibold text-ink">{item.title}</span>
                        <span className="block text-micro">{GRAPH_NODE_LABELS[item.type]} · {relationLabel}</span>
                      </span>
                    </button>
                    {item.type !== 'module' && item.type !== 'lesson' && (
                      <div className="mt-1 flex flex-wrap items-center gap-2 pl-6">
                        <button
                          onClick={() => onStudyResource(item.id, 'mixed')}
                          className="inline-flex items-center gap-0.5 text-micro text-muted hover:text-ink"
                        >
                          <Brain size={11} aria-hidden="true" /> Estudiar
                        </button>
                        <button
                          onClick={() => onExplainResource(item.id, item.title)}
                          className="inline-flex items-center gap-0.5 text-micro text-accent hover:opacity-80"
                        >
                          <Sparkles size={11} aria-hidden="true" /> Explicar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="space-y-5">
          {concepts.length > 0 && (
            <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label="Conceptos">
              <h3 className="type-section mb-3 text-ink">Conceptos ({concepts.length})</h3>
              <div className="flex flex-wrap gap-1.5">
                {concepts.map(c => (
                  <button
                    key={c.id}
                    onClick={() => onOpenConcept(c.id)}
                    className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2.5 py-1 text-meta text-ink transition-colors hover:border-accent/40 hover:bg-accent-soft/50"
                    aria-label={`Abrir concepto ${c.title}`}
                  >
                    <Lightbulb size={11} className="text-accent" aria-hidden="true" /> {c.title}
                  </button>
                ))}
              </div>
            </section>
          )}

          {(relatedBooks.length > 0 || notes.length > 0 || resources.length > 0 || concepts.length > 0) && (
            <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label="Aprendizaje relacionado">
              <h3 className="type-section mb-2 text-ink">Aprendizaje relacionado</h3>
              <dl className="divide-y divide-line text-meta">
                <div className="flex justify-between py-1.5"><dt className="text-faint">Notas</dt><dd className="font-semibold text-ink">{notes.length}</dd></div>
                <div className="flex justify-between py-1.5"><dt className="text-faint">Recursos</dt><dd className="font-semibold text-ink">{resources.length}</dd></div>
                <div className="flex justify-between py-1.5"><dt className="text-faint">Conceptos</dt><dd className="font-semibold text-ink">{concepts.length}</dd></div>
                <div className="flex justify-between py-1.5"><dt className="text-faint">Libros</dt><dd className="font-semibold text-ink">{relatedBooks.length}</dd></div>
                <div className="flex justify-between py-1.5"><dt className="text-faint">Tarjetas SM-2 del curso</dt><dd className="font-semibold text-ink">{flashcardCount}</dd></div>
              </dl>
              <p className="mt-2 text-micro">
                Relaciones canónicas locales (explícitas + estructurales). Sin descubrimiento automático.
              </p>
            </section>
          )}
        </div>
      </div>

      {nextLesson && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="type-item text-ink">
              {nextLesson.allCompleted
                ? t('courseDetail.courseDone')
                : t('lessonWorkspace.continueLearning')}
            </p>
            <p className="type-meta mt-0.5 truncate">{nextLesson.moduleTitle} › {nextLesson.title}</p>
          </div>
          <Button variant="solid" size="sm" className="self-start" onClick={() => onSelectLesson(nextLesson.id)}>
            <ArrowRight size={13} aria-hidden="true" /> Continuar
          </Button>
        </div>
      )}
    </>
  );
};
