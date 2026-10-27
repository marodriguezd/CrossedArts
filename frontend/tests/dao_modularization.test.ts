/**
 * Frontera interna del DAO: la fachada compone módulos de dominio y no duplica
 * SQL ni definiciones de lectura de filas.
 */
import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

import { dao } from '../src/db/dao.ts';
import { sessionDao } from '../src/db/dao/sessions.ts';
import { noteDao } from '../src/db/dao/notes.ts';
import { practiceWorkDao } from '../src/db/dao/practiceWork.ts';
import { goalDao } from '../src/db/dao/goals.ts';
import { SESSION_SELECT, SESSION_LIVE_DURATION_SQL } from '../src/db/dao/sessionQueries.ts';
import { PRACTICE_WORK_ORDER_SQL, PRACTICE_WORK_COLUMNS } from '../src/db/dao/practiceWorkQueries.ts';
import {
  mapBookRow,
  mapCourseRow,
  mapFlashcardRow,
  mapLearningSessionRow,
  mapPracticeWorkRow,
  mapResourceFragmentRow
} from '../src/db/dao/sqlRows.ts';

const read = (relative: string) => readFileSync(new URL(relative, import.meta.url), 'utf8');

test('dao: la fachada expone la API pública sin cambiar su nombre', () => {
  for (const method of [
    'getKPIs', 'startStudySession', 'finalizeStudySession', 'getRecentStudySessions',
    'getNotes', 'addNote', 'getAllPracticeWork', 'addPracticeWork',
    'getGoals', 'createGoal', 'getCourses', 'createLesson', 'getKnowledgeGraph',
    'searchKnowledge', 'getAllLearningResources', 'importCoursePackage'
  ]) {
    assert.strictEqual(typeof (dao as any)[method], 'function', `dao.${method} debe existir`);
  }
});

test('dao: los módulos de dominio están compuestos en la fachada', () => {
  for (const [name, module] of Object.entries({
    sessionDao, noteDao, practiceWorkDao, goalDao
  } as Record<string, object>)) {
    for (const method of Object.keys(module)) {
      assert.strictEqual(
        typeof (dao as any)[method],
        'function',
        `${name}.${method} debe formar parte de la fachada dao`
      );
    }
  }
});

test('dao: cada método tiene una única implementación (sin duplicados)', () => {
  const owners = new Map<string, string[]>();
  for (const [name, module] of Object.entries({ sessionDao, noteDao, practiceWorkDao, goalDao } as Record<string, object>)) {
    for (const method of Object.keys(module)) {
      owners.set(method, [...(owners.get(method) || []), name]);
    }
  }
  const duplicated = [...owners.entries()].filter(([, mods]) => mods.length > 1);
  assert.deepStrictEqual(duplicated, [], 'Ningún método se implementa en dos módulos');
});

test('dao: el SQL de sesión y de trabajo práctico vive en un solo archivo', () => {
  const daoSource = read('../src/db/dao.ts');
  assert.ok(!daoSource.includes('SELECT s.id, s.resource_id, s.started_at'), 'La proyección de sesión no se duplica en la fachada');
  assert.ok(SESSION_SELECT.includes('s.scope'), 'La proyección de sesión incluye el ámbito explícito');
  assert.ok(SESSION_LIVE_DURATION_SQL.includes('duration_minutes = CASE'));

  const practiceModule = read('../src/db/dao/practiceWork.ts');
  assert.ok(practiceModule.includes('PRACTICE_WORK_COLUMNS'), 'El módulo de práctica usa la proyección compartida');
  assert.ok(PRACTICE_WORK_COLUMNS.startsWith('id, title, description'));
  assert.ok(PRACTICE_WORK_ORDER_SQL.startsWith('ORDER BY CASE status'));
});

