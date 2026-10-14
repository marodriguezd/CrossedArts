/**
 * Learning analytics: PURE aggregations over data CrossedArts already records
 * (`learning_session`, courses, books, practice work).
 *
 * Honesty rules for this module:
 *  - Only real facts are measured: minutes, active days, sessions, cards,
 *    questions, hits, course/book/practice progress.
 *  - NO psychological, motivation, intelligence, or productivity scores. What
 *    cannot be derived from data is never shown.
 *  - When a ratio has no denominator (zero questions, zero lessons), the
 *    result is `null` and the UI says so explicitly.
 *  - Study days are LOCAL calendar days (services/localDate.ts), injectable so
 *    tests stay deterministic in any timezone.
 */
import type { Book, Course, LearningSession, PracticeWork, TimeRangeFilter } from '../types/models.ts';
import { resolveLocalDay, shiftIsoDay, computeActiveStreak } from './localDate.ts';
import { generateDailyActivitySeries } from './domainLogic.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import { summarizePracticeWork, type PracticeWorkSummary } from './practiceWork.ts';
import type { DailyActivityPoint } from '../types/models.ts';

/** Time ranges available in the analytics view. */
export type AnalyticsRange = TimeRangeFilter;

export const ANALYTICS_RANGES: AnalyticsRange[] = ['7d', '30d', '90d', 'all'];

import { translateKey } from '../i18n/dictionaries.ts';
export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
  all: 'Todo'
};

/** Localized range label. Defaults to Spanish (existing callers omit it). */
export function analyticsRangeLabel(range: AnalyticsRange, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `analytics.range.${range}`);
}

/** Days covered by a fixed range (null for 'all'). */
export function rangeDayCount(range: AnalyticsRange): number | null {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  return null;
}

/**
 * LOCAL calendar day of a SQLite-stored timestamp. `datetime('now')` writes
 * UTC with no zone marker, so a zoneless string parses as UTC. Returns null
 * for unreadable stamps: those records are never assigned to any day.
 */
export function sessionLocalDay(startedAt: string, utcOffset?: string): string | null {
  if (!startedAt) return null;
  let timestamp = startedAt.trim();
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(timestamp)) {
    timestamp = timestamp.includes('T') ? `${timestamp}Z` : `${timestamp.replace(' ', 'T')}Z`;
  }
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) return null;
  return resolveLocalDay(parsed, utcOffset).day;
}

/** Raw aggregate totals for a session set. */
export interface SessionTotals {
  studyMinutes: number;
  sessionsCompleted: number;
  flashcardsReviewed: number;
  questionsAnswered: number;
  correctAnswers: number;
}

function emptyTotals(): SessionTotals {
  return {
    studyMinutes: 0,
    sessionsCompleted: 0,
    flashcardsReviewed: 0,
    questionsAnswered: 0,
    correctAnswers: 0
  };
}

function addToTotals(totals: SessionTotals, session: LearningSession): void {
  totals.studyMinutes += session.duration_minutes || 0;
  totals.sessionsCompleted += 1;
  totals.flashcardsReviewed += session.cards_reviewed || 0;
  totals.questionsAnswered += session.questions_answered || 0;
  totals.correctAnswers += session.correct_answers || 0;
}

/** First and last `YYYY-MM-DD` dates of a window, both inclusive. */
export interface RangeWindow {
  /** Inclusive lower bound (null for 'all'). */
  start: string | null;
  end: string | null;
}

/**
 * CURRENT range window plus the IMMEDIATELY PREVIOUS equal-length window (for
 * comparisons). 'all' has neither window nor comparison.
 */
export function resolveRangeWindows(range: AnalyticsRange, today: string): {
  current: RangeWindow;
  previous: RangeWindow | null;
} {
  const days = rangeDayCount(range);
  if (days === null) {
    return { current: { start: null, end: null }, previous: null };
  }
  const start = shiftIsoDay(today, -(days - 1));
  const prevEnd = shiftIsoDay(start, -1);
  const prevStart = shiftIsoDay(prevEnd, -(days - 1));
  return {
    current: { start, end: today },
    previous: { start: prevStart, end: prevEnd }
  };
}

/** Sessions inside a window (both ends inclusive). */
export function filterSessionsByWindow(
  sessions: readonly LearningSession[],
  window: RangeWindow | null,
  utcOffset?: string
): LearningSession[] {
  if (!window || (!window.start && !window.end)) return [...sessions];
  const out: LearningSession[] = [];
  for (const session of sessions) {
    const day = sessionLocalDay(session.started_at, utcOffset);
    if (!day) continue;
    if (window.start && day < window.start) continue;
    if (window.end && day > window.end) continue;
    out.push(session);
  }
  return out;
}

/** Accuracy over answered questions; null when nothing was answered. */
export function accuracyPercent(questionsAnswered: number, correctAnswers: number): number | null {
  if (!questionsAnswered || questionsAnswered <= 0) return null;
  const correct = Math.min(Math.max(correctAnswers, 0), questionsAnswered);
  return Math.round((correct / questionsAnswered) * 100);
}

