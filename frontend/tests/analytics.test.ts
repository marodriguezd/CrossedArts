import test from 'node:test';
import assert from 'node:assert';

import {
  ANALYTICS_RANGES,
  accuracyPercent,
  buildDailySeries,
  computeAnalyticsOverview,
  computeContentProgress,
  computeRangeComparison,
  computeResourceActivity,
  computeStreakFromSessions,
  filterSessionsByWindow,
  rangeDayCount,
  recentActivity,
  resolveRangeWindows,
  sessionLocalDay
} from '../src/services/analytics.ts';
import type { Book, Course, LearningSession, PracticeWork } from '../src/types/models.ts';

/** Huso fijo para que todos los tests sean deterministas sin importar el TZ. */
const UTC = '+00:00';
const TODAY = '2026-10-06';

function session(overrides: Partial<LearningSession> & { started_at: string }): LearningSession {
  return {
    id: overrides.id ?? `s_${Math.random().toString(36).slice(2, 8)}`,
    duration_minutes: 0,
    inactive_seconds: 0,
    mode: 'flashcards',
    cards_reviewed: 0,
    questions_answered: 0,
    correct_answers: 0,
    status: 'completed',
    ...overrides
  };
}

/** Sesión a mediodía UTC de un día concreto (evita bordes de medianoche). */
function onDay(day: string, overrides: Partial<LearningSession> = {}): LearningSession {
  return session({ started_at: `${day} 12:00:00`, ...overrides });
}

test('analytics: rangos disponibles y días cubiertos', () => {
  assert.deepStrictEqual(ANALYTICS_RANGES, ['7d', '30d', '90d', 'all']);
  assert.strictEqual(rangeDayCount('7d'), 7);
  assert.strictEqual(rangeDayCount('30d'), 30);
  assert.strictEqual(rangeDayCount('90d'), 90);
  assert.strictEqual(rangeDayCount('all'), null);
});

test('analytics: sessionLocalDay etiqueta el día calendario local con offset inyectado', () => {
  assert.strictEqual(sessionLocalDay('2026-10-06 12:00:00', UTC), '2026-10-06');
  // Offset negativo: 23:30 UTC del día 6 sigue siendo el día 6 en -03:00.
  assert.strictEqual(sessionLocalDay('2026-10-06 23:30:00', '-03:00'), '2026-10-06');
  // Offset negativo: 01:30 UTC del día 7 es el día 6 en -03:00.
  assert.strictEqual(sessionLocalDay('2026-10-07 01:30:00', '-03:00'), '2026-10-06');
  // ISO con zona: se respeta.
  assert.strictEqual(sessionLocalDay('2026-10-06T12:00:00Z', UTC), '2026-10-06');
  // Marcas ilegibles → null (no se inventa un día).
  assert.strictEqual(sessionLocalDay('no-es-fecha', UTC), null);
  assert.strictEqual(sessionLocalDay('', UTC), null);
});

test('analytics: usuario sin datos → ceros honestos y precisión null', () => {
  const overview = computeAnalyticsOverview([], '7d', TODAY, 0, UTC);
  assert.strictEqual(overview.studyMinutes, 0);
  assert.strictEqual(overview.activeDays, 0);
  assert.strictEqual(overview.sessionsCompleted, 0);
  assert.strictEqual(overview.flashcardsReviewed, 0);
  assert.strictEqual(overview.questionsAnswered, 0);
  assert.strictEqual(overview.accuracyPercent, null, 'Sin preguntas no hay precisión que mostrar');
  assert.strictEqual(overview.avgMinutesPerActiveDay, 0);
  assert.strictEqual(overview.daysInRange, 7);
});

test('analytics: filtra por ventana del rango (ambos extremos incluidos)', () => {
  const sessions = [
    onDay('2026-10-06', { duration_minutes: 30, cards_reviewed: 5 }),
    onDay('2026-10-05', { duration_minutes: 20 }),
    onDay('2026-09-30', { duration_minutes: 10 }), // límite inferior de 7d (incluido)
    onDay('2026-08-01', { duration_minutes: 99 })  // dentro de 90d, fuera de 30d
  ];

  const { current } = resolveRangeWindows('7d', TODAY);
  assert.strictEqual(current.start, '2026-09-30');
  assert.strictEqual(current.end, TODAY);

  const in7 = filterSessionsByWindow(sessions, current, UTC);
  assert.strictEqual(in7.length, 3, 'Los dos extremos de la ventana están incluidos');

  const overview7 = computeAnalyticsOverview(sessions, '7d', TODAY, 0, UTC);
  assert.strictEqual(overview7.studyMinutes, 60);
  assert.strictEqual(overview7.activeDays, 3);

  const overview30 = computeAnalyticsOverview(sessions, '30d', TODAY, 0, UTC);
  assert.strictEqual(overview30.studyMinutes, 60);

  const overview90 = computeAnalyticsOverview(sessions, '90d', TODAY, 0, UTC);
  assert.strictEqual(overview90.studyMinutes, 159);

  const overviewAll = computeAnalyticsOverview(sessions, 'all', TODAY, 0, UTC);
  assert.strictEqual(overviewAll.studyMinutes, 159);
  assert.strictEqual(overviewAll.daysInRange, null);
});

