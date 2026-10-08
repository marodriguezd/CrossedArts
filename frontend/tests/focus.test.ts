import test from 'node:test';
import assert from 'node:assert';

import {
  FOCUS_EMPTY_MESSAGE,
  FOCUS_PRIORITY,
  buildFocusPlan,
  buildFocusSummary,
  deriveRecentResources,
  type FocusInput
} from '../src/services/focus.ts';
import { computeGoalProgress, type GoalProgressContext } from '../src/services/goals.ts';
import type {
  Course,
  LearningGoal,
  LearningSession,
  PracticeWork,
  TodayStudySummary
} from '../src/types/models.ts';

const LOCAL_DAY = '2026-10-06';

const emptyToday: TodayStudySummary = {
  items_reviewed: 0,
  flashcards_reviewed: 0,
  questions_answered: 0,
  correct_answers: 0
};

function input(overrides: Partial<FocusInput> = {}): FocusInput {
  return {
    today: emptyToday,
    localDay: LOCAL_DAY,
    streakDays: 0,
    pendingReviews: 0,
    continueTarget: null,
    courses: [],
    books: [],
    practiceWork: [],
    goals: [],
    goalProgress: new Map(),
    recentSessions: [],
    ...overrides
  };
}

function course(overrides: Partial<Course> & { id: string }): Course {
  return {
    title: overrides.title ?? 'Curso',
    category: 'General',
    status: 'NOT_STARTED',
    type: 'course',
    ...overrides
  };
}

function practice(overrides: Partial<PracticeWork> & { id: string }): PracticeWork {
  return {
    title: 'Trabajo',
    kind: 'exercise',
    status: 'PLANNED',
    ...overrides
  };
}

function goal(overrides: Partial<LearningGoal> & { id: string }): LearningGoal {
  return {
    title: 'Meta',
    kind: 'custom',
    status: 'active',
    ...overrides
  };
}

test('focus: sin datos accionables el plan queda vacío (estado vacío honesto)', () => {
  const plan = buildFocusPlan(input());
  assert.deepStrictEqual(plan, []);
  assert.ok(FOCUS_EMPTY_MESSAGE.length > 0, 'Debe existir un mensaje de estado vacío');
  assert.doesNotMatch(FOCUS_EMPTY_MESSAGE, /deberías|recomendamos|potencial/i);
});

test('focus: las tarjetas pendientes encabezan el plan con su contador', () => {
  const plan = buildFocusPlan(input({ pendingReviews: 12 }));
  assert.strictEqual(plan.length, 1);
  assert.strictEqual(plan[0].kind, 'reviews');
  assert.strictEqual(plan[0].priority, FOCUS_PRIORITY.reviews);
  assert.strictEqual(plan[0].badge, '12');
  assert.match(plan[0].title, /12 tarjetas/);
  assert.match(plan[0].reason, /vencida/);
  assert.strictEqual(plan[0].tab, 'review');
});

test('focus: el trabajo en marcha prioriza sobre continuar el curso', () => {
  const plan = buildFocusPlan(
    input({
      pendingReviews: 3,
      practiceWork: [
        practice({ id: 'p1', title: 'Ensayo', status: 'IN_PROGRESS', resource_id: 'c1', updated_at: '2026-10-05' }),
        practice({ id: 'p2', title: 'Ejercicio', status: 'PLANNED', resource_id: 'c1' })
      ],
      continueTarget: {
        courseId: 'c1',
        lessonId: 'l1',
        courseTitle: 'React 18',
        lessonTitle: 'Fiber'
      }
    })
  );

  const kinds = plan.map(item => item.kind);
  assert.deepStrictEqual(kinds, ['reviews', 'practice', 'continue_lesson']);

  const practiceItem = plan.find(item => item.kind === 'practice');
  assert.strictEqual(practiceItem?.title, 'Continuar «Ensayo»');
  assert.strictEqual(practiceItem?.destination?.tab, 'resource', 'Abre su contexto de origen');
  // Solo los PLANNED no aparecen como "en marcha".
  assert.strictEqual(plan.filter(item => item.kind === 'practice').length, 1);
});

