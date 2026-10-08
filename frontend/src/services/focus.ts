/**
 * Panel "Hoy / Enfoque": recomendaciones DETERMINISTAS sobre datos reales.
 *
 * Este módulo es PURO: no toca SQLite ni React. Recibe los datos ya cargados y
 * devuelve una lista priorizada y explicable de acciones. Reglas:
 *
 *  - Cada recomendación nace de un hecho verificable (tarjetas vencidas,
 *    trabajo en marcha, lección pendiente, meta con fecha…). Nunca se inventa
 *    una sugerencia sin dato que la respalde.
 *  - La prioridad es una constante explícita por tipo de regla y el desempate
 *    es determinista (id ascendente): la misma entrada produce siempre el
 *    mismo plan.
 *  - `reason` explica en español POR QUÉ aparece cada item: la UI lo muestra,
 *    de modo que el usuario puede auditar la recomendación.
 *  - Sin datos accionables la lista queda vacía y la UI muestra un estado
 *    vacío honesto (no se rellena con consejos genéricos).
 */
import type {
  Book,
  Course,
  LearningGoal,
  LearningSession,
  PracticeWork,
  ResourceDestination,
  TodayStudySummary
} from '../types/models.ts';
import { resolveArtifactContextDestination } from './domainLogic.ts';
import { sessionLocalDay } from './analytics.ts';
import {
  classifyGoalDeadline,
  GOAL_DEADLINE_LABELS,
  normalizeGoalDate,
  type GoalProgress
} from './goals.ts';

export type FocusItemKind =
  | 'reviews'
  | 'practice'
  | 'continue_lesson'
  | 'start_course'
  | 'goal_overdue'
  | 'goal_due_soon'
  | 'goal_ready'
  | 'book';

/**
 * Prioridades fijas por tipo de regla. Son constantes de diseño, no métricas:
 * ordenan acciones, nunca miden a la persona.
 */
export const FOCUS_PRIORITY = {
  reviews: 100,
  practice: 90,
  continue_lesson: 80,
  goal_overdue: 75,
  goal_due_soon: 70,
  goal_ready: 55,
  book: 50,
  start_course: 40
} as const;

/** Máximo de items por categoría para no inundar la vista. */
const MAX_PRACTICE_ITEMS = 3;
const MAX_GOAL_ITEMS = 3;

export interface FocusContinueTarget {
  courseId: string;
  lessonId: string | null;
  courseTitle: string;
  lessonTitle: string | null;
  moduleTitle?: string | null;
}

export interface FocusInput {
  today: TodayStudySummary;
  /** Día calendario local de referencia (YYYY-MM-DD) para clasificar fechas. */
  localDay: string;
  /** Minutos de estudio registrados hoy (opcional; desde la serie diaria). */
  minutesToday?: number;
  streakDays: number;
  pendingReviews: number;
  continueTarget: FocusContinueTarget | null;
  courses: readonly Course[];
  books: readonly Book[];
  practiceWork: readonly PracticeWork[];
  goals: readonly LearningGoal[];
  /** Progreso ya derivado para cada meta (services/goals.ts). */
  goalProgress: ReadonlyMap<string, GoalProgress>;
  recentSessions: readonly LearningSession[];
}

export interface FocusItem {
  id: string;
  kind: FocusItemKind;
  title: string;
  /** Explicación honesta de por qué aparece (la muestra la interfaz). */
  reason: string;
  actionLabel: string;
  /** Orden descendente: mayor prioridad primero; empate por id. */
  priority: number;
  /** Cifra destacada cuando aporta (p. ej. "12 pendientes"). */
  badge?: string;
  /** Destino de entidad (curso, libro, meta…) si aplica. */
  destination?: ResourceDestination;
  /** Pestaña de primer nivel si aplica (repaso). Exactamente una de las dos. */
  tab?: string;
}

/** Resumen honesto de "dónde estoy hoy" (sin puntuaciones inventadas). */
export interface FocusSummary {
  streakDays: number;
  pendingReviews: number;
  minutesToday: number;
  reviewsToday: number;
  correctToday: number;
  /** Meta activa más próxima a su fecha objetivo (o la primera activa). */
  nextGoal: LearningGoal | null;
  nextGoalProgress: GoalProgress | null;
  nextGoalDeadline: ReturnType<typeof classifyGoalDeadline> | null;
}

/** Recurso estudiado recientemente, derivado de las sesiones reales. */
export interface RecentResourceEntry {
  resourceId?: string;
  lessonId?: string;
  label: string;
  /** Último día local de estudio de este recurso (YYYY-MM-DD). */
  lastDay: string | null;
  minutes: number;
}

export const FOCUS_EMPTY_MESSAGE =
  'No hay nada pendiente que requiera tu atención ahora mismo: sin tarjetas vencidas, sin trabajos en marcha y sin lecciones a medio terminar.';

