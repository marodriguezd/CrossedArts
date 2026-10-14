/**
 * "Today / Focus" panel: DETERMINISTIC recommendations over real data. Pure
 * module: no SQLite or React. It receives loaded data and returns a
 * prioritized, explainable action list. Rules: every recommendation stems from
 * a verifiable fact (due cards, ongoing work, pending lessons, dated goals) —
 * suggestions without backing data are never invented. Priority is an explicit
 * per-rule constant with deterministic tiebreaks (ascending id): same input
 * always yields the same plan. `reason` explains WHY each item appears (shown
 * by the UI) so users can audit it. Without actionable data the list stays
 * empty and the UI shows an honest empty state (no generic-advice filler).
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
  goalDeadlineLabel,
  normalizeGoalDate,
  type GoalProgress
} from './goals.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

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
 * Fixed priorities per rule type. Design constants, not metrics: they order
 * actions, never rate the person.
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

/** Max items per category to avoid flooding the view. */
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
  /** Reference local calendar day (YYYY-MM-DD) for date classification. */
  localDay: string;
  /** Study minutes logged today (optional; from the daily series). */
  minutesToday?: number;
  streakDays: number;
  pendingReviews: number;
  continueTarget: FocusContinueTarget | null;
  courses: readonly Course[];
  books: readonly Book[];
  practiceWork: readonly PracticeWork[];
  goals: readonly LearningGoal[];
  /** Already derived progress per goal (services/goals.ts). */
  goalProgress: ReadonlyMap<string, GoalProgress>;
  recentSessions: readonly LearningSession[];
}

export interface FocusItem {
  id: string;
  kind: FocusItemKind;
  title: string;
  /** Honest account of why it appears (shown by the UI). */
  reason: string;
  actionLabel: string;
  /** Descending order: highest priority first; id tiebreak. */
  priority: number;
  /** Highlight figure when useful (e.g. pending counts). */
  badge?: string;
  /** Entity target (course, book, goal) when applicable. */
  destination?: ResourceDestination;
  /** Top-level tab when applicable (review). Exactly one of the two. */
  tab?: string;
}

/** Honest "where I stand today" summary (no invented scores). */
export interface FocusSummary {
  streakDays: number;
  pendingReviews: number;
  minutesToday: number;
  reviewsToday: number;
  correctToday: number;
  /** Active goal nearest its target date (or the first active one). */
  nextGoal: LearningGoal | null;
  nextGoalProgress: GoalProgress | null;
  nextGoalDeadline: ReturnType<typeof classifyGoalDeadline> | null;
}

/** Recently studied resource, derived from real sessions. */
export interface RecentResourceEntry {
  resourceId?: string;
  lessonId?: string;
  label: string;
  /** Last local study day for this resource (YYYY-MM-DD). */
  lastDay: string | null;
  minutes: number;
}

export const FOCUS_EMPTY_MESSAGE =
  'No hay nada pendiente que requiera tu atención ahora mismo: sin tarjetas vencidas, sin trabajos en marcha y sin lecciones a medio terminar.';