test('focus: el destino de continuar apunta a la lección pendiente concreta', () => {
  const plan = buildFocusPlan(
    input({
      continueTarget: {
        courseId: 'c1',
        lessonId: 'l9',
        courseTitle: 'React 18',
        lessonTitle: 'Custom Hooks',
        moduleTitle: 'Módulo 2'
      }
    })
  );
  const item = plan.find(entry => entry.kind === 'continue_lesson');
  assert.ok(item);
  assert.deepStrictEqual(item.destination, { tab: 'course', resourceId: 'c1', lessonId: 'l9' });
  assert.match(item.reason, /Custom Hooks/);
  assert.match(item.reason, /Módulo 2/);
});

test('focus: las metas vencidas y por vencer aparecen con su estado y destino de meta', () => {
  const goals = [
    goal({ id: 'g-over', title: 'Meta vencida', target_date: '2026-10-01' }),
    goal({ id: 'g-soon', title: 'Meta próxima', target_date: '2026-10-10' }),
    goal({ id: 'g-far', title: 'Meta lejana', target_date: '2026-12-31' }),
    goal({ id: 'g-none', title: 'Meta sin fecha' })
  ];
  const plan = buildFocusPlan(input({ goals }));

  const kinds = plan.map(item => item.kind);
  assert.ok(kinds.includes('goal_overdue'));
  assert.ok(kinds.includes('goal_due_soon'));
  assert.ok(!kinds.includes('goal_ready'), 'La meta lejana sin progreso no es acción de hoy');

  const overdue = plan.find(item => item.kind === 'goal_overdue');
  assert.strictEqual(overdue?.destination?.tab, 'goals');
  assert.strictEqual(overdue?.badge, 'Vencida');
  assert.strictEqual(overdue?.title, 'Meta vencida');
});

test('focus: una meta cuyo progreso alcanzó el objetivo se marca para cerrar', () => {
  const goalRow = goal({ id: 'g1', kind: 'course', resource_id: 'c1' });
  const ctx: GoalProgressContext = {
    courses: new Map([['c1', { title: 'Curso', total_lessons: 4, completed_lessons: 4 }]]),
    books: new Map(),
    practice: [],
    studyMinutesByGoal: new Map()
  };
  const progress = computeGoalProgress(goalRow, ctx);

  const plan = buildFocusPlan(
    input({
      goals: [goalRow],
      goalProgress: new Map([[goalRow.id, progress]])
    })
  );

  const ready = plan.find(item => item.kind === 'goal_ready');
  assert.ok(ready, 'Una meta al 100 % debe ofrecerse para cerrar');
  assert.match(ready.reason, /alcanza el objetivo/);
  assert.strictEqual(ready.destination?.tab, 'goals');
});

test('focus: libro en curso se ofrece solo cuando no hay continuación de curso', () => {
  const books = [
    { id: 'b1', title: 'Deep Work', category: 'X', status: 'IN_PROGRESS' as const, type: 'book' as const, reading_percentage: 34, page_count: 304, current_page: 106 }
  ];

  const withContinue = buildFocusPlan(
    input({
      books,
      continueTarget: { courseId: 'c1', lessonId: 'l1', courseTitle: 'C', lessonTitle: 'L' }
    })
  );
  assert.ok(!withContinue.some(item => item.kind === 'book'));

  const withoutContinue = buildFocusPlan(input({ books }));
  const bookItem = withoutContinue.find(item => item.kind === 'book');
  assert.ok(bookItem);
  assert.match(bookItem.reason, /página 106 de 304/);
  assert.strictEqual(bookItem.destination?.tab, 'resource');
});

test('focus: curso sin empezar con lecciones aparece como acción de arranque', () => {
  const courses = [
    course({ id: 'c1', title: 'Curso nuevo', total_lessons: 8 }),
    course({ id: 'c2', title: 'Curso sin lecciones', total_lessons: 0 })
  ];
  const plan = buildFocusPlan(input({ courses }));
  const start = plan.find(item => item.kind === 'start_course');
  assert.ok(start, 'Solo los cursos con lecciones registradas son empezables');
  assert.strictEqual(start.destination?.tab, 'course');
  assert.strictEqual(
    plan.filter(item => item.kind === 'start_course').length,
    1,
    'El curso sin lecciones no genera acción'
  );
});