function sortPlan(items: FocusItem[]): FocusItem[] {
  return items.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

/**
 * Construye el plan de "Hoy". Determinista y explicable: mismos datos → mismo
 * plan, en el mismo orden.
 */
export function buildFocusPlan(input: FocusInput): FocusItem[] {
  const items: FocusItem[] = [];

  // 1. Repaso espaciado vencido (la acción con retorno de estudio más claro).
  if (input.pendingReviews > 0) {
    items.push({
      id: 'focus:reviews',
      kind: 'reviews',
      title: `Repasar ${input.pendingReviews} tarjeta${input.pendingReviews === 1 ? '' : 's'}`,
      reason: `${input.pendingReviews} tarjeta${input.pendingReviews === 1 ? '' : 's'} con fecha de repaso vencida según SM-2.`,
      actionLabel: 'Ir al repaso',
      priority: FOCUS_PRIORITY.reviews,
      badge: `${input.pendingReviews}`,
      tab: 'review'
    });
  }

  // 2. Trabajo práctico en marcha (producir evidencia es la siguiente acción
  //    más valiosa cuando ya hay algo empezado).
  const inProgress = input.practiceWork
    .filter((item) => item.status === 'IN_PROGRESS')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '') || a.id.localeCompare(b.id));

  inProgress.slice(0, MAX_PRACTICE_ITEMS).forEach((item, index) => {
    items.push({
      id: `focus:practice:${item.id}`,
      kind: 'practice',
      title: `Continuar «${item.title}»`,
      reason: item.resource_id || item.lesson_id || item.concept_id
        ? 'Trabajo práctico en marcha ligado a tu material de estudio.'
        : 'Trabajo práctico en marcha.',
      actionLabel: 'Abrir trabajo',
      priority: FOCUS_PRIORITY.practice - index,
      destination: resolveArtifactContextDestination({
        resourceId: item.resource_id,
        lessonId: item.lesson_id,
        conceptId: item.concept_id
      })
    });
  });

  // 3. Continuar la última lección pendiente.
  if (input.continueTarget) {
    const target = input.continueTarget;
    items.push({
      id: 'focus:continue',
      kind: 'continue_lesson',
      title: `Continuar «${target.courseTitle}»`,
      reason: target.lessonTitle
        ? `Próxima lección pendiente: ${target.lessonTitle}${target.moduleTitle ? ` (${target.moduleTitle})` : ''}.`
        : 'Curso con lecciones sin completar.',
      actionLabel: target.lessonId ? 'Continuar lección' : 'Ver curso',
      priority: FOCUS_PRIORITY.continue_lesson,
      destination: target.lessonId
        ? { tab: 'course', resourceId: target.courseId, lessonId: target.lessonId }
        : { tab: 'course', resourceId: target.courseId }
    });
  }

  // 4. Metas con fecha vencida o próxima a vencer (máximo 3, ordenadas por
  //    fecha ascendente). El estado de fecha es información, no un castigo.
  const activeGoals = input.goals.filter((goal) => goal.status === 'active');
  const byDeadline = (a: LearningGoal, b: LearningGoal) => {
    const dayA = normalizeGoalDate(a.target_date) ?? '9999-12-31';
    const dayB = normalizeGoalDate(b.target_date) ?? '9999-12-31';
    return dayA.localeCompare(dayB) || a.id.localeCompare(b.id);
  };

  const overdue = activeGoals
    .filter((goal) => classifyGoalDeadline(goal, input.localDay) === 'overdue')
    .sort(byDeadline);

  overdue.slice(0, MAX_GOAL_ITEMS).forEach((goal, index) => {
    const progress = input.goalProgress.get(goal.id);
    const due = normalizeGoalDate(goal.target_date);
    items.push({
      id: `focus:goal-overdue:${goal.id}`,
      kind: 'goal_overdue',
      title: goal.title,
      reason: `Meta vencida${due ? ` el ${due}` : ''}. ${progress?.basis ?? ''}`.trim(),
      actionLabel: 'Ver meta',
      priority: FOCUS_PRIORITY.goal_overdue - index,
      badge: 'Vencida',
      destination: { tab: 'goals', goalId: goal.id }
    });
  });

  const dueSoon = activeGoals
    .filter((goal) => classifyGoalDeadline(goal, input.localDay) === 'due_soon')
    .sort(byDeadline);

  dueSoon.slice(0, MAX_GOAL_ITEMS).forEach((goal, index) => {
    const progress = input.goalProgress.get(goal.id);
    const due = normalizeGoalDate(goal.target_date);
    items.push({
      id: `focus:goal-duesoon:${goal.id}`,
      kind: 'goal_due_soon',
      title: goal.title,
      reason: `Meta con fecha objetivo el ${due ?? '-'}. ${progress?.basis ?? ''}`.trim(),
      actionLabel: 'Ver meta',
      priority: FOCUS_PRIORITY.goal_due_soon - index,
      badge: GOAL_DEADLINE_LABELS.due_soon,
      destination: { tab: 'goals', goalId: goal.id }
    });
  });

  // Metas cuya medida ya alcanza el objetivo: toca decidir si se cierran.
  const ready = activeGoals
    .filter((goal) => (input.goalProgress.get(goal.id)?.reachedTarget ?? false) && !overdue.includes(goal) && !dueSoon.includes(goal))
    .sort((a, b) => a.id.localeCompare(b.id));

  ready.slice(0, 2).forEach((goal, index) => {
    items.push({
      id: `focus:goal-ready:${goal.id}`,
      kind: 'goal_ready',
      title: goal.title,
      reason: 'El progreso medido ya alcanza el objetivo: puedes marcarla como completada.',
      actionLabel: 'Revisar meta',
      priority: FOCUS_PRIORITY.goal_ready - index,
      destination: { tab: 'goals', goalId: goal.id }
    });
  });

  // 5. Libro en curso con páginas pendientes.
  const readingBook = input.books
    .filter((book) => book.status !== 'COMPLETED')
    .filter((book) => !book.page_count || (book.current_page ?? 0) < book.page_count)
    .sort((a, b) => a.id.localeCompare(b.id))[0];

  if (readingBook && !input.continueTarget) {
    const pages = readingBook.page_count;
    const current = readingBook.current_page ?? 0;
    items.push({
      id: `focus:book:${readingBook.id}`,
      kind: 'book',
      title: `Continuar leyendo «${readingBook.title}»`,
      reason: pages
        ? `Vas por la página ${current} de ${pages}.`
        : 'Libro empezado sin número de páginas registrado.',
      actionLabel: 'Abrir libro',
      priority: FOCUS_PRIORITY.book,
      destination: { tab: 'resource', resourceId: readingBook.id }
    });
  }

  // 6. Curso sin empezar con lecciones registradas (solo si no hay nada mejor).
  if (!input.continueTarget) {
    const untouched = input.courses
      .filter((course) => course.status !== 'COMPLETED')
      .filter((course) => (course.total_lessons ?? 0) > 0)
      .sort((a, b) => a.id.localeCompare(b.id))[0];

    if (untouched) {
      items.push({
        id: `focus:start:${untouched.id}`,
        kind: 'start_course',
        title: `Empezar «${untouched.title}»`,
        reason: 'Curso pendiente con lecciones registradas.',
        actionLabel: 'Ver curso',
        priority: FOCUS_PRIORITY.start_course,
        destination: { tab: 'course', resourceId: untouched.id }
      });
    }
  }

  return sortPlan(items);
}