test('dao: el mapeo de filas es único y compartido', () => {
  // Un mismo mapeo para todos: si el DAO lo duplicara, dejaría de ser único.
  const row: unknown[] = ['ss_1', 'c1', '2026-01-01 10:00', '2026-01-01 10:30', 30, 0, 'flashcards', 2, 1, 1, 'completed', 'Curso', 'l1', 'Lección', 'lesson'];
  const mapped = mapLearningSessionRow(row);
  assert.strictEqual(mapped.id, 'ss_1');
  assert.strictEqual(mapped.scope, 'lesson');
  assert.strictEqual(mapped.lesson_id, 'l1');
  assert.strictEqual(mapped.resource_title, 'Curso');

  const pwRow: unknown[] = ['pw1', 'Trabajo', 'Desc', 'c1', null, null, 'project', 'PLANNED', null, null, null, null, '2026-01-01', '2026-01-02', null, null];
  const pw = mapPracticeWorkRow(pwRow);
  assert.strictEqual(pw.id, 'pw1');
  assert.strictEqual(pw.kind, 'project');

  // La parte que el nombre promete: NINGÚN módulo de dominio proyecta filas a
  // mano. Cada lectura pasa por el mapper compartido de sqlRows, así que una
  // misma fila no puede leerse de dos formas distintas.
  for (const [file, mapper] of [
    ['../src/db/dao/sessions.ts', 'mapLearningSessionRow'],
    ['../src/db/dao/notes.ts', 'mapNoteRow'],
    ['../src/db/dao/practiceWork.ts', 'mapPracticeWorkRow'],
    ['../src/db/dao/goals.ts', 'SqlRow']
  ] as const) {
    const source = read(file);
    assert.ok(source.includes(mapper), `${file} debe leer filas con ${mapper}`);
    assert.ok(!source.includes('(r: any[])'), `${file} no puede proyectar filas sin tipos`);
  }

  // Las cuatro lecturas de notas (por recurso, por lección, listado y por id)
  // comparten UN mapper: tres como referencia de `.map(...)` y una invocada
  // directamente para la lectura por id.
  const notesSource = read('../src/db/dao/notes.ts');
  const listCalls = (notesSource.match(/values\.map\(mapNoteRow\)/g) || []).length;
  assert.strictEqual(listCalls, 3, 'las tres lecturas por lista pasan por mapNoteRow');
  assert.ok(
    notesSource.includes('mapNoteRow(res[0].values[0])'),
    'la lectura por id pasa por el mismo mapper'
  );
  assert.ok(!notesSource.includes('(r: any[])'), 'notes.ts no proyecta filas a mano');
});

test('dao: tarjetas, cursos, libros y fragmentos se leen con el mapper canónico', () => {
  // Los cuatro mappers comparten la semántica de `SqlRow`. Sus proyecciones
  // declaran el orden de columnas que el DAO selecciona.
  const card = mapFlashcardRow(['fc1', null, 'Frente', 'Reverso', 0, 1, 2.5, '2026-01-01', null, null, null, null]);
  assert.strictEqual(card.resource_id, undefined);
  assert.strictEqual(card.lesson_id, undefined);
  assert.strictEqual(card.card_type, 'standard');
  assert.strictEqual(card.extra_data, undefined);

  const course = mapCourseRow(['c1', 'Curso', null, null, null, null, null, 'course', null, null, null, null, null]);
  assert.strictEqual(course.category, 'General');
  assert.strictEqual(course.status, 'NOT_STARTED');
  assert.strictEqual(course.difficulty, 'BEGINNER');
  assert.strictEqual(course.total_lessons, undefined);

  const book = mapBookRow(['b1', 'Libro', null, null, null, null, null, 'book', null, null, null, null, null]);
  assert.strictEqual(book.page_count, undefined);
  assert.strictEqual(book.current_page, undefined);
  assert.strictEqual(book.reading_percentage, 0);

  const fragment = mapResourceFragmentRow(['n1', 'Nota', 'Texto', null, null]);
  assert.strictEqual(fragment.tags, undefined);
  assert.strictEqual(fragment.created_at, undefined);

  // Y el DAO no proyecta ninguna de esas cuatro entidades a mano: si volviera
  // la proyección artesanal, habría dos lecturas posibles de la misma fila.
  const daoSource = read('../src/db/dao.ts');
  assert.strictEqual((daoSource.match(/values\.map\(mapFlashcardRow\)/g) || []).length, 3);
  assert.strictEqual((daoSource.match(/values\.map\(mapCourseRow\)/g) || []).length, 1);
  assert.ok(daoSource.includes('mapCourseRow(res[0].values[0])'), 'la lectura por id usa el mismo mapper de curso');
  assert.strictEqual((daoSource.match(/values\.map\(mapBookRow\)/g) || []).length, 1);
  assert.ok(daoSource.includes('mapBookRow(res[0].values[0])'), 'la lectura por id usa el mismo mapper de libro');
  assert.ok(daoSource.includes('values.map(mapResourceFragmentRow)'));
  // Las proyecciones artesanales de esas cuatro entidades (el resto del DAO
  // proyecta índices y meta del grafo, que no son filas de entidad).
  for (const leftover of ['ease_factor: Number(', 'difficulty: row[9]', 'author: row[8]', 'page_count: Number(row[10])']) {
    assert.ok(!daoSource.includes(leftover), `la proyección artesanal \`${leftover}\` no sobrevive`);
  }
});

test('dao: la fachada no expone escrituras que no persisten', () => {
  // `recalculateCourseTotals` escribe sin persistir (sus llamadores internos
  // persisten después), así que no puede vivir en la fachada pública: ahí
  // sería un método que incumple el contrato §2 de `AGENTS.md`.
  assert.strictEqual(
    (dao as any).recalculateCourseTotals,
    undefined,
    'recalculateCourseTotals no puede estar en la fachada: escribe sin persistir'
  );
});
