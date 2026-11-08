import React, { useState, useEffect, useReducer, useMemo, useCallback } from 'react';
import { useLanguage } from '../hooks/useLanguage.ts';
import type { Flashcard, LearningResource, LearningSession, StudySessionMode } from '../types/models.ts';
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
import { parseImageOcclusionData } from '../services/imageOcclusion.ts';
import { speechService } from '../services/speechService.ts';
import confetti from 'canvas-confetti';
import { FlashcardGenerationModal } from '../components/study/FlashcardGenerationModal.tsx';
import { ImageOcclusionEditor } from '../components/study/ImageOcclusionEditor.tsx';
import { ImageOcclusionViewer } from '../components/study/ImageOcclusionViewer.tsx';
import { PracticeQuestion } from '../components/study/PracticeQuestion.tsx';
import {
  ReviewConfigPanel,
  ReviewCard,
  RatingBar,
  ReviewSummary
} from '../components/review/index.ts';
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
  /** Resource preselected when study starts from another view. */
  initialResourceId?: string | null;
  /** Preselected lesson: activates lesson-level study/retrieval scope. */
  initialLessonId?: string | null;
  /** Mode preselected from the origin view. */
  initialMode?: StudySessionMode;
}

type StudyItem =
  | { key: string; kind: 'flashcard'; card: Flashcard }
  | { key: string; kind: 'practice'; question: GeneratedQuestion };

/**
 * SM-2 grade tones: 0-2 are memory failure (error), 3 is hard (warning), 4
 * good (informative), and 5 perfect (success). Color never stands alone: each
 * button shows grade, label, and description.
 */