export interface AnalyticsOverview {
  range: AnalyticsRange;
  /** Days covered by the range (null for 'all'). */
  daysInRange: number | null;
  studyMinutes: number;
  /** Local calendar days with recorded activity inside the range. */
  activeDays: number;
  sessionsCompleted: number;
  flashcardsReviewed: number;
  questionsAnswered: number;
  correctAnswers: number;
  /** Null when no questions were answered in range. */
  accuracyPercent: number | null;
  /** Current streak over ALL study days (not the range). */
  streakDays: number;
  /** Minutes per active day (0 without active days; always a fact, never a goal). */
  avgMinutesPerActiveDay: number;
}

/**
 * Deterministic overview for a range. `today` and `sessions` (with local days)
 * are injected for 100% reproducible tests. `today` must be the current local day.
 */
export function computeAnalyticsOverview(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  streakDays: number,
  utcOffset?: string
): AnalyticsOverview {
  const { current } = resolveRangeWindows(range, today);
  const inRange = filterSessionsByWindow(sessions, current, utcOffset);

  const totals = emptyTotals();
  const activeDays = new Set<string>();
  for (const session of inRange) {
    const day = sessionLocalDay(session.started_at, utcOffset);
    if (day) activeDays.add(day);
    addToTotals(totals, session);
  }

  return {
    range,
    daysInRange: rangeDayCount(range),
    studyMinutes: totals.studyMinutes,
    activeDays: activeDays.size,
    sessionsCompleted: totals.sessionsCompleted,
    flashcardsReviewed: totals.flashcardsReviewed,
    questionsAnswered: totals.questionsAnswered,
    correctAnswers: totals.correctAnswers,
    accuracyPercent: accuracyPercent(totals.questionsAnswered, totals.correctAnswers),
    streakDays,
    avgMinutesPerActiveDay:
      activeDays.size > 0 ? Math.round((totals.studyMinutes / activeDays.size) * 10) / 10 : 0
  };
}

export interface PeriodComparison {
  /** Current-range totals. */
  current: SessionTotals;
  /** Previous equal-length period totals; null for 'all'. */
  previous: SessionTotals | null;
  /** Minute delta across periods; null with no previous period. */
  deltaMinutes: number | null;
  /** Percent minute delta; null when the previous period was 0. */
  deltaPercent: number | null;
}

/**
 * Current range vs. the immediately previous equal-length period. With a
 * zero-minute previous period, `deltaPercent` is null (an invented "+100%"
 * would be noise, not information).
 */
export function computeRangeComparison(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string
): PeriodComparison {
  const { current, previous } = resolveRangeWindows(range, today);
  const currentTotals = emptyTotals();
  for (const session of filterSessionsByWindow(sessions, current, utcOffset)) {
    addToTotals(currentTotals, session);
  }

  if (!previous) {
    return { current: currentTotals, previous: null, deltaMinutes: null, deltaPercent: null };
  }

  const previousTotals = emptyTotals();
  for (const session of filterSessionsByWindow(sessions, previous, utcOffset)) {
    addToTotals(previousTotals, session);
  }

  const deltaMinutes = currentTotals.studyMinutes - previousTotals.studyMinutes;
  const deltaPercent =
    previousTotals.studyMinutes > 0
      ? Math.round((deltaMinutes / previousTotals.studyMinutes) * 100)
      : null;

  return { current: currentTotals, previous: previousTotals, deltaMinutes, deltaPercent };
}

export interface ResourceActivityRow {
  /** Null when the session has no linked resource (general study). */
  resourceId: string | null;
  label: string;
  minutes: number;
  reviews: number;
  sessions: number;
}

/**
 * Per-resource activity in a range. Resourceless sessions group as general
 * study (real counts, no invented target).
 */
export function computeResourceActivity(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string
): ResourceActivityRow[] {
  const { current } = resolveRangeWindows(range, today);
  const rows = new Map<string, ResourceActivityRow>();

  for (const session of filterSessionsByWindow(sessions, current, utcOffset)) {
    const key = session.resource_id || `__general__:${session.resource_title || 'general'}`;
    const label = session.resource_title || session.lesson_title || 'Estudio general';
    const row = rows.get(key) ?? {
      resourceId: session.resource_id ?? null,
      label,
      minutes: 0,
      reviews: 0,
      sessions: 0
    };
    row.minutes += session.duration_minutes || 0;
    row.reviews += (session.cards_reviewed || 0) + (session.questions_answered || 0);
    row.sessions += 1;
    rows.set(key, row);
  }

  return [...rows.values()].sort(
    (a, b) => b.minutes - a.minutes || b.reviews - a.reviews || a.label.localeCompare(b.label)
  );
}

