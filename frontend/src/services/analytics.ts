/**
 * Analítica de aprendizaje: agregaciones PURAS sobre los datos que CrossedArts
 * ya registra (`learning_session`, cursos, libros, trabajo práctico).
 *
 * Reglas de honestidad de este módulo:
 *  - Solo se miden hechos reales: minutos, días activos, sesiones, tarjetas,
 *    preguntas, aciertos, progreso de curso/libro/prácticas.
 *  - NO existen puntuaciones psicológicas, de motivación, de inteligencia ni de
 *    productividad. Si algo no se puede derivar de los datos, no se muestra.
 *  - Cuando un cociente no tiene denominador (cero preguntas, cero lecciones),
 *    el resultado es `null` y la UI lo dice explícitamente.
 *  - El día de estudio es el día calendario LOCAL (services/localDate.ts),
 *    inyectable para que los tests sean deterministas sin importar el huso.
 */
import type { Book, Course, LearningSession, PracticeWork, TimeRangeFilter } from '../types/models.ts';
import { resolveLocalDay, shiftIsoDay, computeActiveStreak } from './localDate.ts';
import { generateDailyActivitySeries } from './domainLogic.ts';
import { summarizePracticeWork, type PracticeWorkSummary } from './practiceWork.ts';
import type { DailyActivityPoint } from '../types/models.ts';

/** Rangos temporales disponibles en la vista de análisis. */
export type AnalyticsRange = TimeRangeFilter;

export const ANALYTICS_RANGES: AnalyticsRange[] = ['7d', '30d', '90d', 'all'];

export const ANALYTICS_RANGE_LABELS: Record<AnalyticsRange, string> = {
  '7d': '7 días',
  '30d': '30 días',
  '90d': '90 días',
  all: 'Todo'
};

/** Días cubiertos por un rango fijo (null para 'all'). */
export function rangeDayCount(range: AnalyticsRange): number | null {
  if (range === '7d') return 7;
  if (range === '30d') return 30;
  if (range === '90d') return 90;
  return null;
}

/**
 * Día calendario LOCAL de una marca de tiempo guardada por SQLite.
 *
 * `datetime('now')` escribe UTC sin marcador de zona, así que una cadena sin
 * zona se interpreta como UTC. Devuelve null para marcas ilegibles: esos
 * registros no se inventan en ningún día.
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

/** Totales agregados crudos de un conjunto de sesiones. */
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

/** Primera y última fecha `YYYY-MM-DD` de una ventana, ambas incluidas. */
export interface RangeWindow {
  /** Límite inferior inclusive (null en 'all'). */
  start: string | null;
  end: string | null;
}

/**
 * Ventana del rango ACTUAL y del rango INMEDIATAMENTE ANTERIOR de igual
 * longitud (para comparativas). En 'all' no hay ventana ni comparativa.
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

/** Rango de sesiones dentro de una ventana (ambos extremos incluidos). */
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

/** Precisión sobre preguntas contestadas; null cuando no se contestó nada. */
export function accuracyPercent(questionsAnswered: number, correctAnswers: number): number | null {
  if (!questionsAnswered || questionsAnswered <= 0) return null;
  const correct = Math.min(Math.max(correctAnswers, 0), questionsAnswered);
  return Math.round((correct / questionsAnswered) * 100);
}

export interface AnalyticsOverview {
  range: AnalyticsRange;
  /** Días cubiertos por el rango (null en 'all'). */
  daysInRange: number | null;
  studyMinutes: number;
  /** Días calendario locales con actividad registrada dentro del rango. */
  activeDays: number;
  sessionsCompleted: number;
  flashcardsReviewed: number;
  questionsAnswered: number;
  correctAnswers: number;
  /** null cuando no se contestaron preguntas en el rango. */
  accuracyPercent: number | null;
  /** Racha actual calculada sobre TODOS los días de estudio (no sobre el rango). */
  streakDays: number;
  /** Minutos por día activo (0 sin días activos; siempre un hecho, no una meta). */
  avgMinutesPerActiveDay: number;
}

/**
 * Visión general determinista para un rango.
 *
 * `today` y `sessions` (con sus días locales) se inyectan para que el cálculo
 * sea 100 % reproducible en tests. `today` debe ser el día local actual.
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
  /** Totales del rango actual. */
  current: SessionTotals;
  /** Totales del periodo anterior de igual longitud; null en 'all'. */
  previous: SessionTotals | null;
  /** Variación de minutos entre periodos; null si no hay periodo anterior. */
  deltaMinutes: number | null;
  /** Variación porcentual de minutos; null si el periodo anterior fue 0. */
  deltaPercent: number | null;
}

/**
 * Comparativa del rango actual contra el periodo inmediatamente anterior de
 * igual longitud. Con periodo anterior en cero minutos, `deltaPercent` es null
 * (un "+100 %" inventado sería ruido, no información).
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
  /** null cuando la sesión no tiene recurso asociado (estudio general). */
  resourceId: string | null;
  label: string;
  minutes: number;
  reviews: number;
  sessions: number;
}

/**
 * Actividad por recurso dentro de un rango. Sesiones sin recurso se agrupan
 * como "Estudio general" (se cuenta lo real, sin inventar un destino).
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

/** Serie diaria continua para gráficos (días vacíos rellenos con cero). */
export function buildDailySeries(
  sessions: readonly LearningSession[],
  range: AnalyticsRange,
  today: string,
  utcOffset?: string
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

  return generateDailyActivitySeries(history, range, today);
}

/** Racha activa sobre los días locales con estudio registrado. */
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
/* Progreso de contenido                                                       */
/* -------------------------------------------------------------------------- */

export interface CourseProgressOverview {
  total: number;
  completed: number;
  inProgress: number;
  notStarted: number;
  /** Suma real de lecciones completadas/registradas en cursos CON lecciones. */
  lessonsCompleted: number;
  lessonsTotal: number;
  /** null cuando ningún curso tiene lecciones registradas. */
  lessonPercent: number | null;
}

export interface BookProgressOverview {
  total: number;
  reading: number;
  finished: number;
  /** Solo libros con número de páginas conocido. */
  booksWithPageCount: number;
  pagesRead: number;
  pagesTotal: number;
  /** null cuando ningún libro declara número de páginas. */
  pagePercent: number | null;
}

export interface ContentProgressOverview {
  courses: CourseProgressOverview;
  books: BookProgressOverview;
  practice: PracticeWorkSummary;
}

/**
 * Progreso de contenido agregado. Cada colectivo mide lo suyo y NUNCA se mezcla
 * en un solo porcentaje: cursos miden lecciones, libros miden páginas y el
 * trabajo práctico cuenta piezas terminadas.
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
/* Actividad reciente                                                          */
/* -------------------------------------------------------------------------- */

export interface RecentActivityEntry {
  session: LearningSession;
  /** Día calendario local de la sesión. */
  day: string | null;
}

/** Sesiones recientes ordenadas de la más nueva a la más antigua. */
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
