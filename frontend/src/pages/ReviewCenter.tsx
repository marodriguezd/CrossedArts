import React, { useState, useEffect, useReducer, useMemo, useCallback } from 'react';
import type { Flashcard, LearningResource, LearningSession, StudySessionMode, ImageOcclusionData } from '../types/models.ts';
import {
  CheckCircle2,
  RotateCcw,
  Sparkles,
  ArrowRight,
  Play,
  Pause,
  X,
  Loader2,
  AlertCircle,
  Clock,
  Layers,
  ListChecks,
  Shuffle,
  CalendarClock,
  Filter,
  GraduationCap,
  BookOpen,
  Volume2,
  VolumeX
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { speechService } from '../services/speechService.ts';
import confetti from 'canvas-confetti';
import { FlashcardGenerationModal } from '../components/study/FlashcardGenerationModal.tsx';
import { ImageOcclusionEditor } from '../components/study/ImageOcclusionEditor.tsx';
import { ImageOcclusionViewer } from '../components/study/ImageOcclusionViewer.tsx';
import { PracticeQuestion } from '../components/study/PracticeQuestion.tsx';
import { aiService } from '../ai/aiService.ts';
import type { GeneratedQuestion, StudyDifficulty } from '../lib/studyGeneration/types.ts';
import { initialStudySessionState, studySessionReducer } from '../services/studySession.ts';
import {
  buildMixedStudyPlan,
  formatNextReviewInterval,
  summarizeStudySession,
  resolveShortcutOptionIndex,
  filterFlashcardsByOrigin
} from '../services/domainLogic.ts';
import { Button, InlineStatus, ProgressBar, Kbd, Chip, cn } from '../components/ui/index.tsx';

interface ReviewCenterProps {
  flashcards: Flashcard[];
  onRefresh: () => void;
  /** Recurso preseleccionado cuando se inicia el estudio desde otra vista. */
  initialResourceId?: string | null;
  /** Lección preseleccionada: activa el ámbito de estudio/recuperación a nivel de lección. */
  initialLessonId?: string | null;
  /** Modalidad preseleccionada desde la vista de origen. */
  initialMode?: StudySessionMode;
}

type StudyItem =
  | { key: string; kind: 'flashcard'; card: Flashcard }
  | { key: string; kind: 'practice'; question: GeneratedQuestion };

/**
 * Tonos de calificación SM-2: 0-2 son fallo de memorización (error), 3 es
 * difícil (aviso), 4 bien (informativo) y 5 perfecto (éxito). El color nunca
 * va solo: cada botón muestra grado, etiqueta y descripción.
 */
const GRADE_OPTIONS: Array<{ grade: number; label: string; hint: string; tone: string }> = [
  { grade: 0, label: '0 · Apagón', hint: 'Sin recuerdo alguno', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 1, label: '1 · Olvidado', hint: 'Error tras esfuerzo', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 2, label: '2 · Dudoso', hint: 'Incorrecta, familiar', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 3, label: '3 · Difícil', hint: 'Correcta con esfuerzo', tone: 'border-warning/30 bg-warning-soft text-warning hover:bg-warning-soft/70' },
  { grade: 4, label: '4 · Bien', hint: 'Correcta con duda', tone: 'border-info/30 bg-info-soft text-info hover:bg-info-soft/70' },
  { grade: 5, label: '5 · Perfecto', hint: 'Retención instantánea', tone: 'border-success/30 bg-success-soft text-success hover:bg-success-soft/70' }
];

const MODE_LABELS: Record<StudySessionMode, string> = {
  flashcards: 'Tarjetas SM-2',
  practice: 'Preguntas de práctica',
  mixed: 'Sesión mixta'
};

function isDue(dueDate: string): boolean {
  if (!dueDate) return true;
  const normalized = dueDate.includes('T') ? dueDate : `${dueDate.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return true;
  return parsed <= Date.now();
}

function parseSqliteUtc(value: string): number {
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export const ReviewCenter: React.FC<ReviewCenterProps> = ({ flashcards, onRefresh, initialResourceId, initialLessonId, initialMode }) => {
  const [state, dispatch] = useReducer(studySessionReducer, initialStudySessionState);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [lessonOptions, setLessonOptions] = useState<Array<{ id: string; title: string; courseTitle: string }>>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [selectedLessonId, setSelectedLessonId] = useState<string>('');
  const [originFilter, setOriginFilter] = useState<'all' | 'course' | 'book' | 'general'>('all');
  const [mode, setMode] = useState<StudySessionMode>('flashcards');
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState<number>(3);
  const [difficulty, setDifficulty] = useState<StudyDifficulty>('medium');

  const [items, setItems] = useState<StudyItem[]>([]);
  const [itemIndex, setItemIndex] = useState(0);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [showAnswer, setShowAnswer] = useState(false);
  const [gradeFeedback, setGradeFeedback] = useState<{ label: string; nextReview: string } | null>(null);

  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswerSubmitted, setIsAnswerSubmitted] = useState(false);

  const [summary, setSummary] = useState<LearningSession | null>(null);
  const [pendingResume, setPendingResume] = useState<LearningSession | null>(null);
  const [isFlashcardModalOpen, setIsFlashcardModalOpen] = useState(false);
  const [isOcclusionModalOpen, setIsOcclusionModalOpen] = useState(false);
  const [activeMaskIndex, setActiveMaskIndex] = useState(0);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [res, active, lessons] = await Promise.all([
          dao.getLearningResources(),
          dao.getActiveStudySession(),
          dao.getLessonOptions()
        ]);
        if (!mounted) return;
        setResources(res);
        setLessonOptions(lessons.map(l => ({ id: l.id, title: l.title, courseTitle: l.courseTitle })));
        setPendingResume(active);
      } catch (err) {
        console.warn('No se pudo cargar el estado de estudio local:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (initialResourceId) setSelectedResourceId(initialResourceId);
    if (initialLessonId) setSelectedLessonId(initialLessonId);
    if (initialMode) setMode(initialMode);
  }, [initialResourceId, initialLessonId, initialMode]);

  const resourceKindMap = useMemo(() => {
    const map = new Map<string, 'course' | 'book' | 'learning_resource'>();
    for (const r of resources) {
      map.set(r.id, r.type);
    }
    return map;
  }, [resources]);

  const filteredFlashcards = useMemo(() => {
    return filterFlashcardsByOrigin(flashcards, originFilter, resourceKindMap);
  }, [flashcards, originFilter, resourceKindMap]);

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId) || null,
    [resources, selectedResourceId]
  );

  const dueCount = useMemo(
    () => filteredFlashcards.filter(f => isDue(f.due_date) && (!selectedResourceId || f.resource_id === selectedResourceId)).length,
    [filteredFlashcards, selectedResourceId]
  );

  const currentItem = items[itemIndex];
  const currentCard = currentItem?.kind === 'flashcard' ? currentItem.card : null;
  const currentQuestion = currentItem?.kind === 'practice' ? currentItem.question : null;

  const prepareItems = useCallback(async (
    sessionMode: StudySessionMode,
    resourceId: string | undefined,
    resourceTitle: string | undefined,
    lessonId?: string
  ) => {
    setIsPreparing(true);
    setPrepareError(null);
    setItems([]);
    setItemIndex(0);
    setShowAnswer(false);
    setGradeFeedback(null);
    setSelectedOption(null);
    setIsAnswerSubmitted(false);

    try {
      let dueCards: Flashcard[] = [];
      let questions: GeneratedQuestion[] = [];

      if (sessionMode === 'flashcards' || sessionMode === 'mixed') {
        const rawDue = await dao.getDueFlashcards(resourceId);
        dueCards = filterFlashcardsByOrigin(rawDue, originFilter, resourceKindMap);
      }

      if (sessionMode === 'practice' || sessionMode === 'mixed') {
        try {
          const res = await aiService.generatePracticeQuestions({
            count,
            difficulty,
            topic: topic.trim() || undefined,
            resourceId,
            lessonId,
            resourceTitle
          });
          if (res.error) {
            setPrepareError(res.error);
          } else {
            questions = res.questions;
          }
        } catch (err: any) {
          // Un fallo de generación local no debe invalidar la sesión.
          setPrepareError(err?.message || 'No se pudieron generar las preguntas de práctica.');
        }
      }

      const plan = buildMixedStudyPlan(dueCards.length, questions.length);
      const built: StudyItem[] = [];
      let cardCursor = 0;
      let questionCursor = 0;
      for (let i = 0; i < plan.length; i++) {
        if (plan[i] === 'flashcard') {
          const card = dueCards[cardCursor++];
          built.push({ key: `fc-${card.id}-${i}`, kind: 'flashcard', card });
        } else {
          const question = questions[questionCursor++];
          built.push({ key: `q-${question.id}-${i}`, kind: 'practice', question });
        }
      }
      setItems(built);
    } catch (err: any) {
      setPrepareError(err?.message || 'Error preparando la sesión de estudio.');
    } finally {
      setIsPreparing(false);
    }
  }, [count, difficulty, topic]);

  const handleStart = async () => {
    const resourceId = selectedResourceId || undefined;
    const lessonId = selectedLessonId || undefined;
    setActionError(null);
    setSummary(null);
    dispatch({ type: 'START_REQUESTED', mode, resourceId, lessonId });

    let sessionId: string;
    try {
      sessionId = await dao.startStudySession({ mode, resourceId, lessonId });
    } catch (err: any) {
      dispatch({ type: 'START_FAILED', error: err?.message || 'No se pudo iniciar la sesión en el almacenamiento local.' });
      return;
    }
    dispatch({ type: 'STARTED', sessionId, startedAt: Date.now() });
    await prepareItems(mode, resourceId, selectedResource?.title, lessonId);
  };

  const handleResume = async () => {
    if (!pendingResume) return;
    const active = pendingResume;
    setPendingResume(null);
    setActionError(null);
    setSummary(null);
    dispatch({
      type: 'RESUMED',
      sessionId: active.id,
      mode: active.mode,
      resourceId: active.resource_id,
      lessonId: active.lesson_id,
      startedAt: parseSqliteUtc(active.started_at)
    });
    setSelectedResourceId(active.resource_id || '');
    setSelectedLessonId(active.lesson_id || '');
    await prepareItems(active.mode, active.resource_id, active.resource_title, active.lesson_id);
  };

  const handleDiscardPending = async () => {
    if (!pendingResume) return;
    try {
      await dao.finalizeStudySession(pendingResume.id);
    } catch {
      /* Silencioso: una sesión abandonada sin actividad no genera historial. */
    }
    setPendingResume(null);
    onRefresh();
  };

  const advance = useCallback(async () => {
    speechService.stopSpeaking();
    setIsPlayingAudio(false);
    setGradeFeedback(null);
    setShowAnswer(false);
    setSelectedOption(null);
    setIsAnswerSubmitted(false);
    setActiveMaskIndex(0);
    const next = itemIndex + 1;
    if (next >= items.length) {
      if (!state.sessionId) return;
      try {
        const finalStatus = await dao.finalizeStudySession(state.sessionId);
        const row = await dao.getStudySessionById(state.sessionId);
        setSummary(row);
        if (finalStatus === 'completed') {
          dispatch({ type: 'COMPLETED' });
          confetti({ particleCount: 70, spread: 60, origin: { y: 0.7 } });
        } else {
          dispatch({ type: 'CANCELLED' });
        }
        onRefresh();
      } catch (err: any) {
        dispatch({ type: 'FINALIZE_FAILED', error: err?.message || 'No se pudo guardar el resumen de la sesión.' });
      }
    } else {
      setItemIndex(next);
    }
  }, [itemIndex, items.length, state.sessionId, onRefresh]);

  const handleToggleAudio = useCallback(() => {
    if (!currentCard) return;
    if (isPlayingAudio) {
      speechService.stopSpeaking();
      setIsPlayingAudio(false);
    } else {
      const textToRead = showAnswer
        ? `${currentCard.front}. ${currentCard.back}`
        : currentCard.front;
      setIsPlayingAudio(true);
      speechService.speak(
        textToRead,
        () => setIsPlayingAudio(false),
        () => setIsPlayingAudio(false)
      );
    }
  }, [currentCard, showAnswer, isPlayingAudio]);

  useEffect(() => {
    return () => {
      speechService.stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (state.phase === 'active' && currentCard && speechService.getSettings().autoReadFlashcards) {
      const textToRead = showAnswer
        ? `${currentCard.front}. ${currentCard.back}`
        : currentCard.front;
      setIsPlayingAudio(true);
      speechService.speak(
        textToRead,
        () => setIsPlayingAudio(false),
        () => setIsPlayingAudio(false)
      );
    }
  }, [currentCard, showAnswer, state.phase]);

  const handleGrade = useCallback(async (grade: number) => {
    if (!currentCard || !state.sessionId) return;
    setActionError(null);
    try {
      const result = await dao.reviewFlashcardSM2(currentCard.id, grade);
      try {
        await dao.recordStudyFlashcardReview(state.sessionId);
      } catch {
        setActionError('La tarjeta se guardó, pero no se pudo actualizar el contador de la sesión.');
      }
      const option = GRADE_OPTIONS.find(o => o.grade === grade);
      setGradeFeedback({
        label: option?.label || `Grado ${grade}`,
        nextReview: result ? formatNextReviewInterval(result.intervalDays) : 'actualizado'
      });
    } catch (err: any) {
      setActionError(err?.message || 'No se pudo guardar el repaso SM-2 en el almacenamiento local.');
    }
  }, [currentCard, state.sessionId]);

  const handleSubmitAnswer = useCallback(async () => {
    if (selectedOption === null || !currentQuestion) return;
    setIsAnswerSubmitted(true);
    const correct = selectedOption === currentQuestion.correctIndex;
    if (state.sessionId) {
      try {
        await dao.recordStudyQuestionAnswer(state.sessionId, correct);
      } catch {
        setActionError('No se pudo registrar la respuesta en el historial local de la sesión.');
      }
    }
  }, [selectedOption, currentQuestion, state.sessionId]);

  useEffect(() => {
    if (state.phase !== 'active' || isPreparing || isFlashcardModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Las combinaciones con modificador NO pertenecen a este atajo: son de la
      // aplicación o del sistema (por ejemplo Ctrl+K / Cmd+K abren la paleta de
      // comandos global). Sin esta guarda, Cmd+K calificaría la tarjeta en curso
      // mientras abría la paleta.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignorar si el foco está en un campo de texto interactivo
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return;
        }
      }

      // Atajos de flashcards
      if (currentCard) {
        if (e.key === 'r' || e.key === 'R') {
          e.preventDefault();
          handleToggleAudio();
          return;
        }

        if (gradeFeedback) {
          if (e.code === 'Space' || e.key === 'Enter') {
            e.preventDefault();
            advance();
          }
          return;
        }

        if (!showAnswer) {
          if (e.code === 'Space' || e.key === 'Enter') {
            e.preventDefault();
            setShowAnswer(true);
          }
          return;
        }

        if (showAnswer) {
          const keyNum = e.key >= '0' && e.key <= '5' ? parseInt(e.key, 10) : null;
          if (keyNum !== null) {
            e.preventDefault();
            handleGrade(keyNum);
            return;
          }
          if (e.code === 'Space') {
            e.preventDefault();
            setShowAnswer(false);
            return;
          }
        }
      }

      // Atajos de preguntas de práctica
      if (currentQuestion) {
        if (!isAnswerSubmitted) {
          const optIdx = resolveShortcutOptionIndex(e.key, currentQuestion.options.length);
          if (optIdx !== null) {
            e.preventDefault();
            setSelectedOption(optIdx);
            return;
          }
          // Enter para comprobar respuesta si hay opción elegida
          if (e.key === 'Enter' && selectedOption !== null) {
            e.preventDefault();
            handleSubmitAnswer();
            return;
          }
        } else {
          // Ya comprobada: Enter o Espacio para avanzar
          if (e.key === 'Enter' || e.code === 'Space') {
            e.preventDefault();
            advance();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state.phase,
    isPreparing,
    isFlashcardModalOpen,
    currentCard,
    currentQuestion,
    showAnswer,
    gradeFeedback,
    isAnswerSubmitted,
    selectedOption,
    advance,
    handleGrade,
    handleSubmitAnswer,
    handleToggleAudio
  ]);

  const handleCancel = async () => {
    speechService.stopSpeaking();
    setIsPlayingAudio(false);
    if (!state.sessionId) {
      dispatch({ type: 'RESET' });
      return;
    }
    try {
      await dao.cancelStudySession(state.sessionId);
      dispatch({ type: 'CANCELLED' });
      setGradeFeedback(null);
      setShowAnswer(false);
      onRefresh();
    } catch (err: any) {
      setActionError(err?.message || 'No se pudo cancelar la sesión en el almacenamiento local.');
    }
  };

  const handleFinishPartial = async () => {
    if (!state.sessionId) return;
    try {
      const finalStatus = await dao.finalizeStudySession(state.sessionId);
      const row = await dao.getStudySessionById(state.sessionId);
      setSummary(row);
      dispatch({ type: finalStatus === 'completed' ? 'COMPLETED' : 'CANCELLED' });
      onRefresh();
    } catch (err: any) {
      setActionError(err?.message || 'No se pudo finalizar la sesión.');
    }
  };

  const resetToIdle = () => {
    dispatch({ type: 'RESET' });
    setSummary(null);
    setItems([]);
    setItemIndex(0);
    setPrepareError(null);
    setActionError(null);
    setMode('flashcards');
    setSelectedResourceId('');
    setSelectedLessonId('');
  };

  const sessionSummary = summarizeStudySession(
    summary
      ? {
          cards_reviewed: summary.cards_reviewed,
          questions_answered: summary.questions_answered,
          correct_answers: summary.correct_answers,
          duration_minutes: summary.duration_minutes
        }
      : { cards_reviewed: 0, questions_answered: 0, correct_answers: 0, duration_minutes: 0 }
  );

  const isActive = state.phase === 'active' || state.phase === 'paused';

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

  return (
    <div className="mx-auto max-w-3xl animate-fade-in space-y-6">
      {/* Cabecera */}
      <header className="border-b border-line pb-5 text-center">
        <h1 className="type-display text-ink">Centro de repaso</h1>
        <p className="type-secondary mx-auto mt-2 max-w-xl">
          Repasa tarjetas con intervalos SM-2, practica con preguntas fundamentadas y conserva un
          historial local de tu progreso.
        </p>
      </header>

      {/* Banner de sesión activa pendiente (reanudación tras recarga) */}
      {state.phase === 'idle' && pendingResume && (
        <InlineStatus tone="warning" className="justify-between">
          <span className="flex min-w-0 items-start gap-3">
            <CalendarClock size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Tienes una sesión de estudio sin finalizar</strong>
              <span className="mt-0.5 block">
                {MODE_LABELS[pendingResume.mode]} · {pendingResume.cards_reviewed} tarjetas · {pendingResume.questions_answered} preguntas registradas
              </span>
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="solid" onClick={handleResume}>
              Reanudar
            </Button>
            <Button size="sm" variant="outline" onClick={handleDiscardPending}>
              Descartar
            </Button>
          </span>
        </InlineStatus>
      )}

      {/* Panel de inicio */}
      {(state.phase === 'idle' || state.phase === 'failed') && !isPreparing && (
        <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-label="Configuración de la sesión">
          <div className="space-y-2">
            <span className="type-micro">Modalidad</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {([
                { id: 'flashcards', label: 'Tarjetas SM-2', icon: Layers, desc: `${dueCount} pendientes` },
                { id: 'practice', label: 'Práctica', icon: ListChecks, desc: 'Preguntas generadas' },
                { id: 'mixed', label: 'Mixta', icon: Shuffle, desc: 'Tarjetas + práctica' }
              ] as Array<{ id: StudySessionMode; label: string; icon: any; desc: string }>).map(opt => {
                const Icon = opt.icon;
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => setMode(opt.id)}
                    aria-pressed={active}
                    className={cn(
                      'rounded-xl border p-3 text-left transition-colors duration-fast',
                      active
                        ? 'border-accent/50 bg-accent-soft font-semibold text-ink shadow-card'
                        : 'border-line bg-canvas text-muted hover:border-line-strong hover:text-ink'
                    )}
                  >
                    <span className="flex items-center gap-2 text-secondary">
                      <Icon size={15} className={active ? 'text-accent' : ''} aria-hidden="true" /> {opt.label}
                    </span>
                    <span className="mt-1 block text-meta">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Filtro por origen de tarjeta */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="type-micro flex items-center gap-1.5">
                <Filter size={12} className="text-accent" aria-hidden="true" />
                Origen del mazo ({dueCount} pendientes)
              </span>
              {originFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setOriginFilter('all')}
                  className="text-meta text-muted underline hover:text-ink"
                >
                  Restablecer
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por origen">
              <Chip active={originFilter === 'all'} onClick={() => setOriginFilter('all')}>
                Todo ({flashcards.filter(f => isDue(f.due_date)).length})
              </Chip>
              <Chip active={originFilter === 'course'} onClick={() => setOriginFilter('course')}>
                <GraduationCap size={13} aria-hidden="true" className="mr-1 inline" /> Cursos
              </Chip>
              <Chip active={originFilter === 'book'} onClick={() => setOriginFilter('book')}>
                <BookOpen size={13} aria-hidden="true" className="mr-1 inline" /> Libros
              </Chip>
              <Chip active={originFilter === 'general'} onClick={() => setOriginFilter('general')}>
                General
              </Chip>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-resource">Recurso específico (opcional)</label>
              <select
                id="study-resource"
                value={selectedResourceId}
                onChange={e => setSelectedResourceId(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">Todos los recursos</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
              {selectedLessonId && (
                <p className="mt-1.5 flex items-center gap-1 text-meta text-accent">
                  Ámbito de lección activo: {lessonOptions.find(l => l.id === selectedLessonId)?.title || 'lección seleccionada'}
                  <button type="button" onClick={() => setSelectedLessonId('')} className="underline text-muted hover:text-ink">
                    quitar
                  </button>
                </p>
              )}
            </div>

            {(mode === 'practice' || mode === 'mixed') && (
              <div>
                <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-topic">Tema o consulta guía</label>
                <input
                  id="study-topic"
                  type="text"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="Ej. Repetición espaciada, Hooks…"
                  className={INPUT_CLS}
                />
              </div>
            )}
          </div>

          {(mode === 'practice' || mode === 'mixed') && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-count">Número de preguntas ({count})</label>
                <input id="study-count" type="range" min="3" max="6" value={count} onChange={e => setCount(parseInt(e.target.value, 10))} className="w-full cursor-pointer accent-accent" />
              </div>
              <div>
                <span className="mb-1 block text-meta font-medium text-muted" id="study-difficulty-label">Dificultad</span>
                <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas p-1" role="group" aria-labelledby="study-difficulty-label">
                  {(['easy', 'medium', 'hard'] as StudyDifficulty[]).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      aria-pressed={difficulty === d}
                      className={cn(
                        'rounded-lg py-1.5 text-meta capitalize transition-colors',
                        difficulty === d ? 'bg-ink font-semibold text-canvas' : 'text-muted hover:text-ink'
                      )}
                    >
                      {d === 'easy' ? 'Fácil' : d === 'medium' ? 'Media' : 'Difícil'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
            <Button variant="solid" onClick={handleStart}>
              <Play size={14} aria-hidden="true" /> Iniciar sesión
            </Button>
            <Button variant="outline" onClick={() => setIsFlashcardModalOpen(true)}>
              <Sparkles size={14} aria-hidden="true" /> Generar flashcards
            </Button>
            <Button variant="outline" onClick={() => setIsOcclusionModalOpen(true)}>
              <Layers size={14} aria-hidden="true" /> Oclusión de imagen
            </Button>
          </div>

          {state.phase === 'failed' && state.error && (
            <InlineStatus tone="error">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{state.error}</span>
            </InlineStatus>
          )}
        </section>
      )}

      {/* Preparando / starting */}
      {(isPreparing || state.phase === 'starting') && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
          <Loader2 size={26} className="mx-auto animate-spin text-accent" aria-hidden="true" />
          <p className="text-body text-ink">Preparando tu sesión de estudio local…</p>
          <p className="type-meta">Recuperando tarjetas pendientes y contexto local de SQLite</p>
        </div>
      )}

      {/* Sesión activa */}
      {isActive && !isPreparing && (
        <div className="space-y-5">
          {/* Barra superior de sesión */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-meta text-muted">
              <Clock size={14} className="text-accent" aria-hidden="true" />
              <span className="font-semibold text-ink">{MODE_LABELS[state.mode]}</span>
              {selectedResource && <span className="truncate">· {selectedResource.title}</span>}
              {selectedLessonId && (
                <span className="truncate">· Lección: {lessonOptions.find(l => l.id === selectedLessonId)?.title || 'ámbito de lección'}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="quiet" onClick={() => dispatch({ type: state.phase === 'paused' ? 'RESUME' : 'PAUSE' })}>
                {state.phase === 'paused' ? <><Play size={12} aria-hidden="true" /> Reanudar</> : <><Pause size={12} aria-hidden="true" /> Pausar</>}
              </Button>
              <Button size="sm" variant="danger" onClick={handleCancel}>
                <X size={12} aria-hidden="true" /> Cancelar sesión
              </Button>
            </div>
          </div>

          {state.phase === 'paused' ? (
            <div className="space-y-3 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
              <Pause size={26} className="mx-auto text-warning" aria-hidden="true" />
              <p className="text-body text-ink">Sesión en pausa</p>
              <p className="type-meta mx-auto max-w-sm">
                Tus repasos ya guardados permanecen intactos. Reanuda cuando quieras continuar.
              </p>
            </div>
          ) : currentItem ? (
            <>
              <div className="flex items-center justify-between text-meta text-muted">
                <span>Ítem {itemIndex + 1} de {items.length}</span>
                <span>{currentCard ? `Factor de facilidad: ${currentCard.ease_factor}` : 'Práctica efímera'}</span>
              </div>
              <ProgressBar
                value={itemIndex + 1}
                max={items.length}
                label="Progreso de la sesión"
              />

              {currentCard && (
                <div className="space-y-4">
                  {currentCard.card_type === 'image_occlusion' && currentCard.extra_data ? (
                    (() => {
                      let occlusionData: ImageOcclusionData | null = null;
                      try {
                        occlusionData = JSON.parse(currentCard.extra_data) as ImageOcclusionData;
                      } catch {
                        occlusionData = null;
                      }
                      if (occlusionData) {
                        return (
                          <div className="space-y-4 rounded-xl border border-line bg-raised p-5 shadow-pop sm:p-7">
                            <div className="flex items-center justify-between">
                              <span className="type-micro text-accent">
                                Oclusión de imagen · {showAnswer ? 'Respuestas visibles' : 'Área oculta'}
                              </span>
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleToggleAudio();
                                  }}
                                  aria-label={isPlayingAudio ? 'Detener lectura en voz alta' : 'Leer tarjeta en voz alta (R)'}
                                  className="p-1.5 rounded-lg border border-line bg-canvas text-muted hover:text-ink hover:bg-accent-soft transition-colors cursor-pointer"
                                  title="Leer en voz alta (R)"
                                >
                                  {isPlayingAudio ? (
                                    <VolumeX size={14} className="text-accent animate-pulse" aria-hidden="true" />
                                  ) : (
                                    <Volume2 size={14} aria-hidden="true" />
                                  )}
                                </button>
                                <span className="text-meta text-muted">
                                  SM-2 · {currentCard.interval_days}d
                                </span>
                              </div>
                            </div>
                            <h2 className="font-serif text-lg font-bold leading-snug text-ink md:text-xl">
                              {currentCard.front}
                            </h2>

                            <ImageOcclusionViewer
                              data={occlusionData}
                              activeMaskIndex={activeMaskIndex}
                              isRevealed={showAnswer}
                              onToggleReveal={() => setShowAnswer(v => !v)}
                              onSelectMask={(idx) => setActiveMaskIndex(idx)}
                            />

                            {showAnswer && currentCard.back && (
                              <div className="border-t border-line pt-3 text-meta text-muted">
                                <p className="whitespace-pre-line leading-relaxed">{currentCard.back}</p>
                              </div>
                            )}
                          </div>
                        );
                      }
                      return null;
                    })() || (
                      <button
                        type="button"
                        onClick={() => setShowAnswer(v => !v)}
                        aria-expanded={showAnswer}
                        aria-label={showAnswer ? 'Ocultar respuesta de la tarjeta' : 'Revelar respuesta de la tarjeta'}
                        className="flex min-h-[240px] w-full flex-col justify-between rounded-xl border border-line bg-raised p-7 text-left shadow-pop transition-colors duration-fast hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:p-9"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <span className="type-micro text-accent">
                              {showAnswer ? 'Reverso / Respuesta' : 'Anverso / Pregunta'}
                            </span>
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleAudio();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.stopPropagation();
                                  handleToggleAudio();
                                }
                              }}
                              aria-label={isPlayingAudio ? 'Detener lectura en voz alta' : 'Leer tarjeta en voz alta (R)'}
                              className="p-1.5 rounded-lg border border-line bg-canvas text-muted hover:text-ink hover:bg-accent-soft transition-colors cursor-pointer"
                              title="Leer en voz alta (R)"
                            >
                              {isPlayingAudio ? (
                                <VolumeX size={14} className="text-accent animate-pulse" aria-hidden="true" />
                              ) : (
                                <Volume2 size={14} aria-hidden="true" />
                              )}
                            </span>
                          </div>
                          <h2 className="mt-4 font-serif text-xl font-bold leading-relaxed text-ink md:text-2xl">
                            {currentCard.front}
                          </h2>
                        </div>
                        {showAnswer ? (
                          <div className="mt-6 border-t border-line pt-6">
                            <p className="text-body leading-relaxed text-ink" style={{ lineHeight: 1.7 }}>
                              {currentCard.back}
                            </p>
                          </div>
                        ) : (
                          <div className="pt-8 text-center">
                            <span className="inline-flex items-center gap-1.5 text-meta text-faint">
                              <Sparkles size={13} aria-hidden="true" /> Pulsa o presiona <Kbd>Espacio</Kbd> para revelar la respuesta
                            </span>
                          </div>
                        )}
                      </button>
                    )
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowAnswer(v => !v)}
                      aria-expanded={showAnswer}
                      aria-label={showAnswer ? 'Ocultar respuesta de la tarjeta' : 'Revelar respuesta de la tarjeta'}
                      className="flex min-h-[240px] w-full flex-col justify-between rounded-xl border border-line bg-raised p-7 text-left shadow-pop transition-colors duration-fast hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:p-9"
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="type-micro text-accent">
                            {showAnswer ? 'Reverso / Respuesta' : 'Anverso / Pregunta'}
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleAudio();
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.stopPropagation();
                                handleToggleAudio();
                              }
                            }}
                            aria-label={isPlayingAudio ? 'Detener lectura en voz alta' : 'Leer tarjeta en voz alta (R)'}
                            className="p-1.5 rounded-lg border border-line bg-canvas text-muted hover:text-ink hover:bg-accent-soft transition-colors cursor-pointer"
                            title="Leer en voz alta (R)"
                          >
                            {isPlayingAudio ? (
                              <VolumeX size={14} className="text-accent animate-pulse" aria-hidden="true" />
                            ) : (
                              <Volume2 size={14} aria-hidden="true" />
                            )}
                          </span>
                        </div>
                        <h2 className="mt-4 font-serif text-xl font-bold leading-relaxed text-ink md:text-2xl">
                          {currentCard.front}
                        </h2>
                      </div>
                      {showAnswer ? (
                        <div className="mt-6 border-t border-line pt-6">
                          <p className="text-body leading-relaxed text-ink" style={{ lineHeight: 1.7 }}>
                            {currentCard.back}
                          </p>
                        </div>
                      ) : (
                        <div className="pt-8 text-center">
                          <span className="inline-flex items-center gap-1.5 text-meta text-faint">
                            <Sparkles size={13} aria-hidden="true" /> Pulsa o presiona <Kbd>Espacio</Kbd> para revelar la respuesta
                          </span>
                        </div>
                      )}
                    </button>
                  )}

                  {gradeFeedback ? (
                    <div className="space-y-3 rounded-xl border border-success/30 bg-success-soft p-5 text-center" aria-live="polite">
                      <p className="text-body font-semibold text-ink">Repaso registrado · {gradeFeedback.label}</p>
                      <p className="text-secondary text-muted">
                        Próximo repaso: <strong className="text-success">{gradeFeedback.nextReview}</strong>
                      </p>
                      <Button variant="solid" onClick={advance} className="gap-2">
                        {itemIndex + 1 < items.length ? 'Siguiente ítem' : 'Ver resumen'} <ArrowRight size={14} aria-hidden="true" />
                        <Kbd className="border-current/25 bg-black/10 text-inherit">Espacio</Kbd>
                      </Button>
                    </div>
                  ) : showAnswer && (
                    <div className="space-y-2">
                      <p className="text-center text-meta font-medium text-muted">¿Qué tan fácil recordaste este concepto?</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                        {GRADE_OPTIONS.map(opt => (
                          <button
                            key={opt.grade}
                            onClick={() => handleGrade(opt.grade)}
                            aria-label={`Calificar como ${opt.label}. ${opt.hint}`}
                            className={cn(
                              'flex flex-col justify-between rounded-xl border p-3 text-meta font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                              opt.tone
                            )}
                          >
                            <div className="flex w-full items-center justify-between gap-1">
                              <span>{opt.label}</span>
                              <Kbd className="border-current/30 bg-transparent text-current opacity-80">{opt.grade}</Kbd>
                            </div>
                            <span className="mt-0.5 block text-left text-micro font-normal opacity-80">{opt.hint}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {currentQuestion && (
                <PracticeQuestion
                  question={currentQuestion}
                  selectedOption={selectedOption}
                  isAnswerSubmitted={isAnswerSubmitted}
                  onSelectOption={setSelectedOption}
                  onSubmit={handleSubmitAnswer}
                  onNext={advance}
                  isLast={itemIndex + 1 >= items.length}
                />
              )}

              {/* Barra de atajos de teclado contextual */}
              <div
                className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-meta text-muted shadow-sm backdrop-blur"
                aria-label="Guía de atajos de teclado"
              >
                <span className="flex items-center gap-1.5 font-medium text-ink">
                  <Sparkles size={13} className="text-accent" aria-hidden="true" /> Atajos activos:
                </span>
                <div className="flex flex-wrap items-center gap-3">
                  {currentCard && !showAnswer && !gradeFeedback && (
                    <span><Kbd>Espacio</Kbd> o <Kbd>Enter</Kbd> Revelar respuesta</span>
                  )}
                  {currentCard && showAnswer && !gradeFeedback && (
                    <span><Kbd>0</Kbd> al <Kbd>5</Kbd> Calificar SM-2</span>
                  )}
                  {currentCard && gradeFeedback && (
                    <span><Kbd>Espacio</Kbd> o <Kbd>Enter</Kbd> Siguiente tarjeta</span>
                  )}
                  {currentQuestion && !isAnswerSubmitted && (
                    <>
                      <span><Kbd>1</Kbd>-<Kbd>{currentQuestion.options.length}</Kbd> o <Kbd>A</Kbd>-<Kbd>{String.fromCharCode(64 + currentQuestion.options.length)}</Kbd> Seleccionar</span>
                      <span><Kbd>Enter</Kbd> Comprobar</span>
                    </>
                  )}
                  {currentQuestion && isAnswerSubmitted && (
                    <span><Kbd>Enter</Kbd> o <Kbd>Espacio</Kbd> Siguiente pregunta</span>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-4 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
              <AlertCircle size={26} className="mx-auto text-warning" aria-hidden="true" />
              <h2 className="type-section text-ink">No hay ítems para esta sesión</h2>
              <p className="type-secondary mx-auto max-w-md">
                {prepareError || 'No encontramos tarjetas pendientes ni pudimos generar preguntas para la selección actual.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="outline" onClick={() => prepareItems(state.mode, state.resourceId, selectedResource?.title)}>
                  Reintentar preparación
                </Button>
                <Button variant="solid" onClick={handleFinishPartial}>
                  Finalizar sesión
                </Button>
              </div>
            </div>
          )}

          {actionError && (
            <InlineStatus tone="error">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{actionError}</span>
            </InlineStatus>
          )}
          {prepareError && currentItem && (
            <InlineStatus tone="warning">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{prepareError} Puedes continuar con las tarjetas de la sesión.</span>
            </InlineStatus>
          )}
        </div>
      )}

      {/* Resumen de sesión */}
      {(state.phase === 'completed' || state.phase === 'cancelled') && (
        <div className="space-y-4 rounded-xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
          <div className={cn(
            'mx-auto flex h-14 w-14 items-center justify-center rounded-xl border',
            state.phase === 'completed' ? 'border-success/30 bg-success-soft text-success' : 'border-line bg-canvas text-muted'
          )}>
            {state.phase === 'completed' ? <CheckCircle2 size={28} aria-hidden="true" /> : <X size={28} aria-hidden="true" />}
          </div>
          <div>
            <h2 className="type-title text-ink">
              {state.phase === 'completed' ? 'Sesión completada' : 'Sesión cancelada'}
            </h2>
            <p className="type-secondary mt-1">
              {state.phase === 'completed'
                ? 'Tus repasos SM-2 y tu historial local se guardaron correctamente.'
                : 'Los repasos ya guardados se conservan; el ítem en curso no se registró.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="type-micro">Ítems repasados</p>
              <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.itemsReviewed}</p>
            </div>
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="type-micro">Tarjetas</p>
              <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.flashcards}</p>
            </div>
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="type-micro">Preguntas</p>
              <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.questions}</p>
            </div>
            <div className="rounded-xl border border-line bg-canvas p-3">
              <p className="type-micro">Duración</p>
              <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.durationMinutes} min</p>
            </div>
          </div>

          {sessionSummary.questions > 0 && (
            <p className="text-secondary text-muted">
              Práctica: <strong className="text-success">{sessionSummary.correct}</strong> correctas ·{' '}
              <strong className="text-error">{sessionSummary.incorrect}</strong> incorrectas
            </p>
          )}

          <Button variant="solid" onClick={resetToIdle}>
            <RotateCcw size={14} aria-hidden="true" /> Nueva sesión
          </Button>
        </div>
      )}

      {/* Modal de generación de tarjetas */}
      <FlashcardGenerationModal
        isOpen={isFlashcardModalOpen}
        onClose={() => setIsFlashcardModalOpen(false)}
        resourceId={selectedResourceId || undefined}
        lessonId={selectedLessonId || undefined}
        onCardsSaved={() => {
          onRefresh();
        }}
      />

      {/* Modal de editor de oclusión de imagen */}
      <ImageOcclusionEditor
        isOpen={isOcclusionModalOpen}
        onClose={() => setIsOcclusionModalOpen(false)}
        resourceId={selectedResourceId || undefined}
        lessonId={selectedLessonId || undefined}
        onCardSaved={() => {
          onRefresh();
        }}
      />
    </div>
  );
};
