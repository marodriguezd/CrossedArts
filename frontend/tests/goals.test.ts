import test from 'node:test';
import assert from 'node:assert';

import {
  GOAL_DUE_SOON_DAYS,
  buildGoalContextBooks,
  buildGoalContextCourses,
  classifyGoalDeadline,
  computeGoalProgress,
  diffDays,
  normalizeGoalDate,
  summarizeGoals,
  validateGoalDraft,
  type GoalProgressContext
} from '../src/services/goals.ts';
import type { LearningGoal, PracticeWork } from '../src/types/models.ts';

const TODAY = '2026-10-06';

function goal(overrides: Partial<LearningGoal> & { id: string }): LearningGoal {
  return {
    title: 'Meta de prueba',
    kind: 'custom',
    status: 'active',
    ...overrides
  };
}

function context(overrides: Partial<GoalProgressContext> = {}): GoalProgressContext {
  return {
    courses: new Map(),
    books: new Map(),
    practice: [],
    studyMinutesByGoal: new Map(),
    ...overrides
  };
}

/* ------------------------------- validación ------------------------------- */

test('goals: validación de borradores', () => {
  assert.strictEqual(validateGoalDraft({ title: '', kind: 'custom' }).ok, false);
  assert.strictEqual(validateGoalDraft({ title: '   ', kind: 'custom' }).ok, false);

  // Curso/libro exigen recurso enlazado.
  const courseNoResource = validateGoalDraft({ title: 'Terminar curso', kind: 'course' });
  assert.strictEqual(courseNoResource.ok, false);
  assert.match(courseNoResource.error ?? '', /recurso/);

  assert.strictEqual(
    validateGoalDraft({ title: 'Terminar curso', kind: 'course', resource_id: 'c1' }).ok,
    true
  );
  assert.strictEqual(validateGoalDraft({ title: 'Libro', kind: 'book', resource_id: 'b1' }).ok, true);

  // Objetivo numérico inválido.
  assert.strictEqual(
    validateGoalDraft({ title: 'Prácticas', kind: 'practice', target_value: 0 }).ok,
    false
  );
  assert.strictEqual(
    validateGoalDraft({ title: 'Prácticas', kind: 'practice', target_value: -3 }).ok,
    false
  );
  assert.strictEqual(
    validateGoalDraft({ title: 'Prácticas', kind: 'practice', target_value: 5 }).ok,
    true
  );

  // Tiempo de estudio exige minutos objetivo.
  const noMinutes = validateGoalDraft({ title: 'Estudiar', kind: 'study_time' });
  assert.strictEqual(noMinutes.ok, false);
  assert.strictEqual(
    validateGoalDraft({ title: 'Estudiar', kind: 'study_time', target_value: 600 }).ok,
    true
  );

  // Fecha inválida rechazada; fecha válida aceptada.
  assert.strictEqual(
    validateGoalDraft({ title: 'Meta', kind: 'custom', target_date: 'mañana' }).ok,
    false
  );
  assert.strictEqual(
    validateGoalDraft({ title: 'Meta', kind: 'custom', target_date: '2026-11-01' }).ok,
    true
  );
  assert.strictEqual(
    validateGoalDraft({ title: 'Meta', kind: 'custom', target_date: '2026-02-30' }).ok,
    false
  );
});

test('goals: normalizeGoalDate admite formatos reales y rechaza basura', () => {
  assert.strictEqual(normalizeGoalDate('2026-11-01'), '2026-11-01');
  assert.strictEqual(normalizeGoalDate('2026-11-01T10:30:00Z'), '2026-11-01');
  assert.strictEqual(normalizeGoalDate('2026-11-01 10:30:00'), '2026-11-01');
  assert.strictEqual(normalizeGoalDate('01/11/2026'), null);
  assert.strictEqual(normalizeGoalDate(''), null);
  assert.strictEqual(normalizeGoalDate(null), null);
  assert.strictEqual(normalizeGoalDate(undefined), null);
});

/* -------------------------------- progreso -------------------------------- */

test('goals: meta de curso mide lecciones completadas/total', () => {
  const courses = new Map([
    ['c1', { title: 'React 18', total_lessons: 10, completed_lessons: 4 }]
  ]);
  const progress = computeGoalProgress(
    goal({ id: 'g1', kind: 'course', resource_id: 'c1' }),
    context({ courses })
  );
  assert.strictEqual(progress.measurable, true);
  assert.strictEqual(progress.current, 4);
  assert.strictEqual(progress.target, 10);
  assert.strictEqual(progress.percent, 40);
  assert.strictEqual(progress.unit, 'lecciones');
  assert.strictEqual(progress.reachedTarget, false);
  assert.strictEqual(progress.missingResource, false);
});

