import React, { useCallback, useEffect, useState } from 'react';
import {
  Lesson,
  LessonWorkspace as LessonWorkspaceModel,
  StudySessionMode,
  GraphNodeType
} from '../../types/models.ts';
import {
  CheckCircle,
  Circle,
  Play,
  Video,
  Clock,
  Check,
  Brain,
  Sparkles,
  ListChecks,
  Plus,
  FileText,
  Edit3,
  X,
  Save,
  Link2,
  Lightbulb,
  BookOpen,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { dao } from '../../db/dao.ts';
import { localMediaService } from '../../services/localMediaService.ts';
import { GRAPH_NODE_LABELS, GRAPH_RELATION_LABELS } from '../../services/domainLogic.ts';
import { FlashcardGenerationModal } from '../study/FlashcardGenerationModal.tsx';
import { Button, Badge, ProgressBar, EmptyState, InlineStatus, cn } from '../ui/index.tsx';

interface LessonWorkspaceProps {
  courseId: string;
  lesson: Lesson;
  moduleTitle: string;
  onRefresh: () => void;
  onSelectLesson: (lessonId: string) => void;
  onMoveLesson: (lessonId: string, direction: 'up' | 'down') => void;
  onStudyLesson: (lessonId: string, mode?: StudySessionMode) => void;
  onStudyResource: (resourceId: string, mode?: StudySessionMode) => void;
  onExplainResource: (resourceId: string, label: string, lessonId?: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenResource: (resourceId: string) => void;
  onOpenConcept: (conceptId: string) => void;
}

const RELATED_ICONS: Record<GraphNodeType, React.ComponentType<{ size?: number; className?: string }>> = {
  course: Layers,
  book: BookOpen,
  module: Layers,
  lesson: FileText,
  note: FileText,
  concept: Lightbulb,
  resource: BookOpen
};

const PROGRESS_LABELS: Record<LessonWorkspaceModel['progress'], string> = {
  NOT_STARTED: 'Sin empezar',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada'
};

export const LessonWorkspace: React.FC<LessonWorkspaceProps> = ({
  courseId,
  lesson,
  moduleTitle,
  onRefresh,
  onSelectLesson,
  onMoveLesson,
  onStudyLesson,
  onStudyResource,
  onExplainResource,
  onOpenNote,
  onOpenResource,
  onOpenConcept
}) => {
  const [workspace, setWorkspace] = useState<LessonWorkspaceModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [isLocalMedia, setIsLocalMedia] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '', durationMinutes: 0 });
  const [isSaving, setIsSaving] = useState(false);

  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [noteForm, setNoteForm] = useState({ title: '', content: '' });

  const [isGenOpen, setIsGenOpen] = useState(false);
  const [nextLesson, setNextLesson] = useState<{ id: string; title: string; moduleTitle: string; allCompleted: boolean } | null>(null);

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await dao.getLessonWorkspace(lesson.id);
      setWorkspace(data);
      const next = await dao.getNextLessonForCourse(courseId);
      if (next) {
        setNextLesson({ id: next.lesson.id, title: next.lesson.title, moduleTitle: next.moduleTitle, allCompleted: next.allCompleted });
      } else {
        setNextLesson(null);
      }
    } catch (err) {
      console.warn('No se pudo cargar el espacio de trabajo de la lección:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lesson.id, courseId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // Media local efímera para la lección activa; se revoca al cambiar de lección o desmontar.
  useEffect(() => {
    let isCancelled = false;

    async function resolveMedia() {
      setMediaLoading(true);
      const localUrl = await localMediaService.getPlaybackUrl(lesson.id);
      if (isCancelled) return;

      if (localUrl) {
        setPlaybackUrl(localUrl);
        setIsLocalMedia(true);
      } else if (lesson.media_url && /^https?:\/\//.test(lesson.media_url)) {
        setPlaybackUrl(lesson.media_url);
        setIsLocalMedia(false);
      } else {
        setPlaybackUrl(null);
        setIsLocalMedia(false);
      }
      setMediaLoading(false);
    }

    resolveMedia();
    return () => {
      isCancelled = true;
      localMediaService.revokePlaybackUrl(lesson.id);
    };
  }, [lesson.id, lesson.media_url]);

  useEffect(() => {
    setEditForm({ title: lesson.title, content: lesson.content || '', durationMinutes: lesson.duration_minutes });
    setIsEditing(false);
    setFeedback(null);
    setIsCreatingNote(false);
  }, [lesson.id, lesson.title, lesson.content, lesson.duration_minutes]);

  const handleToggleComplete = async () => {
    await dao.toggleLessonCompleted(lesson.id, !lesson.is_completed);
    onRefresh();
    loadWorkspace();
  };

  const handleSaveLesson = async () => {
    setIsSaving(true);
    setFeedback(null);
    const res = await dao.updateLesson(lesson.id, {
      title: editForm.title,
      content: editForm.content,
      durationMinutes: Number(editForm.durationMinutes) || 0
    });
    setIsSaving(false);
    if (!res.success) {
      setFeedback({ type: 'error', text: res.error || 'No se pudo guardar la lección.' });
      return;
    }
    setIsEditing(false);
    setFeedback({ type: 'success', text: 'Lección actualizada. El índice semántico se invalida solo para esta lección.' });
    onRefresh();
    loadWorkspace();
  };

  const handleAssociateFile = async (file: File) => {
    const res = localMediaService.associateIndividualFile(lesson.id, file);
    if (!res.success) {
      setFeedback({ type: 'error', text: res.error || 'Error asociando archivo.' });
      return;
    }
    const url = await localMediaService.getPlaybackUrl(lesson.id);
    setPlaybackUrl(url);
    setIsLocalMedia(true);
    setFeedback({ type: 'success', text: `Archivo "${file.name}" asociado localmente para esta sesión.` });
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteForm.title.trim()) return;
    await dao.addNote({
      title: noteForm.title,
      content: noteForm.content,
      resource_id: courseId,
      lesson_id: lesson.id
    });
    setNoteForm({ title: '', content: '' });
    setIsCreatingNote(false);
    setFeedback({ type: 'success', text: 'Nota creada y asociada a esta lección.' });
    onRefresh();
    loadWorkspace();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted">
        <Loader2 size={24} className="animate-spin text-accent" />
        <p className="text-meta">Cargando espacio de trabajo de la lección…</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <InlineStatus tone="error" className="text-body">
        <AlertCircle size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
        La lección ya no existe en la base local.
      </InlineStatus>
    );
  }

  const { notes, resources, concepts, relatedBooks, flashcardCount, progress } = workspace;
  const progressTone =
    progress === 'COMPLETED'
      ? 'success'
      : progress === 'IN_PROGRESS'
        ? 'warning'
        : 'neutral';

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

  return (
    <div className="space-y-5">
      {/* Cabecera de la lección */}
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="type-micro">{moduleTitle}</p>
            <h2 className="type-title mt-0.5 break-words text-ink">{lesson.title}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge tone={progressTone as any}>
                {progress === 'COMPLETED' ? <CheckCircle size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
                {PROGRESS_LABELS[progress]}
              </Badge>
              <span className="flex items-center gap-1 text-meta text-muted">
                <Clock size={12} aria-hidden="true" /> {lesson.duration_minutes} min
              </span>
              <span className="flex items-center gap-1 text-meta text-muted">
                <FileText size={12} aria-hidden="true" /> {lesson.lesson_type}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => onMoveLesson(lesson.id, 'up')}
              aria-label={`Mover la lección ${lesson.title} hacia arriba`}
            >
              <ArrowUp size={13} aria-hidden="true" /> Subir
            </Button>
            <Button
              size="sm"
              variant="quiet"
              onClick={() => onMoveLesson(lesson.id, 'down')}
              aria-label={`Mover la lección ${lesson.title} hacia abajo`}
            >
              <ArrowDown size={13} aria-hidden="true" /> Bajar
            </Button>
            <Button
              size="sm"
              variant={lesson.is_completed ? 'outline' : 'solid'}
              onClick={handleToggleComplete}
              aria-label={lesson.is_completed ? 'Reabrir lección' : 'Marcar lección como completada'}
              className={lesson.is_completed ? 'border-success/40 text-success' : ''}
            >
              {lesson.is_completed ? <><Check size={13} aria-hidden="true" /> Completada</> : <><CheckCircle size={13} aria-hidden="true" /> Marcar completada</>}
            </Button>
          </div>
        </div>

        {/* Acciones de estudio unificadas */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <Button size="sm" variant="solid" onClick={() => onStudyLesson(lesson.id, 'mixed')}>
            <Play size={13} aria-hidden="true" /> Estudiar esta lección
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStudyLesson(lesson.id, 'flashcards')}>
            <Brain size={13} aria-hidden="true" /> Repasar flashcards
          </Button>
          <Button size="sm" variant="outline" onClick={() => onStudyLesson(lesson.id, 'practice')}>
            <ListChecks size={13} aria-hidden="true" /> Preguntas de práctica
          </Button>
          <Button size="sm" variant="outline" onClick={() => onExplainResource(courseId, lesson.title, lesson.id)}>
            <Sparkles size={13} aria-hidden="true" /> Explicar esta lección
          </Button>
          <Button size="sm" variant="outline" onClick={() => setIsGenOpen(true)}>
            <Sparkles size={13} aria-hidden="true" /> Generar flashcards
          </Button>
        </div>

        {feedback && (
          <div className="mt-3">
            <InlineStatus tone={feedback.type === 'success' ? 'success' : 'error'}>
              {feedback.type === 'success' ? <CheckCircle size={14} className="shrink-0" aria-hidden="true" /> : <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
              <span>{feedback.text}</span>
            </InlineStatus>
          </div>
        )}
      </div>

      {/* Reproductor de medios locales */}
      <div className={cn('overflow-hidden rounded-xl border border-line', playbackUrl ? 'bg-black' : 'bg-surface')}>
        {playbackUrl ? (
          <video key={lesson.id} src={playbackUrl} controls className="max-h-[420px] w-full bg-black object-contain" />
        ) : (
          <div className="flex flex-col items-center justify-center p-8 text-center">
            <Video size={34} className="mb-2 text-faint" aria-hidden="true" />
            <p className="text-secondary text-muted">No hay archivo multimedia local disponible para esta lección.</p>
            <p className="type-meta mt-1">
              Usa «Vincular carpeta local» en la Biblioteca o asocia un archivo individual.
            </p>
            {!mediaLoading && lesson.media_url && (
              <p className="mt-2 break-all font-mono text-micro text-accent">Archivo esperado: {lesson.media_url}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface px-3 py-2">
          <span className="flex items-center gap-1.5 text-meta text-muted">
            <Video size={13} className="text-accent" aria-hidden="true" />
            {isLocalMedia ? 'Medio local efímero (no persistido)' : playbackUrl ? 'Medio remoto' : 'Sin medio'}
          </span>
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-meta font-medium text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink">
            <Video size={13} aria-hidden="true" />
            <span>Asociar archivo local</span>
            <input
              type="file"
              accept="video/*,audio/*,.mp4,.webm,.ogg,.mov,.m4v,.mp3,.wav,.m4a"
              className="hidden"
              aria-label="Asociar archivo multimedia local a la lección"
              onChange={async e => {
                const file = e.target.files?.[0];
                if (file) await handleAssociateFile(file);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      </div>

      {/* Contenido de la lección: el objeto visual principal (texto/Markdown como datos) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card sm:p-7" aria-label="Contenido de la lección">
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
              <label className="sr-only" htmlFor="lesson-title-input">Título de la lección</label>
              <input
                id="lesson-title-input"
                type="text"
                value={editForm.title}
                onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                aria-label="Título de la lección"
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
              <label className="sr-only" htmlFor="lesson-content-input">Contenido de la lección (texto o Markdown)</label>
              <textarea
                id="lesson-content-input"
                value={editForm.content}
                onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
                rows={12}
                aria-label="Contenido de la lección (texto o Markdown)"
                placeholder="Escribe el contenido de la lección (texto o Markdown)…"
                className={cn(INPUT_CLS, 'min-h-56 resize-y font-mono text-secondary')}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="quiet" onClick={() => setIsEditing(false)}>
                <X size={13} aria-hidden="true" /> Cancelar
              </Button>
              <Button size="sm" variant="solid" onClick={handleSaveLesson} disabled={isSaving}>
                <Save size={13} aria-hidden="true" /> {isSaving ? 'Guardando…' : 'Guardar'}
              </Button>
            </div>
          </div>
        ) : lesson.content && lesson.content.trim() ? (
          /* Tipografía de lectura: medida cómoda, ritmo vertical y sin ruido. */
          <article className="type-prose whitespace-pre-wrap break-words">
            {lesson.content}
          </article>
        ) : (
          <EmptyState
            title="Esta lección aún no tiene contenido."
            hint="Usa «Editar» para añadir texto o Markdown. El contenido se guarda como datos en SQLite."
          />
        )}
      </section>

      {/* Zona secundaria: notas, recursos, conceptos y contexto */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Notas de la lección */}
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label="Notas de la lección">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="type-section text-ink">Notas ({notes.length})</h3>
            <Button size="sm" variant="quiet" onClick={() => setIsCreatingNote(v => !v)}>
              <Plus size={13} aria-hidden="true" /> Crear nota
            </Button>
          </div>

          {isCreatingNote && (
            <form onSubmit={handleCreateNote} className="mb-3 space-y-2 rounded-lg border border-accent/30 bg-accent-soft/50 p-3">
              <div>
                <label className="sr-only" htmlFor="new-note-title">Título de la nueva nota</label>
                <input
                  id="new-note-title"
                  type="text"
                  value={noteForm.title}
                  onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Título de la nota"
                  required
                  aria-label="Título de la nueva nota"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <label className="sr-only" htmlFor="new-note-content">Contenido de la nueva nota</label>
                <textarea
                  id="new-note-content"
                  value={noteForm.content}
                  onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
                  rows={3}
                  placeholder="Contenido…"
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
                <li key={note.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-canvas p-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-meta font-semibold text-ink">{note.title}</span>
                    <span className="block truncate text-micro">{note.content.slice(0, 90)}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="quiet"
                    className="shrink-0"
                    onClick={() => onOpenNote(note.id)}
                    aria-label={`Abrir nota ${note.title}`}
                  >
                    Abrir <ArrowRight size={12} aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recursos relacionados */}
        <section className="rounded-xl border border-line bg-surface p-4 shadow-card" aria-label="Recursos relacionados">
          <h3 className="type-section mb-3 text-ink">Recursos relacionados ({resources.length})</h3>
          {resources.length === 0 ? (
            <p className="type-meta">Sin recursos asociados. Puedes añadirlos desde el Grafo de Conocimiento.</p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5">
              {resources.map(item => {
                const Icon = RELATED_ICONS[item.type] || FileText;
                const relationLabel = (GRAPH_RELATION_LABELS as Record<string, string>)[item.relation] || item.relation;
                return (
                  <li key={`${item.id}-${item.relation}`} className="rounded-lg border border-line bg-canvas p-2.5">
                    <button
                      onClick={() => onOpenResource(item.id)}
                      className="flex w-full items-start gap-2 text-left"
                      aria-label={`Abrir ${GRAPH_NODE_LABELS[item.type]}: ${item.title}`}
                    >
                      <Icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
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

        {/* Conceptos + contexto */}
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

          {/* Panel de aprendizaje relacionado (solo relaciones canónicas) */}
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

      {/* Continuar aprendiendo */}
      {nextLesson && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="type-item text-ink">
              {nextLesson.allCompleted ? 'Curso completado. Repasa la última lección:' : 'Continuar aprendiendo'}
            </p>
            <p className="type-meta mt-0.5 truncate">{nextLesson.moduleTitle} › {nextLesson.title}</p>
          </div>
          <Button variant="solid" size="sm" className="self-start" onClick={() => onSelectLesson(nextLesson.id)}>
            <ArrowRight size={13} aria-hidden="true" /> Continuar
          </Button>
        </div>
      )}

      <FlashcardGenerationModal
        isOpen={isGenOpen}
        onClose={() => setIsGenOpen(false)}
        resourceId={courseId}
        lessonId={lesson.id}
        initialTopic={lesson.title}
        onCardsSaved={() => {
          onRefresh();
          loadWorkspace();
        }}
      />
    </div>
  );
};