const GRADE_OPTIONS: Array<{ grade: number; labelKey: string; hintKey: string; tone: string }> = [
  { grade: 0, labelKey: 'review.grade.0.label', hintKey: 'review.grade.0.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 1, labelKey: 'review.grade.1.label', hintKey: 'review.grade.1.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 2, labelKey: 'review.grade.2.label', hintKey: 'review.grade.2.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 3, labelKey: 'review.grade.3.label', hintKey: 'review.grade.3.hint', tone: 'border-warning/30 bg-warning-soft text-warning hover:bg-warning-soft/70' },
  { grade: 4, labelKey: 'review.grade.4.label', hintKey: 'review.grade.4.hint', tone: 'border-info/30 bg-info-soft text-info hover:bg-info-soft/70' },
  { grade: 5, labelKey: 'review.grade.5.label', hintKey: 'review.grade.5.hint', tone: 'border-success/30 bg-success-soft text-success hover:bg-success-soft/70' }
];

const MODE_KEYS: Record<StudySessionMode, string> = {
  flashcards: 'review.mode.flashcards',
  practice: 'review.mode.practice',
  mixed: 'review.mode.mixed'
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
  const { t } = useLanguage();
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
          // A local generation failure must not invalidate the session.
          setPrepareError(err?.message || t('review.err.generate'));
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
      setPrepareError(err?.message || t('review.err.prepare'));
    } finally {
      setIsPreparing(false);
    }
  }, [count, difficulty, topic, t]);

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
      dispatch({ type: 'START_FAILED', error: err?.message || t('review.err.start') });
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
      /* Silent: an abandoned session with no activity creates no history. */
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
        dispatch({ type: 'FINALIZE_FAILED', error: err?.message || t('review.err.summary') });
      }
    } else {
      setItemIndex(next);
    }
  }, [itemIndex, items.length, state.sessionId, onRefresh, t]);

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
      // One compound write: the card's SM-2 schedule and the session counter
      // share a single snapshot export instead of exporting the database twice.
      const { result, sessionUpdated } = await dao.reviewFlashcardInSession(
        currentCard.id,
        grade,
        state.sessionId
      );
      if (!sessionUpdated) {
        setActionError(t('review.err.counter'));
      }
      const option = GRADE_OPTIONS.find(o => o.grade === grade);
      setGradeFeedback({
        label: option ? t(option.labelKey) : t('review.gradeFallback', { grade }),
        nextReview: result ? formatNextReviewInterval(result.intervalDays) : 'actualizado'
      });
    } catch (err: any) {
      setActionError(err?.message || 'No se pudo guardar el repaso SM-2 en el almacenamiento local.');
    }
  }, [currentCard, state.sessionId, t]);

  const handleSubmitAnswer = useCallback(async () => {
    if (selectedOption === null || !currentQuestion) return;
    setIsAnswerSubmitted(true);
    const correct = selectedOption === currentQuestion.correctIndex;
    if (state.sessionId) {
      try {
        await dao.recordStudyQuestionAnswer(state.sessionId, correct);
      } catch {
        setActionError(t('review.err.record'));
      }
    }
  }, [selectedOption, currentQuestion, state.sessionId, t]);

  useEffect(() => {
    if (state.phase !== 'active' || isPreparing || isFlashcardModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Modified combos do NOT belong to this shortcut: they belong to the app
      // or the OS (e.g. Ctrl+K / Cmd+K open the global command palette). Without
      // this guard, Cmd+K would grade the current card while opening the palette.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // Ignore when focus sits in an interactive text field
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
          return;
        }
      }

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

      if (currentQuestion) {
        if (!isAnswerSubmitted) {
          const optIdx = resolveShortcutOptionIndex(e.key, currentQuestion.options.length);
          if (optIdx !== null) {
            e.preventDefault();
            setSelectedOption(optIdx);
            return;
          }
          // Enter to check the answer when an option is chosen
          if (e.key === 'Enter' && selectedOption !== null) {
            e.preventDefault();
            handleSubmitAnswer();
            return;
          }
        } else {
          // Already checked: Enter or Space to advance
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
      setActionError(err?.message || t('review.err.cancel'));
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
      setActionError(err?.message || t('review.err.finalize'));
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
      <header className="border-b border-line pb-5 text-center">
        <h1 className="type-display text-ink">Centro de repaso</h1>
        <p className="type-secondary mx-auto mt-2 max-w-xl">
          Repasa tarjetas con intervalos SM-2, practica con preguntas fundamentadas y conserva un
          historial local de tu progreso.
        </p>
      </header>

      {state.phase === 'idle' && pendingResume && (
        <InlineStatus tone="warning" className="justify-between">
          <span className="flex min-w-0 items-start gap-3">
            <CalendarClock size={17} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Tienes una sesión de estudio sin finalizar</strong>
              <span className="mt-0.5 block">
                {t(MODE_KEYS[pendingResume.mode])} · {pendingResume.cards_reviewed} tarjetas · {pendingResume.questions_answered} preguntas registradas
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

      {(state.phase === 'idle' || state.phase === 'failed') && !isPreparing && (
        <ReviewConfigPanel
          mode={mode}
          onModeChange={setMode}
          dueCount={dueCount}
          originFilter={originFilter}
          onOriginFilterChange={setOriginFilter}
          flashcards={flashcards}
          resources={resources}
          selectedResourceId={selectedResourceId}
          onSelectedResourceChange={setSelectedResourceId}
          selectedLessonId={selectedLessonId}
          onClearSelectedLesson={() => setSelectedLessonId('')}
          lessonOptions={lessonOptions}
          topic={topic}
          onTopicChange={setTopic}
          count={count}
          onCountChange={setCount}
          difficulty={difficulty}
          onDifficultyChange={setDifficulty}
          onStart={handleStart}
          onOpenFlashcardModal={() => setIsFlashcardModalOpen(true)}
          onOpenOcclusionModal={() => setIsOcclusionModalOpen(true)}
          error={state.phase === 'failed' ? state.error : null}
        />
      )}

      {(isPreparing || state.phase === 'starting') && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-8 text-center shadow-card">
          <Loader2 size={26} className="mx-auto animate-spin text-accent" aria-hidden="true" />
          <p className="text-body text-ink">Preparando tu sesión de estudio local…</p>
          <p className="type-meta">Recuperando tarjetas pendientes y contexto local de SQLite</p>
        </div>
      )}

      {isActive && !isPreparing && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-2 text-meta text-muted">
              <Clock size={14} className="text-accent" aria-hidden="true" />
              <span className="font-semibold text-ink">{t(MODE_KEYS[state.mode])}</span>
              {selectedResource && <span className="truncate">· {selectedResource.title}</span>}
              {selectedLessonId && (
                <span className="truncate">
                  {t('review.lessonScopeBar', {
                    title:
                      lessonOptions.find(l => l.id === selectedLessonId)?.title ||
                      t('review.lessonScopeFallback')
                  })}
                </span>
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
                <span>
                  {currentCard
                    ? t('review.easeFactor', { value: currentCard.ease_factor })
                    : t('review.ephemeral')}
                </span>
              </div>
              <ProgressBar
                value={itemIndex + 1}
                max={items.length}
                label={t('review.sessionProgress')}
              />

              {currentCard && (
                <div className="space-y-4">
                  <ReviewCard
                    card={currentCard}
                    showAnswer={showAnswer}
                    onToggleAnswer={() => setShowAnswer(v => !v)}
                    isPlayingAudio={isPlayingAudio}
                    onToggleAudio={handleToggleAudio}
                    activeMaskIndex={activeMaskIndex}
                    onSelectMask={setActiveMaskIndex}
                  />

                  <RatingBar
                    gradeFeedback={gradeFeedback}
                    onGrade={handleGrade}
                    onAdvance={advance}
                    isLastItem={itemIndex + 1 >= items.length}
                  />
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

              <div
                className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-line bg-surface/70 px-4 py-2.5 text-meta text-muted shadow-sm backdrop-blur"
                aria-label={t('review.shortcutsGuide')}
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
                {prepareError || t('review.emptyItems')}
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

      {(state.phase === 'completed' || state.phase === 'cancelled') && (
        <ReviewSummary
          phase={state.phase}
          sessionSummary={sessionSummary}
          onReset={resetToIdle}
        />
      )}

      <FlashcardGenerationModal
        isOpen={isFlashcardModalOpen}
        onClose={() => setIsFlashcardModalOpen(false)}
        resourceId={selectedResourceId || undefined}
        lessonId={selectedLessonId || undefined}
        onCardsSaved={() => {
          onRefresh();
        }}
      />

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
