import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  Compass,
  Flame,
  History,
  ListTodo,
  Sparkles
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { resolveLocalDay } from '../services/localDate.ts';
import {
  FOCUS_EMPTY_MESSAGE,
  buildFocusPlan,
  buildFocusSummary,
  deriveRecentResources,
  type FocusItem
} from '../services/focus.ts';
import { GOAL_DEADLINE_LABELS } from '../services/goals.ts';
import { useGoalProgress } from '../hooks/useGoalProgress.ts';
import type {
  Book,
  Course,
  KPIMetrics,
  LearningGoal,
  LearningSession,
  PracticeWork,
  ResourceDestination
} from '../types/models.ts';
import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';

interface FocusTodayProps {
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  practiceWork: PracticeWork[];
  goals: LearningGoal[];
  recentSessions: LearningSession[];
  /** Navega a una pestaña de primer nivel (repaso, biblioteca, metas…). */
  onNavigate: (tab: string) => void;
  /** Abre un destino de entidad reutilizando la navegación existente. */
  onOpenDestination: (destination: ResourceDestination) => void;
}

const KIND_ICONS: Partial<Record<FocusItem['kind'], React.ComponentType<any>>> = {
  reviews: Sparkles,
  practice: ListTodo,
  continue_lesson: Compass,
  start_course: Compass,
  goal_overdue: CalendarCheck,
  goal_due_soon: CalendarCheck,
  goal_ready: CircleCheck,
  book: History
};

function formatLocalDate(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(parsed);
}

/**
 * Vista "Hoy": responde a «¿qué hago ahora?» con datos reales.
 *
 * Las recomendaciones salen de `buildFocusPlan` (puro y determinista). Esta
 * vista solo carga los datos necesarios, los ordena y ofrece la acción; nunca
 * inventa sugerencias ni métricas.
 */