test('analytics: precisión sobre preguntas contestadas, con techo de aciertos', () => {
  assert.strictEqual(accuracyPercent(0, 0), null);
  assert.strictEqual(accuracyPercent(10, 7), 70);
  assert.strictEqual(accuracyPercent(3, 0), 0);
  // Un dato corrupto con más aciertos que preguntas se limita al 100 %.
  assert.strictEqual(accuracyPercent(2, 5), 100);
});

test('analytics: overview calcula precisión real del rango', () => {
  const sessions = [
    onDay('2026-10-06', { questions_answered: 10, correct_answers: 8, cards_reviewed: 4 }),
    onDay('2026-10-05', { questions_answered: 5, correct_answers: 2, cards_reviewed: 6 })
  ];
  const overview = computeAnalyticsOverview(sessions, '7d', TODAY, 0, UTC);
  assert.strictEqual(overview.questionsAnswered, 15);
  assert.strictEqual(overview.correctAnswers, 10);
  assert.strictEqual(overview.accuracyPercent, 67);
  assert.strictEqual(overview.flashcardsReviewed, 10);
  assert.strictEqual(overview.sessionsCompleted, 2);
});

test('analytics: comparativa contra el periodo anterior de igual longitud', () => {
  const sessions = [
    onDay('2026-10-06', { duration_minutes: 40 }),
    onDay('2026-10-04', { duration_minutes: 20 }),
    // Periodo anterior de 7d: 2026-09-23..2026-09-29
    onDay('2026-09-28', { duration_minutes: 30 })
  ];

  const comparison = computeRangeComparison(sessions, '7d', TODAY, UTC);
  assert.strictEqual(comparison.current.studyMinutes, 60);
  assert.strictEqual(comparison.previous?.studyMinutes, 30);
  assert.strictEqual(comparison.deltaMinutes, 30);
  assert.strictEqual(comparison.deltaPercent, 100);

  const allTime = computeRangeComparison(sessions, 'all', TODAY, UTC);
  assert.strictEqual(allTime.previous, null);
  assert.strictEqual(allTime.deltaMinutes, null);
  assert.strictEqual(allTime.deltaPercent, null);
});

test('analytics: comparativa con periodo anterior en cero no inventa porcentaje', () => {
  const sessions = [onDay('2026-10-06', { duration_minutes: 40 })];
  const comparison = computeRangeComparison(sessions, '7d', TODAY, UTC);
  assert.strictEqual(comparison.current.studyMinutes, 40);
  assert.strictEqual(comparison.previous?.studyMinutes, 0);
  assert.strictEqual(comparison.deltaMinutes, 40);
  assert.strictEqual(comparison.deltaPercent, null);
});

test('analytics: actividad por recurso agrupa, etiqueta y ordena de forma honesta', () => {
  const sessions = [
    onDay('2026-10-06', { duration_minutes: 45, resource_id: 'c1', resource_title: 'React 18' }),
    onDay('2026-10-05', { duration_minutes: 15, resource_id: 'c1', resource_title: 'React 18', cards_reviewed: 3 }),
    onDay('2026-10-04', { duration_minutes: 30, resource_id: 'b1', resource_title: 'Deep Work' }),
    onDay('2026-10-03', { duration_minutes: 5 }) // sin recurso
  ];

  const rows = computeResourceActivity(sessions, '30d', TODAY, UTC);
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].label, 'React 18');
  assert.strictEqual(rows[0].minutes, 60);
  assert.strictEqual(rows[0].sessions, 2);
  assert.strictEqual(rows[0].reviews, 3);
  assert.strictEqual(rows[1].label, 'Deep Work');
  assert.strictEqual(rows[2].label, 'Estudio general');
  assert.strictEqual(rows[2].resourceId, null);
});

