import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Lesson,
  LessonWorkspace as LessonWorkspaceModel,
  StudySessionMode,
  GraphNodeType,
  Flashcard
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
  Loader2,
  RotateCcw,
  RotateCw,
  Gauge,
  PictureInPicture,
  Trash2
} from 'lucide-react';
import { dao } from '../../db/dao.ts';
import { localMediaService } from '../../services/localMediaService.ts';
import {
  GRAPH_NODE_LABELS,
  GRAPH_RELATION_LABELS,
  formatPlaybackTime,
  extractTimestampParts,
  calculatePlaybackJump,
  resolveNextPlaybackSpeed,
  SUPPORTED_PLAYBACK_SPEEDS
} from '../../services/domainLogic.ts';
import { FlashcardGenerationModal } from '../study/FlashcardGenerationModal.tsx';
import { MarkdownViewer } from '../common/MarkdownViewer.tsx';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
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

  // Control y memoria de posición del reproductor multimedia
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedTimeRef = useRef<number>(0);
  const [currentPlaybackSeconds, setCurrentPlaybackSeconds] = useState<number>(0);
  const [resumedTime, setResumedTime] = useState<number | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', content: '', durationMinutes: 0 });
  const [isSaving, setIsSaving] = useState(false);

  const [isCreatingNote, setIsCreatingNote] = useState(false);
  const [noteForm, setNoteForm] = useState({ title: '', content: '' });

  const [isCreatingCard, setIsCreatingCard] = useState(false);
  const [cardForm, setCardForm] = useState({ front: '', back: '' });
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editCardForm, setEditCardForm] = useState({ front: '', back: '' });
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [isSavingCard, setIsSavingCard] = useState(false);

  const [isGenOpen, setIsGenOpen] = useState(false);
  const [nextLesson, setNextLesson] = useState<{ id: string; title: string; moduleTitle: string; allCompleted: boolean } | null>(null);

  // Restaurar y registrar posición en almacenamiento local (localStorage)
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    try {
      videoRef.current.playbackRate = playbackSpeed;
      const saved = localStorage.getItem(`crossedarts-playback:${lesson.id}`);
      if (saved) {
        const pos = parseFloat(saved);
        if (!isNaN(pos) && pos > 0 && pos < (videoRef.current.duration || Infinity) - 2) {
          videoRef.current.currentTime = pos;
          setResumedTime(pos);
          setCurrentPlaybackSeconds(pos);
        }
      }
    } catch {
      // Ignorar restricciones de almacenamiento
    }
  };

  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = videoRef.current.currentTime;
    setCurrentPlaybackSeconds(cur);
    const now = Date.now();
    if (now - lastSavedTimeRef.current > 3000) {
      lastSavedTimeRef.current = now;
      try {
        localStorage.setItem(`crossedarts-playback:${lesson.id}`, String(cur));
      } catch {
        // Ignorar
      }
    }
  };

  const handleSeekTo = (seconds: number, autoPlay = true) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, seconds);
    setCurrentPlaybackSeconds(seconds);
    if (autoPlay) {
      videoRef.current.play().catch(() => {});
    }
    videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    setResumedTime(null);
    setCurrentPlaybackSeconds(0);
    return () => {
      if (videoRef.current && videoRef.current.currentTime > 0) {
        try {
          localStorage.setItem(`crossedarts-playback:${lesson.id}`, String(videoRef.current.currentTime));
        } catch {
          // Ignorar
        }
      }
    };
  }, [lesson.id]);

  // Velocidad de reproducción (persiste preferencia del usuario)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('crossedarts-playback-speed');
      return saved ? parseFloat(saved) || 1 : 1;
    } catch {
      return 1;
    }
  });

  // Notificación breve sobre el vídeo al cambiar controles
  const [playerOverlayToast, setPlayerOverlayToast] = useState<string | null>(null);
  const overlayToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToastFeedback = useCallback((text: string) => {
    if (overlayToastTimeoutRef.current) clearTimeout(overlayToastTimeoutRef.current);
    setPlayerOverlayToast(text);
    overlayToastTimeoutRef.current = setTimeout(() => setPlayerOverlayToast(null), 1100);
  }, []);

  const handleSpeedChange = useCallback((newSpeed: number) => {
    setPlaybackSpeed(newSpeed);
    if (videoRef.current) {
      videoRef.current.playbackRate = newSpeed;
    }
    try {
      localStorage.setItem('crossedarts-playback-speed', String(newSpeed));
    } catch {
      // Ignorar restricciones
    }
    showToastFeedback(`${newSpeed}x`);
  }, [showToastFeedback]);

  const handleJump = useCallback((deltaSeconds: number) => {
    if (!videoRef.current) return;
    const maxDur = videoRef.current.duration || Infinity;
    const nextTime = calculatePlaybackJump(videoRef.current.currentTime, deltaSeconds, maxDur);
    videoRef.current.currentTime = nextTime;
    setCurrentPlaybackSeconds(nextTime);
    showToastFeedback(deltaSeconds > 0 ? `+${deltaSeconds}s` : `${deltaSeconds}s`);
  }, [showToastFeedback]);

  const handleTogglePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(() => {});
      showToastFeedback('▶ Reproducir');
    } else {
      videoRef.current.pause();
      showToastFeedback('⏸ Pausa');
    }
  }, [showToastFeedback]);

  const handleToggleMute = useCallback(() => {
    if (!videoRef.current) return;
    videoRef.current.muted = !videoRef.current.muted;
    showToastFeedback(videoRef.current.muted ? '🔇 Silenciado' : '🔊 Sonido');
  }, [showToastFeedback]);

  const handleTogglePip = useCallback(async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        showToastFeedback('PiP cerrado');
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
        showToastFeedback('Ventana flotante (PiP)');
      }
    } catch {
      // Ignorar rechazo o falta de soporte
    }
  }, [showToastFeedback]);

  // Atajos globales de reproducción multimedia (Space, J/L, flechas, M, [ ])
  useEffect(() => {
    if (!playbackUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Las combinaciones con modificador NO pertenecen a este atajo: son de la
      // aplicación o del sistema (por ejemplo Ctrl+K / Cmd+K abren la paleta de
      // comandos global). Sin esta guarda, Cmd+L saltaba -10 s, Cmd+M silenciaba
      // y Cmd+K pausaba el vídeo mientras abría la paleta.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Evitar captura si el usuario está escribiendo en notas, inputs o selects
      const activeEl = document.activeElement;
      const isInput =
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable);
      if (isInput) return;

      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        handleTogglePlayPause();
      } else if (e.key === 'j' || e.key === 'J' || e.key === 'ArrowLeft') {
        e.preventDefault();
        handleJump(-10);
      } else if (e.key === 'l' || e.key === 'L' || e.key === 'ArrowRight') {
        e.preventDefault();
        handleJump(10);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === '[') {
        e.preventDefault();
        const nextSpeed = resolveNextPlaybackSpeed(playbackSpeed, 'decrease');
        if (nextSpeed !== playbackSpeed) handleSpeedChange(nextSpeed);
      } else if (e.key === ']') {
        e.preventDefault();
        const nextSpeed = resolveNextPlaybackSpeed(playbackSpeed, 'increase');
        if (nextSpeed !== playbackSpeed) handleSpeedChange(nextSpeed);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [playbackUrl, playbackSpeed, handleTogglePlayPause, handleJump, handleToggleMute, handleSpeedChange]);

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

  const handleCreateCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cardForm.front.trim() || !cardForm.back.trim()) return;
    setIsSavingCard(true);
    try {
      const res = await dao.createFlashcard({
        resource_id: courseId,
        lesson_id: lesson.id,
        front: cardForm.front.trim(),
        back: cardForm.back.trim()
      });
      if (res.success) {
        setCardForm({ front: '', back: '' });
        setIsCreatingCard(false);
        setFeedback({ type: 'success', text: 'Tarjeta añadida a la lección y programada en SM-2.' });
        await loadWorkspace();
        onRefresh();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Error al crear tarjeta' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error al crear tarjeta' });
    } finally {
      setIsSavingCard(false);
    }
  };

  const handleStartEditCard = (card: Flashcard) => {
    setEditingCardId(card.id);
    setEditCardForm({ front: card.front, back: card.back });
  };

  const handleUpdateCard = async (cardId: string) => {
    if (!editCardForm.front.trim() || !editCardForm.back.trim()) return;
    try {
      const res = await dao.updateFlashcard(cardId, {
        front: editCardForm.front.trim(),
        back: editCardForm.back.trim()
      });
      if (res.success) {
        setEditingCardId(null);
        setFeedback({ type: 'success', text: 'Tarjeta actualizada correctamente.' });
        await loadWorkspace();
        onRefresh();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Error al actualizar tarjeta' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error al actualizar tarjeta' });
    }
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      const res = await dao.deleteFlashcard(cardId);
      if (res.success) {
        setDeletingCardId(null);
        setFeedback({ type: 'success', text: 'Tarjeta eliminada.' });
        await loadWorkspace();
        onRefresh();
      } else {
        setFeedback({ type: 'error', text: res.error || 'Error al eliminar tarjeta' });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err?.message || 'Error al eliminar tarjeta' });
    }
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
  const flashcards = workspace.flashcards || [];
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
      <div className={cn('relative overflow-hidden rounded-xl border border-line', playbackUrl ? 'bg-black' : 'bg-surface')}>
        {playbackUrl ? (
          <div className="relative group">
            <video
              ref={videoRef}
              key={lesson.id}
              src={playbackUrl}
              controls
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onPause={() => {
                if (videoRef.current) {
                  try {
                    localStorage.setItem(`crossedarts-playback:${lesson.id}`, String(videoRef.current.currentTime));
                  } catch {
                    // Ignorar
                  }
                }
              }}
              className="max-h-[420px] w-full bg-black object-contain"
            />
            {/* Overlay Toast de feedback breve al usar atajos o cambiar controles */}
            {playerOverlayToast && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="animate-fade-in rounded-lg bg-black/85 px-4 py-2 font-mono text-title font-bold text-white shadow-lg backdrop-blur-sm">
                  {playerOverlayToast}
                </span>
              </div>
            )}
          </div>
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
          <div className="flex flex-wrap items-center gap-2.5 text-meta text-muted">
            <span className="flex items-center gap-1.5">
              <Video size={13} className="text-accent" aria-hidden="true" />
              {isLocalMedia ? 'Medio local efímero' : playbackUrl ? 'Medio remoto' : 'Sin medio'}
            </span>
            {playbackUrl && (
              <>
                <span className="inline-flex items-center gap-1 font-mono text-micro text-ink">
                  <Clock size={11} className="text-accent" aria-hidden="true" />
                  {formatPlaybackTime(currentPlaybackSeconds)}
                </span>

                <span className="text-line-strong" aria-hidden="true">|</span>

                {/* Saltos temporales */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleJump(-10)}
                    title="Retroceder 10s (Atajo: J o Flecha Izquierda)"
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-meta text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                  >
                    <RotateCcw size={12} aria-hidden="true" />
                    <span>-10s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleJump(10)}
                    title="Avanzar 10s (Atajo: L o Flecha Derecha)"
                    className="inline-flex items-center gap-0.5 rounded px-1.5 py-1 text-meta text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                  >
                    <RotateCw size={12} aria-hidden="true" />
                    <span>+10s</span>
                  </button>
                </div>

                {/* Selector de velocidad */}
                <div className="flex items-center gap-0.5 rounded-lg border border-line bg-canvas px-1 py-0.5" title="Velocidad de reproducción ([ y ] para ajustar)">
                  <Gauge size={12} className="mx-1 text-muted" aria-hidden="true" />
                  {SUPPORTED_PLAYBACK_SPEEDS.map(s => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => handleSpeedChange(s)}
                      className={cn(
                        'rounded px-1.5 py-0.5 text-micro font-medium transition',
                        playbackSpeed === s
                          ? 'bg-accent text-white shadow-xs'
                          : 'text-muted hover:text-ink'
                      )}
                    >
                      {s}x
                    </button>
                  ))}
                </div>

                {/* Botón Picture-in-Picture */}
                {typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && (
                  <button
                    type="button"
                    onClick={() => void handleTogglePip()}
                    title="Ventana flotante Picture-in-Picture"
                    className="rounded p-1.5 text-muted transition hover:bg-accent-soft/60 hover:text-ink"
                    aria-label="Ventana flotante Picture-in-Picture"
                  >
                    <PictureInPicture size={14} aria-hidden="true" />
                  </button>
                )}
              </>
            )}
            {resumedTime !== null && resumedTime > 0 && (
              <Badge tone="info" className="font-mono text-micro">
                Reanudado en {formatPlaybackTime(resumedTime)}
              </Badge>
            )}
          </div>
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
          <MarkdownViewer
            content={lesson.content}
            onSeekTimestamp={seconds => handleSeekTo(seconds, true)}
          />
        ) : (
          <EmptyState
            title="Esta lección aún no tiene contenido."
            hint="Usa «Editar» para añadir texto o Markdown. El contenido se guarda como datos en SQLite."
          />
        )}
      </section>

      {/* Tarjetas de estudio de la lección (SM-2) */}
      <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5" aria-label="Tarjetas de estudio de la lección">
        <div className="mb-4 flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Brain size={18} className="text-accent" aria-hidden="true" />
            <h3 className="type-section text-ink">Tarjetas de estudio ({flashcards.length})</h3>
            <Badge tone={flashcards.length > 0 ? 'success' : 'neutral'} className="font-mono text-micro">
              SM-2
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {flashcards.length > 0 && (
              <Button size="sm" variant="solid" onClick={() => onStudyLesson(lesson.id, 'flashcards')}>
                <Play size={12} aria-hidden="true" /> Repasar tarjetas
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setIsCreatingCard(v => !v)}>
              <Plus size={12} aria-hidden="true" /> {isCreatingCard ? 'Cerrar' : 'Nueva tarjeta'}
            </Button>
            <Button size="sm" variant="quiet" onClick={() => setIsGenOpen(true)}>
              <Sparkles size={12} aria-hidden="true" /> Generar con IA
            </Button>
          </div>
        </div>

        {/* Formulario de creación de nueva tarjeta */}
        {isCreatingCard && (
          <form onSubmit={handleCreateCard} className="mb-4 space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
            <p className="text-meta font-semibold text-ink">Nueva tarjeta de estudio para esta lección</p>
            <div>
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="new-card-front">
                Anverso (pregunta, concepto o prompt)
              </label>
              <textarea
                id="new-card-front"
                rows={2}
                value={cardForm.front}
                onChange={e => setCardForm(f => ({ ...f, front: e.target.value }))}
                placeholder="¿Qué es...? / Definición de..."
                required
                className={cn(INPUT_CLS, 'resize-y')}
              />
            </div>
            <div>
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="new-card-back">
                Reverso (respuesta esperada o explicación clave)
              </label>
              <textarea
                id="new-card-back"
                rows={3}
                value={cardForm.back}
                onChange={e => setCardForm(f => ({ ...f, back: e.target.value }))}
                placeholder="La respuesta clave fundamentada en el contenido..."
                required
                className={cn(INPUT_CLS, 'resize-y')}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="quiet" onClick={() => setIsCreatingCard(false)}>
                <X size={12} aria-hidden="true" /> Cancelar
              </Button>
              <Button size="sm" variant="solid" type="submit" disabled={isSavingCard}>
                <Save size={12} aria-hidden="true" /> {isSavingCard ? 'Guardando…' : 'Guardar tarjeta'}
              </Button>
            </div>
          </form>
        )}

        {/* Lista de tarjetas */}
        {flashcards.length === 0 && !isCreatingCard ? (
          <EmptyState
            title="Esta lección aún no tiene tarjetas de estudio asociadas."
            hint="Crea tarjetas manuales con «Nueva tarjeta» o extráelas automáticamente del contenido con «Generar con IA». Se integrarán inmediatamente en el algoritmo SuperMemo-2."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {flashcards.map(card => {
              const isEditingThis = editingCardId === card.id;
              const isDueToday = new Date(card.due_date) <= new Date();

              if (isEditingThis) {
                return (
                  <div key={card.id} className="col-span-full space-y-3 rounded-lg border border-accent bg-surface p-4 shadow-sm">
                    <p className="text-meta font-semibold text-ink">Editando tarjeta</p>
                    <div>
                      <label className="mb-1 block text-meta font-medium text-muted" htmlFor={`edit-front-${card.id}`}>Anverso</label>
                      <textarea
                        id={`edit-front-${card.id}`}
                        rows={2}
                        value={editCardForm.front}
                        onChange={e => setEditCardForm(f => ({ ...f, front: e.target.value }))}
                        className={cn(INPUT_CLS, 'resize-y')}
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-meta font-medium text-muted" htmlFor={`edit-back-${card.id}`}>Reverso</label>
                      <textarea
                        id={`edit-back-${card.id}`}
                        rows={3}
                        value={editCardForm.back}
                        onChange={e => setEditCardForm(f => ({ ...f, back: e.target.value }))}
                        className={cn(INPUT_CLS, 'resize-y')}
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="quiet" onClick={() => setEditingCardId(null)}>
                        <X size={12} aria-hidden="true" /> Cancelar
                      </Button>
                      <Button size="sm" variant="solid" onClick={() => void handleUpdateCard(card.id)}>
                        <Save size={12} aria-hidden="true" /> Guardar cambios
                      </Button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={card.id}
                  className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3.5 transition hover:border-line-strong"
                >
                  <div className="space-y-2">
                    <div>
                      <span className="text-micro font-semibold uppercase tracking-wider text-faint">Anverso</span>
                      <p className="mt-0.5 text-meta font-medium text-ink break-words">{card.front}</p>
                    </div>
                    <div className="border-t border-line/60 pt-2">
                      <span className="text-micro font-semibold uppercase tracking-wider text-faint">Reverso</span>
                      <p className="mt-0.5 text-secondary text-muted break-words">{card.back}</p>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5 text-micro">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={isDueToday ? 'warning' : 'neutral'} className="font-mono">
                        {isDueToday ? 'Para repasar' : `${card.interval_days}d`}
                      </Badge>
                      <span className="text-faint font-mono">
                        Reps: {card.repetition_count} · EF: {card.ease_factor.toFixed(2)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        size="sm"
                        variant="quiet"
                        onClick={() => handleStartEditCard(card)}
                        aria-label="Editar tarjeta"
                        className="h-7 px-2"
                      >
                        <Edit3 size={11} aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => setDeletingCardId(card.id)}
                        aria-label="Eliminar tarjeta"
                        className="h-7 px-2"
                      >
                        <Trash2 size={11} aria-hidden="true" />
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-micro font-medium text-muted" htmlFor="new-note-content">Contenido</label>
                  {playbackUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        const cur = videoRef.current?.currentTime || currentPlaybackSeconds || 0;
                        const stamp = `[${formatPlaybackTime(cur)}]`;
                        setNoteForm(f => ({
                          ...f,
                          content: f.content ? `${f.content} ${stamp} ` : `${stamp} `
                        }));
                      }}
                      className="inline-flex items-center gap-1 rounded border border-line bg-canvas px-1.5 py-0.5 text-micro font-medium text-muted hover:border-line-strong hover:text-ink transition-colors"
                      title="Insertar marca de tiempo actual del vídeo en la nota"
                    >
                      <Clock size={11} className="text-accent" aria-hidden="true" />
                      <span>Marca [{formatPlaybackTime(videoRef.current?.currentTime || currentPlaybackSeconds || 0)}]</span>
                    </button>
                  )}
                </div>
                <textarea
                  id="new-note-content"
                  value={noteForm.content}
                  onChange={e => setNoteForm(f => ({ ...f, content: e.target.value }))}
                  rows={3}
                  placeholder="Contenido… (incluye marcas como [02:30] para saltar al vídeo)"
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
                            onClick={() => handleSeekTo(part.seconds!, true)}
                            className="mx-0.5 inline-flex items-center gap-0.5 rounded border border-accent/40 bg-accent-soft px-1.5 py-0.5 font-mono text-micro font-semibold text-accent transition-colors hover:border-accent hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-focus"
                            title={`Saltar a ${part.rawTimestamp} en el vídeo`}
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

      {/* Confirmación accesible para eliminar flashcard */}
      <ConfirmDialog
        isOpen={Boolean(deletingCardId)}
        title="Eliminar tarjeta de estudio"
        consequence="Esta tarjeta se eliminará de la lección y del ciclo de repetición espaciada SM-2. Esta acción no se puede deshacer."
        confirmLabel="Eliminar tarjeta"
        tone="danger"
        onCancel={() => setDeletingCardId(null)}
        onConfirm={async () => {
          if (deletingCardId) {
            await handleDeleteCard(deletingCardId);
          }
        }}
      />

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