test('goals: curso sin lecciones no es medible (no se divide entre cero)', () => {
  const courses = new Map([
    ['c1', { title: 'Vacío', total_lessons: 0, completed_lessons: 0 }]
  ]);
  const progress = computeGoalProgress(
    goal({ id: 'g1', kind: 'course', resource_id: 'c1' }),
    context({ courses })
  );
  assert.strictEqual(progress.measurable, false);
  assert.strictEqual(progress.percent, null);
  assert.match(progress.basis, /no tiene lecciones/);
});

test('goals: recurso enlazado borrado se reporta como missingResource', () => {
  const progress = computeGoalProgress(
    goal({ id: 'g1', kind: 'course', resource_id: 'borrado' }),
    context()
  );
  assert.strictEqual(progress.measurable, false);
  assert.strictEqual(progress.missingResource, true);
  assert.match(progress.basis, /ya no existe/);
});

test('goals: meta de libro usa páginas y tolera libros sin page_count', () => {
  const books = new Map([
    ['b1', { title: 'Deep Work', page_count: 300, current_page: 100 }],
    ['b2', { title: 'Sin páginas', page_count: null, current_page: null }]
  ]);

  const ok = computeGoalProgress(goal({ id: 'g1', kind: 'book', resource_id: 'b1' }), context({ books }));
  assert.strictEqual(ok.measurable, true);
  assert.strictEqual(ok.current, 100);
  assert.strictEqual(ok.target, 300);
  assert.strictEqual(ok.percent, 33);
  assert.strictEqual(ok.unit, 'páginas');

  const noPages = computeGoalProgress(goal({ id: 'g2', kind: 'book', resource_id: 'b2' }), context({ books }));
  assert.strictEqual(noPages.measurable, false);
  assert.strictEqual(noPages.percent, null);
  assert.match(noPages.basis, /número de páginas/);
});

test('goals: meta de práctica mide piezas terminadas (con y sin objetivo explícito)', () => {
  const practice: PracticeWork[] = [
    { id: 'p1', title: 'Ejercicio 1', kind: 'exercise', status: 'DONE', resource_id: 'c1' },
    { id: 'p2', title: 'Ejercicio 2', kind: 'exercise', status: 'DONE', resource_id: 'c1' },
    { id: 'p3', title: 'Ejercicio 3', kind: 'exercise', status: 'PLANNED', resource_id: 'c1' },
    { id: 'p4', title: 'Otro curso', kind: 'exercise', status: 'PLANNED', resource_id: 'otro' }
  ];

  // Sin objetivo explícito: terminar todos los del ámbito.
  const all = computeGoalProgress(goal({ id: 'g1', kind: 'practice' }), context({ practice }));
  assert.strictEqual(all.measurable, true);
  assert.strictEqual(all.current, 2);
  assert.strictEqual(all.target, 4);
  assert.strictEqual(all.percent, 50);
  assert.strictEqual(all.unit, 'piezas');

  // Con recurso enlazado: solo cuenta los de ese recurso.
  const scoped = computeGoalProgress(
    goal({ id: 'g2', kind: 'practice', resource_id: 'c1' }),
    context({ practice })
  );
  assert.strictEqual(scoped.current, 2);
  assert.strictEqual(scoped.target, 3);

  // Con objetivo explícito mayor que las piezas registradas.
  const explicit = computeGoalProgress(
    goal({ id: 'g3', kind: 'practice', target_value: 8 }),
    context({ practice })
  );
  assert.strictEqual(explicit.target, 8);
  assert.strictEqual(explicit.percent, 25);

  // Sin ninguna pieza ni objetivo → no medible.
  const empty = computeGoalProgress(goal({ id: 'g4', kind: 'practice' }), context());
  assert.strictEqual(empty.measurable, false);
  assert.strictEqual(empty.percent, null);
});

test('goals: meta de tiempo de estudio mide minutos desde su creación', () => {
  const studyMinutesByGoal = new Map([['g1', 120]]);
  const progress = computeGoalProgress(
    goal({ id: 'g1', kind: 'study_time', target_value: 300 }),
    context({ studyMinutesByGoal })
  );
  assert.strictEqual(progress.measurable, true);
  assert.strictEqual(progress.current, 120);
  assert.strictEqual(progress.target, 300);
  assert.strictEqual(progress.percent, 40);
  assert.strictEqual(progress.unit, 'minutos');

  // Sin minutos registrados → 0 % real, no null.
  const zero = computeGoalProgress(
    goal({ id: 'g2', kind: 'study_time', target_value: 100 }),
    context()
  );
  assert.strictEqual(zero.current, 0);
  assert.strictEqual(zero.percent, 0);
});

