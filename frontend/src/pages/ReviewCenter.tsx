import React, { useState, useEffect, useReducer, useMemo, useCallback } from 'react';
import { Flashcard, LearningResource, LearningSession, StudySessionMode } from '../types/models.ts';
import {
  Brain,
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
  CalendarClock
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import confetti from 'canvas-confetti';
import { FlashcardGenerationModal } from '../components/study/FlashcardGenerationModal.tsx';
import { PracticeQuestion } from '../components/study/PracticeQuestion.tsx';
import { aiService } from '../ai/aiService.ts';
import type { GeneratedQuestion, StudyDifficulty } from '../lib/studyGeneration/types.ts';
import { initialStudySessionState, studySessionReducer } from '../services/studySession.ts';
import {
  buildMixedStudyPlan,
  formatNextReviewInterval,
  summarizeStudySession
} from '../services/domainLogic.ts';

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

const GRADE_OPTIONS: Array<{ grade: number; label: string; hint: string; tone: string }> = [
  { grade: 0, label: '0 · Apagón', hint: 'Sin recuerdo alguno', tone: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30' },
  { grade: 1, label: '1 · Olvidado', hint: 'Error tras esfuerzo', tone: 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30' },
  { grade: 2, label: '2 · Dudoso', hint: 'Incorrecta, familiar', tone: 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border-orange-500/30' },
  { grade: 3, label: '3 · Difícil', hint: 'Correcta con esfuerzo', tone: 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30' },
  { grade: 4, label: '4 · Bien', hint: 'Correcta con duda', tone: 'bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30' },
  { grade: 5, label: '5 · Perfecto', hint: 'Retención instantánea', tone: 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border-emerald-500/30' }
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

  const selectedResource = useMemo(
    () => resources.find(r => r.id === selectedResourceId) || null,
    [resources, selectedResourceId]
  );

  const dueCount = useMemo(
    () => flashcards.filter(f => isDue(f.due_date) && (!selectedResourceId || f.resource_id === selectedResourceId)).length,
    [flashcards, selectedResourceId]
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
        dueCards = await dao.getDueFlashcards(resourceId);
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
    setGradeFeedback(null);
    setShowAnswer(false);
    setSelectedOption(null);
    setIsAnswerSubmitted(false);
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

  const handleGrade = async (grade: number) => {
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
  };

  const handleSubmitAnswer = async () => {
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
  };

  const handleCancel = async () => {
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

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-semibold">
          <Brain size={14} /> Sesión de Estudio Local · SM-2
        </div>
        <h1 className="text-2xl font-extrabold text-white">Centro de Estudio Unificado</h1>
        <p className="text-xs text-slate-400">
          Repasa tarjetas con intervalos SM-2, practica con preguntas fundamentadas y conserva un historial local de tu progreso.
        </p>
      </div>

      {/* Banner de sesión activa pendiente (reanudación tras recarga) */}
      {state.phase === 'idle' && pendingResume && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <CalendarClock size={20} className="text-amber-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-amber-200">Tienes una sesión de estudio sin finalizar</p>
              <p className="text-xs text-amber-300/80">
                {MODE_LABELS[pendingResume.mode]} · {pendingResume.cards_reviewed} tarjetas · {pendingResume.questions_answered} preguntas registradas
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResume}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-amber-600 hover:bg-amber-500 text-white transition"
            >
              Reanudar
            </button>
            <button
              onClick={handleDiscardPending}
              className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-amber-200 hover:text-white bg-slate-900 hover:bg-slate-800 border border-amber-500/30 transition"
            >
              Descartar
            </button>
          </div>
        </div>
      )}

      {/* Panel de inicio */}
      {(state.phase === 'idle' || state.phase === 'failed') && !isPreparing && (
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-5">
          <div className="space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Modalidad</span>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                    className={`p-3 rounded-xl border text-left transition ${
                      active ? 'bg-purple-600/20 border-purple-500/50 text-white' : 'bg-slate-950/40 border-slate-800 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold">
                      <Icon size={15} /> {opt.label}
                    </span>
                    <span className="block text-[10px] text-slate-400 mt-1">{opt.desc}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="study-resource">Recurso (opcional)</label>
              <select
                id="study-resource"
                value={selectedResourceId}
                onChange={e => setSelectedResourceId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
              >
                <option value="">Todos los recursos</option>
                {resources.map(r => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </select>
              {selectedLessonId && (
                <p className="mt-1.5 text-[10px] text-purple-300 flex items-center gap-1">
                  Ámbito de lección activo: {lessonOptions.find(l => l.id === selectedLessonId)?.title || 'lección seleccionada'}
                  <button type="button" onClick={() => setSelectedLessonId('')} className="underline text-slate-400 hover:text-white">quitar</button>
                </p>
              )}
            </div>

            {(mode === 'practice' || mode === 'mixed') && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1" htmlFor="study-topic">Tema o consulta guía</label>
                <input
                  id="study-topic"
                  type="text"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="Ej. Repetición espaciada, Hooks..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
                />
              </div>
            )}
          </div>

          {(mode === 'practice' || mode === 'mixed') && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Número de preguntas ({count})</label>
                <input type="range" min="3" max="6" value={count} onChange={e => setCount(parseInt(e.target.value, 10))} className="w-full accent-purple-500 cursor-pointer" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Dificultad</label>
                <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                  {(['easy', 'medium', 'hard'] as StudyDifficulty[]).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      className={`py-1 rounded-lg text-[11px] font-medium capitalize transition ${difficulty === d ? 'bg-purple-600 text-white font-semibold' : 'text-slate-400 hover:text-white'}`}
                    >
                      {d === 'easy' ? 'Fácil' : d === 'medium' ? 'Media' : 'Difícil'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 pt-1">
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
            >
              <Play size={14} /> Iniciar sesión
            </button>
            <button
              onClick={() => setIsFlashcardModalOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-slate-950/60 hover:bg-slate-800 text-purple-300 border border-purple-500/40 transition"
            >
              <Sparkles size={14} /> Generar Flashcards
            </button>
          </div>

          {state.phase === 'failed' && state.error && (
            <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{state.error}</span>
            </div>
          )}
        </div>
      )}

      {/* Preparando / starting */}
      {(isPreparing || state.phase === 'starting') && (
        <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
          <Loader2 size={28} className="animate-spin text-purple-400 mx-auto" />
          <p className="text-sm text-slate-300">Preparando tu sesión de estudio local...</p>
          <p className="text-xs text-slate-500">Recuperando tarjetas pendientes y contexto local de SQLite</p>
        </div>
      )}

      {/* Sesión activa */}
      {isActive && !isPreparing && (
        <div className="space-y-5">
          {/* Barra superior de sesión */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800">
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <Clock size={14} className="text-purple-400" />
              <span className="font-semibold">{MODE_LABELS[state.mode]}</span>
              {selectedResource && <span className="text-slate-500">· {selectedResource.title}</span>}
              {selectedLessonId && (
                <span className="text-slate-500">· Lección: {lessonOptions.find(l => l.id === selectedLessonId)?.title || 'ámbito de lección'}</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => dispatch({ type: state.phase === 'paused' ? 'RESUME' : 'PAUSE' })}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-300 bg-slate-950/60 hover:bg-slate-800 border border-slate-800 transition"
              >
                {state.phase === 'paused' ? <><Play size={12} /> Reanudar</> : <><Pause size={12} /> Pausar</>}
              </button>
              <button
                onClick={handleCancel}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 transition"
              >
                <X size={12} /> Cancelar sesión
              </button>
            </div>
          </div>

          {state.phase === 'paused' ? (
            <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-3">
              <Pause size={28} className="text-amber-300 mx-auto" />
              <p className="text-sm text-slate-300">Sesión en pausa</p>
              <p className="text-xs text-slate-500">Tus repasos ya guardados permanecen intactos. Reanuda cuando quieras continuar.</p>
            </div>
          ) : currentItem ? (
            <>
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Ítem {itemIndex + 1} de {items.length}</span>
                <span>{currentCard ? `Factor de facilidad: ${currentCard.ease_factor}` : 'Práctica efímera'}</span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                <div
                  className="bg-purple-600 h-full rounded-full transition-all duration-300"
                  style={{ width: `${((itemIndex + 1) / items.length) * 100}%` }}
                />
              </div>

              {currentCard && (
                <div className="space-y-4">
                  <button
                    type="button"
                    onClick={() => setShowAnswer(v => !v)}
                    aria-expanded={showAnswer}
                    aria-label={showAnswer ? 'Ocultar respuesta de la tarjeta' : 'Revelar respuesta de la tarjeta'}
                    className="w-full min-h-[240px] p-8 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-purple-950/30 border border-purple-500/30 shadow-2xl flex flex-col justify-between text-left hover:border-purple-400/50 transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400"
                  >
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                        {showAnswer ? 'Reverso / Respuesta' : 'Anverso / Pregunta'}
                      </span>
                      <h2 className="text-lg md:text-xl font-bold text-white mt-4 leading-relaxed">{currentCard.front}</h2>
                    </div>
                    {showAnswer ? (
                      <div className="mt-6 pt-6 border-t border-purple-500/20">
                        <p className="text-sm md:text-base text-slate-200 leading-relaxed font-normal">{currentCard.back}</p>
                      </div>
                    ) : (
                      <div className="text-center pt-8">
                        <span className="text-xs text-purple-300/70 inline-flex items-center gap-1.5">
                          <Sparkles size={13} /> Pulsa o presiona Enter para revelar la respuesta
                        </span>
                      </div>
                    )}
                  </button>

                  {gradeFeedback ? (
                    <div className="p-5 rounded-2xl bg-slate-900/70 border border-emerald-500/30 space-y-3 text-center" aria-live="polite">
                      <p className="text-sm font-semibold text-white">Repaso registrado · {gradeFeedback.label}</p>
                      <p className="text-xs text-slate-300">Próximo repaso: <strong className="text-emerald-300">{gradeFeedback.nextReview}</strong></p>
                      <button
                        onClick={advance}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
                      >
                        {itemIndex + 1 < items.length ? 'Siguiente ítem' : 'Ver resumen'} <ArrowRight size={14} />
                      </button>
                    </div>
                  ) : showAnswer && (
                    <div className="space-y-2">
                      <p className="text-center text-xs text-slate-400 font-medium">¿Qué tan fácil recordaste este concepto?</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
                        {GRADE_OPTIONS.map(opt => (
                          <button
                            key={opt.grade}
                            onClick={() => handleGrade(opt.grade)}
                            aria-label={`Calificar como ${opt.label}. ${opt.hint}`}
                            className={`p-3 rounded-xl border text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${opt.tone}`}
                          >
                            {opt.label}
                            <span className="block text-[10px] font-normal opacity-80 mt-0.5">{opt.hint}</span>
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
            </>
          ) : (
            <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
              <AlertCircle size={28} className="text-amber-300 mx-auto" />
              <h2 className="text-base font-bold text-white">No hay ítems para esta sesión</h2>
              <p className="text-xs text-slate-400 max-w-md mx-auto">
                {prepareError || 'No encontramos tarjetas pendientes ni pudimos generar preguntas para la selección actual.'}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                <button onClick={() => prepareItems(state.mode, state.resourceId, selectedResource?.title)} className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition">
                  Reintentar preparación
                </button>
                <button onClick={handleFinishPartial} className="px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition">
                  Finalizar sesión
                </button>
              </div>
            </div>
          )}

          {actionError && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2" role="alert">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{actionError}</span>
            </div>
          )}
          {prepareError && currentItem && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2" role="status">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{prepareError} Puedes continuar con las tarjetas de la sesión.</span>
            </div>
          )}
        </div>
      )}

      {/* Resumen de sesión */}
      {(state.phase === 'completed' || state.phase === 'cancelled') && (
        <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto ${state.phase === 'completed' ? 'bg-purple-500/20 text-purple-300' : 'bg-slate-800 text-slate-300'}`}>
            {state.phase === 'completed' ? <CheckCircle2 size={32} /> : <X size={32} />}
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {state.phase === 'completed' ? 'Sesión completada' : 'Sesión cancelada'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {state.phase === 'completed'
                ? 'Tus repasos SM-2 y tu historial local se guardaron correctamente.'
                : 'Los repasos ya guardados se conservan; el ítem en curso no se registró.'}
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-left">
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-[11px] text-slate-400">Ítems repasados</p>
              <p className="text-lg font-bold text-white">{sessionSummary.itemsReviewed}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-[11px] text-slate-400">Tarjetas</p>
              <p className="text-lg font-bold text-white">{sessionSummary.flashcards}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-[11px] text-slate-400">Preguntas</p>
              <p className="text-lg font-bold text-white">{sessionSummary.questions}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-[11px] text-slate-400">Duración</p>
              <p className="text-lg font-bold text-white">{sessionSummary.durationMinutes} min</p>
            </div>
          </div>

          {sessionSummary.questions > 0 && (
            <p className="text-xs text-slate-300">
              Práctica: <strong className="text-emerald-300">{sessionSummary.correct}</strong> correctas ·{' '}
              <strong className="text-rose-300">{sessionSummary.incorrect}</strong> incorrectas
            </p>
          )}

          <button
            onClick={resetToIdle}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition"
          >
            <RotateCcw size={14} /> Nueva sesión
          </button>
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
    </div>
  );
};