/** Resumen de hoy + meta próxima. Sin métricas inventadas. */
export function buildFocusSummary(input: FocusInput): FocusSummary {
  const activeGoals = input.goals
    .filter((goal) => goal.status === 'active')
    .slice()
    .sort((a, b) => {
      const dayA = normalizeGoalDate(a.target_date) ?? '9999-12-31';
      const dayB = normalizeGoalDate(b.target_date) ?? '9999-12-31';
      return dayA.localeCompare(dayB) || a.id.localeCompare(b.id);
    });

  const nextGoal = activeGoals[0] ?? null;

  return {
    streakDays: input.streakDays,
    pendingReviews: input.pendingReviews,
    minutesToday: input.minutesToday ?? 0,
    reviewsToday: input.today.items_reviewed,
    correctToday: input.today.correct_answers,
    nextGoal,
    nextGoalProgress: nextGoal ? input.goalProgress.get(nextGoal.id) ?? null : null,
    nextGoalDeadline: nextGoal ? classifyGoalDeadline(nextGoal, input.localDay) : null
  };
}

/**
 * Recursos estudiados recientemente, deduplicados por recurso (o lección si no
 * hay recurso) y ordenados de más reciente a más antiguo.
 */
export function deriveRecentResources(
  sessions: readonly LearningSession[],
  limit: number
): RecentResourceEntry[] {
  const map = new Map<string, RecentResourceEntry & { lastStartedAt: string }>();

  const ordered = [...sessions].sort((a, b) =>
    (b.started_at || '').localeCompare(a.started_at || '')
  );

  for (const session of ordered) {
    if (session.status !== 'completed') continue;
    const key = session.resource_id || session.lesson_id;
    if (!key) continue;
    const label = session.resource_title || session.lesson_title || 'Estudio general';
    const existing = map.get(key);
    if (existing) {
      existing.minutes += session.duration_minutes || 0;
      continue;
    }
    map.set(key, {
      resourceId: session.resource_id || undefined,
      lessonId: session.lesson_id || undefined,
      label,
      lastDay: sessionLocalDay(session.started_at || ''),
      minutes: session.duration_minutes || 0,
      lastStartedAt: session.started_at || ''
    });
  }

  return [...map.values()]
    .sort((a, b) => b.lastStartedAt.localeCompare(a.lastStartedAt))
    .slice(0, Math.max(0, limit))
    .map(({ lastStartedAt: _ignored, ...entry }) => entry);
}