test('analytics: serie diaria continua rellena los días vacíos', () => {
  const sessions = [
    onDay('2026-10-06', { duration_minutes: 30 }),
    onDay('2026-10-04', { duration_minutes: 10, cards_reviewed: 2 })
  ];
  const series = buildDailySeries(sessions, '7d', TODAY, UTC);
  assert.strictEqual(series.length, 7);
  assert.strictEqual(series[series.length - 1].date, TODAY);
  assert.strictEqual(series[series.length - 1].minutes, 30);
  const emptyDay = series.find(p => p.date === '2026-10-05');
  assert.ok(emptyDay, 'El día sin actividad debe existir en la serie');
  assert.strictEqual(emptyDay.minutes, 0);
  assert.strictEqual(emptyDay.reviews, 0);
  const total = series.reduce((sum, p) => sum + p.minutes, 0);
  assert.strictEqual(total, 40);
});

test('analytics: la racha se calcula sobre días locales con minutos registrados', () => {
  const sessions = [
    onDay('2026-10-06', { duration_minutes: 20 }),
    onDay('2026-10-05', { duration_minutes: 10 }),
    onDay('2026-10-03', { duration_minutes: 10 }), // hueco el 4 → racha de 2
    onDay('2026-10-01', { duration_minutes: 0 })   // sin minutos → no cuenta
  ];
  assert.strictEqual(computeStreakFromSessions(sessions, TODAY, UTC), 2);
  assert.strictEqual(computeStreakFromSessions([], TODAY, UTC), 0);
});

test('analytics: progreso de contenido nunca mezcla unidades ni divide por cero', () => {
  const courses: Course[] = [
    { id: 'c1', title: 'Curso A', category: 'X', status: 'IN_PROGRESS', type: 'course', total_lessons: 10, completed_lessons: 4 },
    { id: 'c2', title: 'Curso B', category: 'X', status: 'NOT_STARTED', type: 'course', total_lessons: 0, completed_lessons: 0 },
    { id: 'c3', title: 'Curso C', category: 'X', status: 'COMPLETED', type: 'course', total_lessons: 5, completed_lessons: 5 }
  ];
  const books: Book[] = [
    { id: 'b1', title: 'Libro A', category: 'X', status: 'IN_PROGRESS', type: 'book', reading_percentage: 0, page_count: 200, current_page: 50 },
    { id: 'b2', title: 'Libro B', category: 'X', status: 'NOT_STARTED', type: 'book', reading_percentage: 0 } // sin page_count
  ];
  const practice: PracticeWork[] = [
    { id: 'p1', title: 'P1', kind: 'exercise', status: 'DONE' },
    { id: 'p2', title: 'P2', kind: 'essay', status: 'IN_PROGRESS' },
    { id: 'p3', title: 'P3', kind: 'code', status: 'PLANNED' }
  ];

  const progress = computeContentProgress(courses, books, practice);

  assert.strictEqual(progress.courses.total, 3);
  assert.strictEqual(progress.courses.completed, 1);
  assert.strictEqual(progress.courses.inProgress, 1);
  assert.strictEqual(progress.courses.notStarted, 1);
  assert.strictEqual(progress.courses.lessonsTotal, 15, 'El curso sin lecciones no aporta denominador');
  assert.strictEqual(progress.courses.lessonsCompleted, 9);
  assert.strictEqual(progress.courses.lessonPercent, 60);

  assert.strictEqual(progress.books.total, 2);
  assert.strictEqual(progress.books.booksWithPageCount, 1);
  assert.strictEqual(progress.books.pagesRead, 50);
  assert.strictEqual(progress.books.pagesTotal, 200);
  assert.strictEqual(progress.books.pagePercent, 25);

  assert.strictEqual(progress.practice.total, 3);
  assert.strictEqual(progress.practice.done, 1);
});

test('analytics: sin cursos ni libros el progreso reporta null, no 0 %', () => {
  const progress = computeContentProgress([], [], []);
  assert.strictEqual(progress.courses.lessonPercent, null);
  assert.strictEqual(progress.books.pagePercent, null);
  assert.strictEqual(progress.practice.completionPercent, 0);
});

test('analytics: actividad reciente ordena de nueva a antigua y limita', () => {
  const sessions = [
    onDay('2026-10-04', { resource_id: 'a', resource_title: 'A' }),
    onDay('2026-10-06', { resource_id: 'b', resource_title: 'B' }),
    onDay('2026-10-05', { resource_id: 'c', resource_title: 'C' })
  ];
  const recent = recentActivity(sessions, 2, UTC);
  assert.strictEqual(recent.length, 2);
  assert.strictEqual(recent[0].session.resource_title, 'B');
  assert.strictEqual(recent[1].session.resource_title, 'C');
  assert.strictEqual(recent[0].day, '2026-10-06');
});