test('goals: meta personalizada nunca es medible', () => {
  const progress = computeGoalProgress(goal({ id: 'g1', kind: 'custom' }), context());
  assert.strictEqual(progress.measurable, false);
  assert.strictEqual(progress.percent, null);
  assert.strictEqual(progress.unit, 'ninguna');
});

test('goals: progreso completo marca reachedTarget y se limita al 100 %', () => {
  const courses = new Map([['c1', { title: 'Curso', total_lessons: 4, completed_lessons: 6 }]]);
  const progress = computeGoalProgress(
    goal({ id: 'g1', kind: 'course', resource_id: 'c1' }),
    context({ courses })
  );
  assert.strictEqual(progress.percent, 100, 'El porcentaje se limita a 100 aunque los datos lo superen');
  assert.strictEqual(progress.reachedTarget, true);
});

/* -------------------------------- fechas --------------------------------- */

test('goals: clasificación de fecha objetivo', () => {
  assert.strictEqual(GOAL_DUE_SOON_DAYS, 7);

  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', target_date: '2026-12-01' }), TODAY),
    'upcoming'
  );
  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', target_date: '2026-10-10' }), TODAY),
    'due_soon'
  );
  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', target_date: TODAY }), TODAY),
    'due_soon',
    'Vencer hoy cuenta como por vencer'
  );
  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', target_date: '2026-10-01' }), TODAY),
    'overdue'
  );
  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', target_date: '2026-10-06' }), TODAY),
    'due_soon'
  );
  // Completada gana siempre sobre la fecha.
  assert.strictEqual(
    classifyGoalDeadline(goal({ id: 'g', status: 'completed', target_date: '2026-01-01' }), TODAY),
    'completed'
  );
  // Sin fecha o fecha ilegible → honestamente "sin fecha".
  assert.strictEqual(classifyGoalDeadline(goal({ id: 'g' }), TODAY), 'no_deadline');
  assert.strictEqual(classifyGoalDeadline(goal({ id: 'g', target_date: 'ayer' }), TODAY), 'no_deadline');
});

test('goals: diffDays calcula días entre fechas', () => {
  assert.strictEqual(diffDays('2026-10-06', '2026-10-09'), 3);
  assert.strictEqual(diffDays('2026-10-06', '2026-10-06'), 0);
  assert.strictEqual(diffDays('2026-10-06', '2026-10-01'), -5);
  assert.strictEqual(Number.isNaN(diffDays('basura', '2026-10-01')), true);
});

/* -------------------------------- resumen -------------------------------- */

test('goals: resumen determinista con metas vencidas, por vencer y listas', () => {
  const goals: LearningGoal[] = [
    goal({ id: 'g1', kind: 'course', resource_id: 'c1', target_date: '2026-10-01' }), // overdue
    goal({ id: 'g2', kind: 'custom', target_date: '2026-10-08' }),                    // due soon
    goal({ id: 'g3', kind: 'custom' }),                                                // sin fecha
    goal({ id: 'g4', status: 'completed', completed_at: '2026-09-01' })               // completada
  ];

  const courses = new Map([['c1', { title: 'Curso', total_lessons: 4, completed_lessons: 4 }]]);
  const ctx = context({ courses });

  const summary = summarizeGoals(goals, (g) => computeGoalProgress(g, ctx), TODAY);
  assert.strictEqual(summary.total, 4);
  assert.strictEqual(summary.active, 3);
  assert.strictEqual(summary.completed, 1);
  assert.strictEqual(summary.overdue, 1);
  assert.strictEqual(summary.dueSoon, 1);
  assert.strictEqual(summary.readyToComplete, 1, 'La meta de curso al 100 % está lista para cerrar');
});

test('goals: contexto construido desde filas de cursos y libros reales', () => {
  const courses = buildGoalContextCourses([
    { id: 'c1', title: 'A', category: 'X', status: 'IN_PROGRESS', type: 'course', total_lessons: 5, completed_lessons: 2 }
  ]);
  assert.deepStrictEqual(courses.get('c1'), {
    title: 'A',
    total_lessons: 5,
    completed_lessons: 2
  });

  const books = buildGoalContextBooks([
    { id: 'b1', title: 'B', category: 'X', status: 'NOT_STARTED', type: 'book', reading_percentage: 0, page_count: 100, current_page: 10 }
  ]);
  assert.strictEqual(books.get('b1')?.page_count, 100);
  assert.strictEqual(books.get('b1')?.current_page, 10);
});

test('goals: usuario sin metas → resumen en ceros', () => {
  const summary = summarizeGoals([], () => computeGoalProgress(goal({ id: 'x' }), context()), TODAY);
  assert.deepStrictEqual(summary, {
    total: 0,
    active: 0,
    completed: 0,
    overdue: 0,
    dueSoon: 0,
    readyToComplete: 0
  });
});
