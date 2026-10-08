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
import { mapLearningSessionRow, mapPracticeWorkRow } from '../src/db/dao/sqlRows.ts';

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
});