function sortPlan(items: FocusItem[]): FocusItem[] {
  return items.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

/**
 * Builds the "Today" plan. Deterministic and explainable: same data yields
 * the same plan in the same order. `lang` localizes all visible content;
 * Spanish by default to preserve historic behavior (tests omit the language).
 */
export function buildFocusPlan(input: FocusInput, lang: LanguageCode = 'es'): FocusItem[] {
  const items: FocusItem[] = [];
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);

  // 1. Overdue spaced review (highest study-return action).
  if (input.pendingReviews > 0) {
    const plural = input.pendingReviews === 1 ? 'one' : 'other';
    items.push({
      id: 'focus:reviews',
      kind: 'reviews',
      title: tr(`focus.reviewTitle.${plural}`, { n: input.pendingReviews }),
      reason: tr(`focus.reviewReason.${plural}`, { n: input.pendingReviews }),
      actionLabel: tr('focus.goReview'),
      priority: FOCUS_PRIORITY.reviews,
      badge: `${input.pendingReviews}`,
      tab: 'review'
    });
  }

  // 2. Ongoing practice work (producing evidence is the next most valuable
  //    action once something started).
  const inProgress = input.practiceWork
    .filter((item) => item.status === 'IN_PROGRESS')
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '') || a.id.localeCompare(b.id));

  inProgress.slice(0, MAX_PRACTICE_ITEMS).forEach((item, index) => {
    items.push({
      id: `focus:practice:${item.id}`,
      kind: 'practice',
      title: tr('focus.continueWork', { title: item.title }),
      reason: item.resource_id || item.lesson_id || item.concept_id
        ? tr('focus.practiceLinked')
        : tr('focus.practicePlain'),
      actionLabel: tr('focus.openWork'),
      priority: FOCUS_PRIORITY.practice - index,
      destination: resolveArtifactContextDestination({
        resourceId: item.resource_id,
        lessonId: item.lesson_id,
        conceptId: item.concept_id
      })
    });
  });

  // 3. Resume the last pending lesson.
  if (input.continueTarget) {
    const target = input.continueTarget;
    items.push({
      id: 'focus:continue',
      kind: 'continue_lesson',
      title: tr('focus.continueCourse', { title: target.courseTitle }),
      reason: target.lessonTitle
        ? (target.moduleTitle
          ? tr('focus.nextLessonModule', { lesson: target.lessonTitle, module: target.moduleTitle })
          : tr('focus.nextLessonPlain', { lesson: target.lessonTitle }))
        : tr('focus.courseIncomplete'),
      actionLabel: target.lessonId ? tr('focus.continueLessonBtn') : tr('focus.viewCourse'),
      priority: FOCUS_PRIORITY.continue_lesson,
      destination: target.lessonId
        ? { tab: 'course', resourceId: target.courseId, lessonId: target.lessonId }
        : { tab: 'course', resourceId: target.courseId }
    });
  }

  // 4. Goals overdue or due soon (max 3, ascending date). Date state is
  //    information, not punishment.
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
      reason: tr('focus.goalOverdue', {
        date: due ? tr('focus.onDate', { due }) : '',
        basis: progress?.basis ?? ''
      }).trim(),
      actionLabel: tr('focus.viewGoal'),
      priority: FOCUS_PRIORITY.goal_overdue - index,
      badge: tr('focus.overdueBadge'),
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
      reason: tr('focus.goalDueSoon', { due: due ?? '-', basis: progress?.basis ?? '' }).trim(),
      actionLabel: tr('focus.viewGoal'),
      priority: FOCUS_PRIORITY.goal_due_soon - index,
      badge: goalDeadlineLabel('due_soon', lang),
      destination: { tab: 'goals', goalId: goal.id }
    });
  });

  // Goals already at target: time to decide on closing them.
  const ready = activeGoals
    .filter((goal) => (input.goalProgress.get(goal.id)?.reachedTarget ?? false) && !overdue.includes(goal) && !dueSoon.includes(goal))
    .sort((a, b) => a.id.localeCompare(b.id));

  ready.slice(0, 2).forEach((goal, index) => {
    items.push({
      id: `focus:goal-ready:${goal.id}`,
      kind: 'goal_ready',
      title: goal.title,
      reason: tr('focus.goalReady'),
      actionLabel: tr('focus.reviewGoal'),
      priority: FOCUS_PRIORITY.goal_ready - index,
      destination: { tab: 'goals', goalId: goal.id }
    });
  });

  // 5. In-progress book with pages left.
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
      title: tr('focus.keepReading', { title: readingBook.title }),
      reason: pages
        ? tr('focus.pageProgress', { cur: current, pages })
        : tr('focus.bookNoPages'),
      actionLabel: tr('focus.openBook'),
      priority: FOCUS_PRIORITY.book,
      destination: { tab: 'resource', resourceId: readingBook.id }
    });
  }

  // 6. Unstarted course with recorded lessons (only when nothing better exists).
  if (!input.continueTarget) {
    const untouched = input.courses
      .filter((course) => course.status !== 'COMPLETED')
      .filter((course) => (course.total_lessons ?? 0) > 0)
      .sort((a, b) => a.id.localeCompare(b.id))[0];

    if (untouched) {
      items.push({
        id: `focus:start:${untouched.id}`,
        kind: 'start_course',
        title: tr('focus.startCourse', { title: untouched.title }),
        reason: tr('focus.coursePending'),
        actionLabel: tr('focus.viewCourse'),
        priority: FOCUS_PRIORITY.start_course,
        destination: { tab: 'course', resourceId: untouched.id }
      });
    }
  }

  return sortPlan(items);
}

/** Today summary plus next goal. No invented metrics. */
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
 * Recently studied resources, deduped by resource (or lesson without one),
 * newest first.
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
