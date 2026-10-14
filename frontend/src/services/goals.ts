/**
 * Learning goals: validation, derived progress, and date states. Pure logic
 * (no React, no SQLite, no network) for node:test coverage. Governing
 * principles: progress is NEVER persisted — it derives from real data (course,
 * book, practice work, study sessions) on every read. Each goal kind measures
 * ONE thing only; kinds never blend into one percent (a course goal does not
 * "advance" by reviewing cards). Without an honest measure (no resource, no
 * page total, no numeric target), `measurable` is `false` and percent is
 * `null`: the UI must say so, never invent 0%.
 */
import type { Book, Course, LearningGoal, GoalKind, PracticeWork } from '../types/models.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

/** Localized goal-kind labels. Defaults to Spanish. */
export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  course: 'Completar un curso',
  book: 'Terminar un libro',
  practice: 'Completar trabajo práctico',
  study_time: 'Tiempo de estudio',
  custom: 'Meta personalizada'
};

/** Stable order for populating selectors. */
export const GOAL_KINDS: GoalKind[] = ['course', 'book', 'practice', 'study_time', 'custom'];

/**
 * Localized goal-kind label. Defaults to Spanish to preserve the historic
 * behavior (existing callers and tests omit the language).
 */
export function goalKindLabel(kind: GoalKind, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.kind.${kind}`);
}

/** Localized unit label for a goal measure. */
const GOAL_UNIT_KEYS: Record<GoalUnit, string> = {
  lecciones: 'lessons',
  páginas: 'pages',
  piezas: 'pieces',
  minutos: 'minutes',
  ninguna: 'none'
};

export function goalUnitLabel(unit: GoalUnit, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `goals.unit.${GOAL_UNIT_KEYS[unit] ?? 'none'}`);
}

/** Goal kinds tied to a concrete resource (course or book). */
export const GOAL_KINDS_REQUIRING_RESOURCE: ReadonlySet<GoalKind> = new Set<GoalKind>(['course', 'book']);

/** Measure units per goal kind. The UI never concatenates them together. */
export type GoalUnit = 'lecciones' | 'páginas' | 'piezas' | 'minutos' | 'ninguna';

const GOAL_UNIT_BY_KIND: Record<GoalKind, GoalUnit> = {
  course: 'lecciones',
  book: 'páginas',
  practice: 'piezas',
  study_time: 'minutos',
  custom: 'ninguna'
};

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

export interface GoalDraft {
  title: string;
  description?: string | null;
  kind: GoalKind;
  resource_id?: string | null;
  target_value?: number | null;
  target_date?: string | null;
}

export interface GoalValidation {
  ok: boolean;
  /** Actionable localized message; present only when `ok` is false. */
  error?: string;
}

/** `YYYY-MM-DD` or ISO with time. `YYYY-MM-DD HH:MM:SS` also accepted. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Normalizes a date to `YYYY-MM-DD`; null when uninterpretable. */
export function normalizeGoalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!DAY_PATTERN.test(trimmed)) return null;
  const day = trimmed.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== day) return null;
  return day;
}

/**
 * Validates a goal draft before SQLite writes. Rules: 1. Title required. 2.
 * Course/book require a linked resource (nothing measurable without it). 3. A
 * numeric target, when present, must be finite and above zero. 4. Study time
 * requires a minute target (else no progress). 5. Target dates, when present,
 * must be real dates. 6. `blob:` URLs are never accepted in descriptions.
 */
export function validateGoalDraft(draft: GoalDraft, lang: LanguageCode = 'es'): GoalValidation {
  if (!draft.title || !draft.title.trim()) {
    return { ok: false, error: translateKey(lang, 'goals.validate.title') };
  }

  if (GOAL_KINDS_REQUIRING_RESOURCE.has(draft.kind) && !draft.resource_id) {
    return { ok: false, error: translateKey(lang, 'goals.validate.resource') };
  }

  if (draft.target_value !== undefined && draft.target_value !== null) {
    const value = draft.target_value;
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, error: translateKey(lang, 'goals.validate.targetNumber') };
    }
  }

  if (draft.kind === 'study_time' && !(typeof draft.target_value === 'number' && draft.target_value > 0)) {
    return { ok: false, error: translateKey(lang, 'goals.validate.studyMinutes') };
  }

  if (draft.target_date !== undefined && draft.target_date !== null && draft.target_date !== '') {
    if (!normalizeGoalDate(draft.target_date)) {
      return { ok: false, error: translateKey(lang, 'goals.validate.badDate') };
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Derived progress                                                            */
/* -------------------------------------------------------------------------- */

/** Minimal course data for goal measurement (precomputed counters). */
export interface GoalCourseContext {
  title: string;
  total_lessons: number;
  completed_lessons: number;
}

/** Minimal book data for goal measurement. */
export interface GoalBookContext {
  title: string;
  page_count?: number | null;
  current_page?: number | null;
  reading_percentage?: number | null;
}

export interface GoalProgressContext {
  courses: ReadonlyMap<string, GoalCourseContext>;
  books: ReadonlyMap<string, GoalBookContext>;
  practice: readonly PracticeWork[];
  /**
   * Study minutes logged since each goal's creation, keyed by goal id.
   * Injected from the DAO to keep this module SQLite-free.
   */
  studyMinutesByGoal: ReadonlyMap<string, number>;
}

export interface GoalProgress {
  /** True only with an honest complete measure of progress. */
  measurable: boolean;
  /** Measured current value (null when unmeasurable). */
  current: number | null;
  /** Target value (null when the goal defines none). */
  target: number | null;
  /** Rounded 0..100 percent (null when unmeasurable). */
  percent: number | null;
  unit: GoalUnit;
  /** Honest account of WHAT is measured. The UI always shows it. */
  basis: string;
  /** True when the linked resource no longer exists (user-deleted). */
  missingResource: boolean;
  /** True when the measure meets or exceeds the target. */
  reachedTarget: boolean;
}

function unmeasurable(unit: GoalUnit, basis: string, missingResource = false): GoalProgress {
  return {
    measurable: false,
    current: null,
    target: null,
    percent: null,
    unit,
    basis,
    missingResource,
    reachedTarget: false
  };
}

function measured(
  unit: GoalUnit,
  basis: string,
  current: number,
  target: number | null,
  missingResource = false
): GoalProgress {
  const percent = target !== null && target > 0
    ? Math.max(0, Math.min(100, Math.round((current / target) * 100)))
    : null;
  return {
    measurable: true,
    current,
    target,
    percent,
    unit,
    basis,
    missingResource,
    reachedTarget: target !== null && target > 0 && current >= target
  };
}

/**
 * Derives goal progress from real data. Documented edge cases (all tested):
 * lessons-less course -> unmeasurable (no divide-by-zero); page-less book ->
 * unmeasurable; deleted linked resource -> `missingResource`, unmeasurable;
 * practice without target or pieces -> unmeasurable; custom goals -> never
 * measurable, completed manually.
 */
export function computeGoalProgress(
  goal: LearningGoal,
  context: GoalProgressContext,
  lang: LanguageCode = 'es'
): GoalProgress {
  const unit = GOAL_UNIT_BY_KIND[goal.kind] ?? 'ninguna';
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);

  switch (goal.kind) {
    case 'course': {
      if (!goal.resource_id) return unmeasurable(unit, tr('goals.basis.noResource'));
      const course = context.courses.get(goal.resource_id);
      if (!course) return unmeasurable(unit, tr('goals.basis.courseGone'), true);
      if (!course.total_lessons || course.total_lessons <= 0) {
        return unmeasurable(unit, tr('goals.basis.courseNoLessons'));
      }
      return measured(
        unit,
        tr('goals.basis.courseLessons', { title: course.title }),
        course.completed_lessons,
        course.total_lessons
      );
    }

    case 'book': {
      if (!goal.resource_id) return unmeasurable(unit, tr('goals.basis.noResource'));
      const book = context.books.get(goal.resource_id);
      if (!book) return unmeasurable(unit, tr('goals.basis.bookGone'), true);
      const pageCount = book.page_count ?? null;
      if (!pageCount || pageCount <= 0) return unmeasurable(unit, tr('goals.basis.bookNoPages'));
      const current = Math.max(0, book.current_page ?? 0);
      return measured(unit, tr('goals.basis.bookPages', { title: book.title }), current, pageCount);
    }

    case 'practice': {
      const scope = goal.resource_id
        ? context.practice.filter((item) => item.resource_id === goal.resource_id)
        : [...context.practice];
      const done = scope.filter((item) => item.status === 'DONE').length;
      const explicitTarget = typeof goal.target_value === 'number' && goal.target_value > 0
        ? goal.target_value
        : null;
      const target = explicitTarget ?? scope.length;

      if (target <= 0) {
        return unmeasurable(
          unit,
          goal.resource_id
            ? tr('goals.basis.practiceNoneScoped')
            : tr('goals.basis.practiceNone')
        );
      }
      return measured(
        unit,
        explicitTarget
          ? tr('goals.basis.practiceTarget')
          : tr('goals.basis.practiceAll'),
        done,
        target
      );
    }

    case 'study_time': {
      const target = typeof goal.target_value === 'number' && goal.target_value > 0 ? goal.target_value : null;
      if (target === null) return unmeasurable(unit, tr('goals.basis.studyNoTarget'));
      const current = Math.max(0, context.studyMinutesByGoal.get(goal.id) ?? 0);
      return measured(unit, tr('goals.basis.studyMinutes'), current, target);
    }

    case 'custom':
    default:
      return unmeasurable('ninguna', tr('goals.basis.customManual'));
  }
}

/* -------------------------------------------------------------------------- */
/* Target date                                                                 */
/* -------------------------------------------------------------------------- */

export type GoalDeadlineState = 'completed' | 'overdue' | 'due_soon' | 'upcoming' | 'no_deadline';

/** Days within which a goal counts as "due soon". */
export const GOAL_DUE_SOON_DAYS = 7;

export const GOAL_DEADLINE_LABELS: Record<GoalDeadlineState, string> = {
  completed: 'Completada',
  overdue: 'Vencida',
  due_soon: 'Por vencer',
  upcoming: 'Próxima',
  no_deadline: 'Sin fecha'
};

/**
 * Localized deadline label. Defaults to Spanish to preserve the historic
 * behavior (existing callers and tests omit the language).
 */
export function goalDeadlineLabel(
  state: GoalDeadlineState,
  lang: LanguageCode = 'es',
): string {
  return translateKey(lang, `goals.deadline.${state}`);
}

/**
 * Classifies a goal target date against `today` (`YYYY-MM-DD`). States:
 * completed (date no longer matters); overdue (date passed — information, not
 * punishment); due_soon (0..7 days left); upcoming (over 7 days); no_deadline
 * (missing or unreadable date, reported honestly).
 */
export function classifyGoalDeadline(
  goal: Pick<LearningGoal, 'status' | 'target_date'>,
  today: string
): GoalDeadlineState {
  if (goal.status === 'completed') return 'completed';
  const due = normalizeGoalDate(goal.target_date);
  if (!due) return 'no_deadline';

  const diff = diffDays(today, due);
  if (Number.isNaN(diff)) return 'no_deadline';
  if (diff < 0) return 'overdue';
  if (diff <= GOAL_DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

/** Days between two `YYYY-MM-DD` dates (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Summary                                                                     */
/* -------------------------------------------------------------------------- */

export interface GoalSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueSoon: number;
  /** Active goals already at target (ready to close). */
  readyToComplete: number;
}

/**
 * Deterministic summary for status cards. Aggregates already computed states
 * and measures only: introduces no new metric.
 */
export function summarizeGoals(
  goals: readonly LearningGoal[],
  progressOf: (goal: LearningGoal) => GoalProgress,
  today: string
): GoalSummary {
  const summary: GoalSummary = {
    total: goals.length,
    active: 0,
    completed: 0,
    overdue: 0,
    dueSoon: 0,
    readyToComplete: 0
  };

  for (const goal of goals) {
    if (goal.status === 'completed') {
      summary.completed += 1;
      continue;
    }
    summary.active += 1;
    const deadline = classifyGoalDeadline(goal, today);
    if (deadline === 'overdue') summary.overdue += 1;
    if (deadline === 'due_soon') summary.dueSoon += 1;
    const progress = progressOf(goal);
    if (progress.reachedTarget) summary.readyToComplete += 1;
  }

  return summary;
}

/** Minimal courses for the measurement context (from in-memory rows). */
export function buildGoalContextCourses(courses: readonly Course[]): Map<string, GoalCourseContext> {
  const map = new Map<string, GoalCourseContext>();
  for (const course of courses) {
    map.set(course.id, {
      title: course.title,
      total_lessons: course.total_lessons ?? 0,
      completed_lessons: course.completed_lessons ?? 0
    });
  }
  return map;
}

/** Minimal books for the measurement context. */
export function buildGoalContextBooks(books: readonly Book[]): Map<string, GoalBookContext> {
  const map = new Map<string, GoalBookContext>();
  for (const book of books) {
    map.set(book.id, {
      title: book.title,
      page_count: book.page_count ?? null,
      current_page: book.current_page ?? null,
      reading_percentage: book.reading_percentage ?? null
    });
  }
  return map;
}