export const FocusToday: React.FC<FocusTodayProps> = ({
  kpis,
  courses,
  books,
  practiceWork,
  goals,
  recentSessions,
  onNavigate,
  onOpenDestination
}) => {
  const { day: localDay } = resolveLocalDay();
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork);

  interface ContinueTarget {
    courseId: string;
    lessonId: string | null;
    courseTitle: string;
    lessonTitle: string | null;
    moduleTitle: string | null;
  }
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);
  const [minutesToday, setMinutesToday] = useState(0);

  // Continuación: primer curso incompleto con su próxima lección real.
  useEffect(() => {
    let cancelled = false;
    const target =
      courses.find(course => course.status === 'IN_PROGRESS' && (course.completed_lessons ?? 0) < (course.total_lessons ?? 0)) ||
      courses.find(course => course.status !== 'COMPLETED' && (course.total_lessons ?? 0) > 0);
    if (!target) {
      setContinueTarget(null);
      return;
    }
    dao
      .getNextLessonForCourse(target.id)
      .then(result => {
        if (cancelled) return;
        setContinueTarget({
          courseId: target.id,
          lessonId: result?.lesson?.id ?? null,
          courseTitle: target.title,
          lessonTitle: result?.lesson?.title ?? null,
          moduleTitle: result?.moduleTitle ?? null
        });
      })
      .catch(() => {
        if (!cancelled) {
          setContinueTarget({ courseId: target.id, lessonId: null, courseTitle: target.title, lessonTitle: null, moduleTitle: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courses]);

  // Minutos de HOY desde la serie diaria ya agregada (sin nueva consulta).
  useEffect(() => {
    let cancelled = false;
    dao
      .getDailyActivitySeries('7d')
      .then(points => {
        if (cancelled) return;
        const todayPoint = points.find(point => point.date === localDay);
        setMinutesToday(todayPoint?.minutes ?? 0);
      })
      .catch(() => {
        if (!cancelled) setMinutesToday(0);
      });
    return () => {
      cancelled = true;
    };
  }, [localDay, kpis]);

  const plan = useMemo(
    () =>
      buildFocusPlan({
        today: kpis?.today ?? { items_reviewed: 0, flashcards_reviewed: 0, questions_answered: 0, correct_answers: 0 },
        localDay,
        minutesToday,
        streakDays: kpis?.active_streak_days ?? 0,
        pendingReviews: kpis?.pending_reviews ?? 0,
        continueTarget,
        courses,
        books,
        practiceWork,
        goals,
        goalProgress: progressByGoal,
        recentSessions
      }),
    [kpis, localDay, minutesToday, continueTarget, courses, books, practiceWork, goals, progressByGoal, recentSessions]
  );

  const summary = useMemo(
    () =>
      buildFocusSummary({
        today: kpis?.today ?? { items_reviewed: 0, flashcards_reviewed: 0, questions_answered: 0, correct_answers: 0 },
        localDay,
        minutesToday,
        streakDays: kpis?.active_streak_days ?? 0,
        pendingReviews: kpis?.pending_reviews ?? 0,
        continueTarget,
        courses,
        books,
        practiceWork,
        goals,
        goalProgress: progressByGoal,
        recentSessions
      }),
    [kpis, localDay, minutesToday, continueTarget, courses, books, practiceWork, goals, progressByGoal, recentSessions]
  );

  const recentResources = useMemo(() => deriveRecentResources(recentSessions, 5), [recentSessions]);

  const activateItem = (item: FocusItem) => {
    if (item.tab) {
      onNavigate(item.tab);
      return;
    }
    if (item.destination) onOpenDestination(item.destination);
  };

  const openRecent = (entry: (typeof recentResources)[number]) => {
    if (entry.resourceId) {
      onOpenDestination({ tab: 'resource', resourceId: entry.resourceId });
      return;
    }
    if (entry.lessonId) {
      onOpenDestination({ tab: 'course', resourceId: entry.lessonId, lessonId: entry.lessonId });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <h1 className="type-display text-ink">Hoy</h1>
        <p className="type-secondary mt-1 capitalize">{formatLocalDate(localDay)} · tu siguiente paso, basado en tus datos.</p>
      </header>

      {/* Resumen del día: solo hechos medidos. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel className="p-4">
          <p className="type-micro">Estudio de hoy</p>
          <p className="mt-1 text-xl font-semibold text-ink">{minutesToday} min</p>
          <p className="text-micro text-faint">{summary.reviewsToday} ítems repasados</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">Racha activa</p>
          <p className="mt-1 flex items-center gap-1.5 text-xl font-semibold text-ink">
            <Flame size={16} className="text-warning" aria-hidden="true" />
            {summary.streakDays} días
          </p>
          <p className="text-micro text-faint">días consecutivos con estudio</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">Pendiente de repaso</p>
          <p className="mt-1 text-xl font-semibold text-ink">{summary.pendingReviews}</p>
          <p className="text-micro text-faint">tarjetas vencidas (SM-2)</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">Meta más próxima</p>
          {summary.nextGoal ? (
            <>
              <p className="mt-1 truncate text-item font-semibold text-ink" title={summary.nextGoal.title}>
                {summary.nextGoal.title}
              </p>
              <p className="text-micro text-faint">
                {summary.nextGoalDeadline ? GOAL_DEADLINE_LABELS[summary.nextGoalDeadline] : ''}
                {summary.nextGoalProgress?.measurable ? ` · ${summary.nextGoalProgress.percent}%` : ''}
              </p>
            </>
          ) : (
            <p className="mt-1 text-item text-muted">Sin metas activas</p>
          )}
        </Panel>
      </div>

      {/* Plan de acción: orden priorizado y explicable. */}
      <Panel className="p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
          <ListTodo size={16} className="text-accent" aria-hidden="true" />
          <div>
            <h2 className="type-section text-ink">Qué hacer ahora</h2>
            <p className="type-meta mt-0.5">Recomendaciones derivadas de tus datos: cada una explica por qué aparece.</p>
          </div>
        </div>

        {plan.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={30} aria-hidden="true" />}
            title="No hay nada pendiente ahora mismo"
            hint={FOCUS_EMPTY_MESSAGE}
            action={
              <Button variant="outline" onClick={() => onNavigate('library')}>
                Explorar la Biblioteca <ArrowRight size={14} aria-hidden="true" />
              </Button>
            }
          />
        ) : (
          <ol className="space-y-3">
            {plan.map((item, index) => {
              const Icon = KIND_ICONS[item.kind] ?? Sparkles;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-micro font-semibold text-faint" aria-hidden="true">
                          {index + 1}.
                        </span>
                        <p className="break-words text-item font-semibold text-ink">{item.title}</p>
                        {item.badge && <Badge tone="accent">{item.badge}</Badge>}
                      </div>
                      <p className="type-meta mt-0.5 break-words text-muted">{item.reason}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={index === 0 ? 'solid' : 'outline'}
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => activateItem(item)}
                  >
                    {item.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {/* Recursos estudiados recientemente: atajos a lo que ya estabas haciendo. */}
      <Panel className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
          <History size={16} className="text-accent" aria-hidden="true" />
          <div>
            <h2 className="type-section text-ink">Estudiado recientemente</h2>
            <p className="type-meta mt-0.5">Tus últimas sesiones, ordenadas por actividad real.</p>
          </div>
        </div>
        {recentResources.length === 0 ? (
          <p className={cn('type-meta text-muted')}>
            Todavía no hay sesiones de estudio registradas. Empieza un repaso o una lección y aparecerá aquí.
          </p>
        ) : (
          <ul className="space-y-2">
            {recentResources.map(entry => (
              <li key={`${entry.resourceId ?? entry.lessonId}`}>
                <button
                  type="button"
                  onClick={() => openRecent(entry)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-item font-medium text-ink">{entry.label}</span>
                    <span className="text-micro text-faint">
                      {entry.lastDay ? `Última sesión: ${entry.lastDay}` : 'Sin fecha legible'} · {entry.minutes} min acumulados
                    </span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Acceso rápido a las otras piezas de planificación. */}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onNavigate('goals')}>
          Ver metas <ArrowRight size={14} aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('analytics')}>
          Ver análisis <ArrowRight size={14} aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('review')}>
          Ir al repaso SM-2 <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
