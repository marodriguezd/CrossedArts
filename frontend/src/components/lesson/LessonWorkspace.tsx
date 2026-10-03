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
      <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
        <Loader2 size={24} className="animate-spin text-purple-500" />
        <p className="text-xs">Cargando espacio de trabajo de la lección...</p>
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-rose-500/30 text-rose-300 text-sm flex items-center gap-2">
        <AlertCircle size={18} /> La lección ya no existe en la base local.
      </div>
    );
  }

  const { notes, resources, concepts, relatedBooks, flashcardCount, progress } = workspace;
  const progressTone =
    progress === 'COMPLETED'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      : progress === 'IN_PROGRESS'
        ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
        : 'bg-slate-800 text-slate-300 border-slate-700';

  return (
    <div className="space-y-4">
      {/* Encabezado de la lección */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500">{moduleTitle}</p>
            <h2 className="text-base font-bold text-white break-words">{lesson.title}</h2>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border ${progressTone}`}>
                {progress === 'COMPLETED' ? <CheckCircle size={11} /> : <Circle size={11} />} {PROGRESS_LABELS[progress]}
              </span>
              <span className="flex items-center gap-1 text-slate-400"><Clock size={11} /> {lesson.duration_minutes} min</span>
              <span className="flex items-center gap-1 text-slate-400"><FileText size={11} /> {lesson.lesson_type}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onMoveLesson(lesson.id, 'up')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              aria-label={`Mover la lección ${lesson.title} hacia arriba`}
            >
              <ArrowUp size={12} /> Subir
            </button>
            <button
              onClick={() => onMoveLesson(lesson.id, 'down')}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              aria-label={`Mover la lección ${lesson.title} hacia abajo`}
            >
              <ArrowDown size={12} /> Bajar
            </button>
            <button
              onClick={handleToggleComplete}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                lesson.is_completed
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
              aria-label={lesson.is_completed ? 'Reabrir lección' : 'Marcar lección como completada'}
            >
              {lesson.is_completed ? <><Check size={13} /> Completada</> : <><CheckCircle size={13} /> Marcar completada</>}
            </button>
          </div>
        </div>

        {/* Acciones de estudio unificadas */}
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60">
          <button
            onClick={() => onStudyLesson(lesson.id, 'mixed')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
          >
            <Play size={13} /> Estudiar esta lección
          </button>
          <button
            onClick={() => onStudyLesson(lesson.id, 'flashcards')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 transition"
          >
            <Brain size={13} /> Repasar flashcards
          </button>
          <button
            onClick={() => onStudyLesson(lesson.id, 'practice')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition"
          >
            <ListChecks size={13} /> Preguntas de práctica
          </button>
          <button
            onClick={() => onExplainResource(courseId, lesson.title, lesson.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-800/40 transition"
          >
            <Sparkles size={13} /> Explicar esta lección
          </button>
          <button
            onClick={() => setIsGenOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition"
          >
            <Sparkles size={13} /> Generar flashcards
          </button>
        </div>

        {feedback && (
          <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/60 border border-rose-800/60 text-rose-300'
          }`} role="status">
            {feedback.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
            <span>{feedback.text}</span>
          </div>
        )}
      </div>

      {/* Reproductor de medios locales */}
      <div className="rounded-2xl overflow-hidden border border-slate-800 bg-black">
        {playbackUrl ? (
          <video key={lesson.id} src={playbackUrl} controls className="w-full max-h-[420px] object-contain bg-black" />
        ) : (
          <div className="aspect-video flex flex-col items-center justify-center text-center p-6 text-slate-500">
            <Video size={40} className="mb-2 opacity-50" />
            <p className="text-xs">No hay archivo multimedia local disponible para esta lección.</p>
            <p className="text-[11px] text-slate-600 mt-1">
              Usa "Vincular Carpeta Local" en la Biblioteca o asocia un archivo individual.
            </p>
            {!mediaLoading && lesson.media_url && (
              <p className="text-[10px] text-purple-400/80 mt-2 font-mono">Archivo esperado: {lesson.media_url}</p>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 bg-slate-900/60 border-t border-slate-800">
          <span className="text-[11px] text-slate-400 flex items-center gap-1.5">
            <Video size={12} className="text-purple-400" />
            {isLocalMedia ? 'Medio local efímero (no persistido)' : playbackUrl ? 'Medio remoto' : 'Sin medio'}
          </span>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer transition">
            <Video size={13} className="text-purple-400" />
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

      {/* Contenido de la lección (texto/Markdown como datos) */}
      <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <FileText size={14} className="text-purple-400" /> Contenido
          </h3>
          {!isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              aria-label={`Editar contenido de la lección ${lesson.title}`}
            >
              <Edit3 size={12} /> Editar
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editForm.title}
              onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
              aria-label="Título de la lección"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
            />
            <div className="flex items-center gap-2">
              <label className="text-[11px] text-slate-400" htmlFor="lesson-duration">Duración (min)</label>
              <input
                id="lesson-duration"
                type="number"
                min="0"
                value={editForm.durationMinutes}
                onChange={e => setEditForm(f => ({ ...f, durationMinutes: parseInt(e.target.value, 10) || 0 }))}
                className="w-20 px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white text-right focus:outline-none focus:border-purple-500"
              />
            </div>
            <textarea
              value={editForm.content}
              onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
              rows={8}
              aria-label="Contenido de la lección (texto o Markdown)"
              placeholder="Escribe el contenido de la lección (texto o Markdown)..."
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono focus:outline-none focus:border-purple-500 resize-y"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsEditing(false)}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition"
              >
                <X size={12} /> Cancelar
              </button>
              <button
                onClick={handleSaveLesson}
                disabled={isSaving}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white transition"
              >
                <Save size={12} /> {isSaving ? 'Guardando...' : 'Guardar'}
              </button>
            </div>
          </div>
        ) : lesson.content && lesson.content.trim() ? (
          <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words leading-relaxed font-sans">{lesson.content}</pre>
        ) : (
          <p className="text-[11px] text-slate-500">Esta lección aún no tiene contenido. Usa "Editar" para añadirlo.</p>
        )}
      </div>

      {/* Notas de la lección */}
      <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <FileText size={14} className="text-purple-400" /> Notas ({notes.length})
          </h3>
          <button
            onClick={() => setIsCreatingNote(v => !v)}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
          >
            <Plus size={12} /> Crear nota
          </button>
        </div>

        {isCreatingNote && (
          <form onSubmit={handleCreateNote} className="space-y-2 p-2.5 rounded-lg bg-slate-950/70 border border-purple-500/30">
            <input
              type="text"
              value={noteForm.title}
              onChange={e => setNoteForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Título de la nota"
              required
              aria-label="Título de la nueva nota"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
            />
            <textarea
              value={noteForm.content}
              onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
              rows={3}
              placeholder="Contenido..."
              aria-label="Contenido de la nueva nota"
              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500 resize-y"
            />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setIsCreatingNote(false)} className="px-3 py-1 rounded-lg text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
                Cancelar
              </button>
              <button type="submit" className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition">
                <Save size={12} /> Guardar nota
              </button>
            </div>
          </form>
        )}

        {notes.length === 0 ? (
          <p className="text-[11px] text-slate-500">Aún no hay notas asociadas a esta lección.</p>
        ) : (
          <ul className="space-y-1.5">
            {notes.map(note => (
              <li key={note.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                <span className="min-w-0">
                  <span className="block text-[11px] font-semibold text-slate-200 truncate">{note.title}</span>
                  <span className="block text-[10px] text-slate-500 truncate">{note.content.slice(0, 90)}</span>
                </span>
                <button
                  onClick={() => onOpenNote(note.id)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-indigo-300 transition"
                  aria-label={`Abrir nota ${note.title}`}
                >
                  Abrir <ArrowRight size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Recursos relacionados */}
      <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
        <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Link2 size={14} className="text-purple-400" /> Recursos relacionados ({resources.length})
        </h3>
        {resources.length === 0 ? (
          <p className="text-[11px] text-slate-500">Sin recursos asociados. Puedes añadirlos desde el Grafo de Conocimiento.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {resources.map(item => {
              const Icon = RELATED_ICONS[item.type] || FileText;
              const relationLabel = (GRAPH_RELATION_LABELS as Record<string, string>)[item.relation] || item.relation;
              return (
                <li key={`${item.id}-${item.relation}`} className="p-2 rounded-lg bg-slate-950/60 border border-slate-800 space-y-1">
                  <button
                    onClick={() => onOpenResource(item.id)}
                    className="w-full text-left flex items-start gap-2"
                    aria-label={`Abrir ${GRAPH_NODE_LABELS[item.type]}: ${item.title}`}
                  >
                    <Icon size={14} className="text-purple-400 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-slate-200 truncate">{item.title}</span>
                      <span className="block text-[10px] text-slate-500">{GRAPH_NODE_LABELS[item.type]} · {relationLabel}</span>
                    </span>
                  </button>
                  {item.type !== 'module' && item.type !== 'lesson' && (
                    <div className="flex flex-wrap items-center gap-2 pl-6">
                      <button
                        onClick={() => onStudyResource(item.id, 'mixed')}
                        className="text-[10px] text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-0.5"
                      >
                        <Brain size={10} /> Estudiar
                      </button>
                      <button
                        onClick={() => onExplainResource(item.id, item.title)}
                        className="text-[10px] text-purple-400 hover:text-purple-300 inline-flex items-center gap-0.5"
                      >
                        <Sparkles size={10} /> Explicar
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Conceptos */}
      {concepts.length > 0 && (
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-2">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Lightbulb size={14} className="text-purple-400" /> Conceptos ({concepts.length})
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {concepts.map(c => (
              <button
                key={c.id}
                onClick={() => onOpenConcept(c.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-slate-950/60 border border-slate-800 hover:border-purple-500/40 text-[11px] text-slate-200 transition"
                aria-label={`Abrir concepto ${c.title}`}
              >
                <Lightbulb size={11} className="text-purple-400" /> {c.title}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Panel de aprendizaje relacionado (solo relaciones canónicas) */}
      {(relatedBooks.length > 0 || notes.length > 0 || resources.length > 0 || concepts.length > 0) && (
        <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 space-y-1.5">
          <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Aprendizaje relacionado</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
            <dt className="text-slate-500">Notas</dt><dd className="text-slate-300">{notes.length}</dd>
            <dt className="text-slate-500">Recursos</dt><dd className="text-slate-300">{resources.length}</dd>
            <dt className="text-slate-500">Conceptos</dt><dd className="text-slate-300">{concepts.length}</dd>
            <dt className="text-slate-500">Libros</dt><dd className="text-slate-300">{relatedBooks.length}</dd>
            <dt className="text-slate-500">Tarjetas SM-2 del curso</dt><dd className="text-slate-300">{flashcardCount}</dd>
          </dl>
          <p className="text-[10px] text-slate-600">Relaciones canónicas locales (explícitas + estructurales). Sin descubrimiento automático.</p>
        </div>
      )}

      {/* Continuar aprendiendo */}
      {nextLesson && (
        <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-purple-200">
              {nextLesson.allCompleted ? 'Curso completado. Repasa la última lección:' : 'Continuar aprendiendo'}
            </p>
            <p className="text-[11px] text-slate-400">{nextLesson.moduleTitle} › {nextLesson.title}</p>
          </div>
          <button
            onClick={() => onSelectLesson(nextLesson.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition self-start"
          >
            <ArrowRight size={13} /> Continuar
          </button>
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