test('focus: el orden final es determinista (prioridad descendente, id ascendente)', () => {
  const shared = {
    pendingReviews: 5,
    practiceWork: [
      practice({ id: 'p-b', title: 'B', status: 'IN_PROGRESS', resource_id: 'c1', updated_at: '2026-10-05' }),
      practice({ id: 'p-a', title: 'A', status: 'IN_PROGRESS', resource_id: 'c1', updated_at: '2026-10-05' })
    ],
    courses: [course({ id: 'c9', title: 'Curso 9', total_lessons: 3 })],
    books: [
      { id: 'b2', title: 'Libro', category: 'X', status: 'IN_PROGRESS' as const, type: 'book' as const, reading_percentage: 10, page_count: 100, current_page: 10 }
    ]
  };

  const first = buildFocusPlan(input(shared)).map(item => item.id);
  const second = buildFocusPlan(input(shared)).map(item => item.id);
  assert.deepStrictEqual(first, second, 'La misma entrada debe producir el mismo plan');

  const priorities = buildFocusPlan(input(shared)).map(item => item.priority);
  const sorted = [...priorities].sort((a, b) => b - a);
  assert.deepStrictEqual(priorities, sorted);
});

test('focus: el resumen refleja solo hechos de hoy y la meta más próxima', () => {
  const goals = [
    goal({ id: 'g-far', title: 'Lejana', target_date: '2026-12-01' }),
    goal({ id: 'g-soon', title: 'Próxima', target_date: '2026-10-10' })
  ];
  const summary = buildFocusSummary(
    input({
      streakDays: 4,
      pendingReviews: 7,
      minutesToday: 35,
      today: { items_reviewed: 9, flashcards_reviewed: 6, questions_answered: 3, correct_answers: 2 },
      goals
    })
  );

  assert.strictEqual(summary.streakDays, 4);
  assert.strictEqual(summary.pendingReviews, 7);
  assert.strictEqual(summary.minutesToday, 35);
  assert.strictEqual(summary.reviewsToday, 9);
  assert.strictEqual(summary.correctToday, 2);
  assert.strictEqual(summary.nextGoal?.id, 'g-soon', 'Ordena por fecha objetivo ascendente');
  assert.strictEqual(summary.nextGoalDeadline, 'due_soon');
});

test('focus: resumen vacío sin metas ni actividad', () => {
  const summary = buildFocusSummary(input());
  assert.strictEqual(summary.streakDays, 0);
  assert.strictEqual(summary.pendingReviews, 0);
  assert.strictEqual(summary.minutesToday, 0);
  assert.strictEqual(summary.nextGoal, null);
  assert.strictEqual(summary.nextGoalProgress, null);
  assert.strictEqual(summary.nextGoalDeadline, null);
});

test('focus: recursos recientes deduplicados y ordenados de nuevo a antiguo', () => {
  const sessions: LearningSession[] = [
    {
      id: 's1', started_at: '2026-10-06 10:00:00', duration_minutes: 20, inactive_seconds: 0,
      mode: 'flashcards', cards_reviewed: 4, questions_answered: 0, correct_answers: 0,
      status: 'completed', resource_id: 'c1', resource_title: 'React 18'
    },
    {
      id: 's2', started_at: '2026-10-05 10:00:00', duration_minutes: 30, inactive_seconds: 0,
      mode: 'mixed', cards_reviewed: 0, questions_answered: 5, correct_answers: 3,
      status: 'completed', resource_id: 'c1', resource_title: 'React 18'
    },
    {
      id: 's3', started_at: '2026-10-04 10:00:00', duration_minutes: 10, inactive_seconds: 0,
      mode: 'practice', cards_reviewed: 0, questions_answered: 0, correct_answers: 0,
      status: 'completed', resource_id: 'b1', resource_title: 'Deep Work'
    },
    {
      id: 's4', started_at: '2026-10-03 10:00:00', duration_minutes: 5, inactive_seconds: 0,
      mode: 'flashcards', cards_reviewed: 1, questions_answered: 0, correct_answers: 0,
      status: 'cancelled'
    }
  ];

  const recent = deriveRecentResources(sessions, 5);
  assert.strictEqual(recent.length, 2, 'Sesiones canceladas y sin recurso no cuentan');
  assert.strictEqual(recent[0].label, 'React 18');
  assert.strictEqual(recent[0].minutes, 50, 'Acumula los minutos del mismo recurso');
  assert.strictEqual(recent[1].label, 'Deep Work');

  assert.deepStrictEqual(deriveRecentResources([], 5), []);
  assert.strictEqual(deriveRecentResources(sessions, 1).length, 1);
});
