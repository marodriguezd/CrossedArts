import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLanguage } from '../../hooks/useLanguage.ts';
import type {
  Lesson,
  LessonWorkspace as LessonWorkspaceModel,
  StudySessionMode,
  Flashcard
} from '../../types/models.ts';
import { AlertCircle, Loader2 } from 'lucide-react';
import { dao } from '../../db/dao.ts';
import { localMediaService } from '../../services/localMediaService.ts';
import {
  calculatePlaybackJump,
  resolveNextPlaybackSpeed
} from '../../services/domainLogic.ts';
import { FlashcardGenerationModal } from '../study/FlashcardGenerationModal.tsx';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import { InlineStatus } from '../ui/index.tsx';
import {
  LessonHeader,
  LessonVideoPlayer,
  LessonContentEditor,
  LessonFlashcardsSection,
  LessonNotesAndRelations
} from './index.ts';

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
  const { t } = useLanguage();
  const [workspace, setWorkspace] = useState<LessonWorkspaceModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [isLocalMedia, setIsLocalMedia] = useState(false);
  const [mediaLoading, setMediaLoading] = useState(false);

  // Media-player control and position memory
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

  // Restore and record position in local storage (localStorage)
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
      // Ignore storage restrictions
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
        // Ignore
      }
    }
  };

  const handlePause = () => {
    if (videoRef.current) {
      try {
        localStorage.setItem(`crossedarts-playback:${lesson.id}`, String(videoRef.current.currentTime));
      } catch {
        // Ignore storage failure
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
          // Ignore
        }
      }
    };
  }, [lesson.id]);

  // Playback speed (persists the user preference)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('crossedarts-playback-speed');
      return saved ? parseFloat(saved) || 1 : 1;
    } catch {
      return 1;
    }
  });

  // Brief on-video notification when controls change
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
      // Ignore restrictions
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
      // Ignore user dismissal or lack of Picture-in-Picture support
    }
  }, [showToastFeedback]);

  // Global media-playback shortcuts (Space, J/L, arrows, M, [ ])
  useEffect(() => {
    if (!playbackUrl) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Modified combos do NOT belong to this shortcut: they belong to the app
      // or the OS (e.g. Ctrl+K / Cmd+K open the global command palette). Without
      // this guard, Cmd+L jumped -10s, Cmd+M muted, and Cmd+K paused the video
      // while opening the palette.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Avoid capturing while the user types in notes, inputs, or selects
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
      console.warn('Failed to load the lesson workspace:', err);
    } finally {
      setIsLoading(false);
    }
  }, [lesson.id, courseId]);

  useEffect(() => {
    loadWorkspace();
  }, [loadWorkspace]);

  // Ephemeral local media for the active lesson; revoked on lesson change or unmount.
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
      setFeedback({ type: 'error', text: res.error || t('lessonWorkspace.saveFail') });
      return;
    }
    setIsEditing(false);
    setFeedback({ type: 'success', text: t('lessonWorkspace.updated') });
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
    setFeedback({ type: 'success', text: t('lessonWorkspace.noteCreated') });
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
        setFeedback({ type: 'success', text: t('lessonWorkspace.cardCreated') });
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

  return (
    <div className="space-y-5">
      <LessonHeader
        moduleTitle={moduleTitle}
        lesson={lesson}
        progress={progress}
        onMoveLesson={(dir) => onMoveLesson(lesson.id, dir)}
        onToggleComplete={handleToggleComplete}
        onStudyLesson={(mode) => onStudyLesson(lesson.id, mode)}
        onExplainResource={() => onExplainResource(courseId, lesson.title, lesson.id)}
        onOpenGenerateModal={() => setIsGenOpen(true)}
        feedback={feedback}
      />

      <LessonVideoPlayer
        lesson={lesson}
        playbackUrl={playbackUrl}
        isLocalMedia={isLocalMedia}
        mediaLoading={mediaLoading}
        videoRef={videoRef}
        currentPlaybackSeconds={currentPlaybackSeconds}
        resumedTime={resumedTime}
        playbackSpeed={playbackSpeed}
        playerOverlayToast={playerOverlayToast}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPause={handlePause}
        onJump={handleJump}
        onSpeedChange={handleSpeedChange}
        onTogglePip={handleTogglePip}
        onAssociateFile={handleAssociateFile}
      />

      <LessonContentEditor
        lesson={lesson}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        editForm={editForm}
        setEditForm={setEditForm}
        isSaving={isSaving}
        onSaveLesson={handleSaveLesson}
        onSeekTo={(seconds) => handleSeekTo(seconds, true)}
      />

      <LessonFlashcardsSection
        flashcards={flashcards}
        isCreatingCard={isCreatingCard}
        setIsCreatingCard={setIsCreatingCard}
        cardForm={cardForm}
        setCardForm={setCardForm}
        isSavingCard={isSavingCard}
        onCreateCard={handleCreateCard}
        editingCardId={editingCardId}
        setEditingCardId={setEditingCardId}
        editCardForm={editCardForm}
        setEditCardForm={setEditCardForm}
        onUpdateCard={handleUpdateCard}
        onStartEditCard={handleStartEditCard}
        onDeleteCardClick={(cardId) => setDeletingCardId(cardId)}
        onStudyFlashcards={() => onStudyLesson(lesson.id, 'flashcards')}
        onOpenGenerateModal={() => setIsGenOpen(true)}
      />

      <LessonNotesAndRelations
        notes={notes}
        resources={resources}
        concepts={concepts}
        relatedBooks={relatedBooks}
        flashcardCount={flashcardCount}
        nextLesson={nextLesson}
        isCreatingNote={isCreatingNote}
        setIsCreatingNote={setIsCreatingNote}
        noteForm={noteForm}
        setNoteForm={setNoteForm}
        onCreateNote={handleCreateNote}
        playbackUrl={playbackUrl}
        currentPlaybackSeconds={currentPlaybackSeconds}
        onSeekTo={(seconds) => handleSeekTo(seconds, true)}
        onOpenNote={onOpenNote}
        onOpenResource={onOpenResource}
        onOpenConcept={onOpenConcept}
        onStudyResource={onStudyResource}
        onExplainResource={onExplainResource}
        onSelectLesson={onSelectLesson}
      />

      <ConfirmDialog
        isOpen={Boolean(deletingCardId)}
        title="Eliminar tarjeta de estudio"
        consequence={t('lessonWorkspace.deleteCardConsequence')}
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