/** Continuous daily series for charts (empty days zero-filled). */
export function buildDailySeries(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string,
  lang: LanguageCode = 'es'
): DailyActivityPoint[] {
  const { current } = resolveRangeWindows(range, today);
  const historyMap = new Map<string, { minutes: number; reviews: number }>();

  for (const session of filterSessionsByWindow(sessions, current, utcOffset)) {
    const day = sessionLocalDay(session.started_at, utcOffset);
    if (!day) continue;
    const entry = historyMap.get(day) || { minutes: 0, reviews: 0 };
    entry.minutes += session.duration_minutes || 0;
    entry.reviews += (session.cards_reviewed || 0) + (session.questions_answered || 0);
    historyMap.set(day, entry);
  }

  const history = [...historyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, data]) => ({ date, minutes: data.minutes, reviews: data.reviews }));

  return generateDailyActivitySeries(history, range, today, lang);
}

/** Active streak over local days with recorded study. */
export function computeStreakFromSessions(
  sessions: readonly LearningSession[],
  today: string,
  utcOffset?: string
): number {
  const days = new Set<string>();
  for (const session of sessions) {
    if ((session.duration_minutes || 0) <= 0) continue;
    const day = sessionLocalDay(session.started_at, utcOffset);
    if (day) days.add(day);
  }
  return computeActiveStreak(days, today);
}

/* -------------------------------------------------------------------------- */
/* Content progress                                                            */
/* -------------------------------------------------------------------------- */

export interface CourseProgressOverview {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  /** Real sum of completed/recorded lessons in courses WITH lessons. */
  lessonsCompleted: number;
  lessonsTotal: number;
  /** Null when no course has recorded lessons. */
  lessonPercent: number | null;
}

export interface BookProgressOverview {
  total: number;
  reading: number;
  finished: number;
  /** Only books with a known page count. */
  booksWithPageCount: number;
  pagesRead: number;
  pagesTotal: number;
  /** Null when no book declares a page count. */
  pagePercent: number | null;
}

export interface ContentProgressOverview {
  courses: CourseProgressOverview;
  books: BookProgressOverview;
  practice: PracticeWorkSummary;
}

/**
 * Aggregate content progress. Each collection measures its own and they NEVER
 * blend into one percent: courses count lessons, books count pages, practice
 * work counts finished pieces.
 */
export function computeContentProgress(
  courses: readonly Course[],
  books: readonly Book[],
  practice: readonly PracticeWork[]
): ContentProgressOverview {
  const course: CourseProgressOverview = {
    total: courses.length,
    completed: 0,
    inProgress: 0,
    notStarted: 0,
    lessonsCompleted: 0,
    lessonsTotal: 0,
    lessonPercent: null
  };

  for (const item of courses) {
    if (item.status === 'COMPLETED') course.completed += 1;
    else if (item.status === 'IN_PROGRESS') course.inProgress += 1;
    else course.notStarted += 1;

    const total = item.total_lessons ?? 0;
    if (total > 0) {
      course.lessonsTotal += total;
      course.lessonsCompleted += Math.min(item.completed_lessons ?? 0, total);
    }
  }
  if (course.lessonsTotal > 0) {
    course.lessonPercent = Math.round((course.lessonsCompleted / course.lessonsTotal) * 100);
  }

  const book: BookProgressOverview = {
    total: books.length,
    reading: 0,
    finished: 0,
    booksWithPageCount: 0,
    pagesRead: 0,
    pagesTotal: 0,
    pagePercent: null
  };

  for (const item of books) {
    const pageCount = item.page_count ?? 0;
    if (item.status === 'COMPLETED' || (pageCount > 0 && (item.current_page ?? 0) >= pageCount)) {
      book.finished += 1;
    } else if ((item.current_page ?? 0) > 0) {
      book.reading += 1;
    }
    if (pageCount > 0) {
      book.booksWithPageCount += 1;
      book.pagesTotal += pageCount;
      book.pagesRead += Math.min(item.current_page ?? 0, pageCount);
    }
  }
  if (book.pagesTotal > 0) {
    book.pagePercent = Math.round((book.pagesRead / book.pagesTotal) * 100);
  }

  return { courses: course, books: book, practice: summarizePracticeWork(practice) };
}

/* -------------------------------------------------------------------------- */
/* Recent activity                                                             */
/* -------------------------------------------------------------------------- */

export interface RecentActivityEntry {
  session: LearningSession;
  /** Local calendar day of the session. */
  day: string | null;
}

/** Recent sessions, newest first. */
export function recentActivity(
  sessions: readonly LearningSession[],
  limit: number,
  utcOffset?: string
): RecentActivityEntry[] {
  return [...sessions]
    .map((session) => ({ session, day: sessionLocalDay(session.started_at, utcOffset) }))
    .sort((a, b) => (b.session.started_at || '').localeCompare(a.session.started_at || ''))
    .slice(0, Math.max(0, limit));
}
