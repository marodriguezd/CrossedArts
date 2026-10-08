/**
 * Contrato único de ámbito de sesión de estudio (tres ámbitos canónicos).
 *
 * Regla: `lesson` (lección), `resource` (curso o libro) y `global` (repaso
 * transversal). El ámbito se deriva de las anclas y se persiste de forma
 * explícita; nunca se deduce de la ausencia de datos.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  resolveStudySessionScope,
  resolveEffectiveStudySessionScope,
  validateStudySessionScope,
  describeStudySessionScope,
  studySessionScopeLabel,
  isGlobalStudySessionScope,
  STUDY_SESSION_SCOPES
} from '../src/services/sessionScope.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

async function removeSession(id: string): Promise<void> {
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_session WHERE id = ?', [id]);
  await dbBridge.persist();
}

test('ámbito: derivación determinista desde las anclas', () => {
  assert.strictEqual(resolveStudySessionScope({ lessonId: 'l1', resourceId: 'c1' }), 'lesson');
  assert.strictEqual(resolveStudySessionScope({ resourceId: 'c1' }), 'resource');
  assert.strictEqual(resolveStudySessionScope({}), 'global');
  assert.strictEqual(resolveStudySessionScope({ lessonId: null, resourceId: null }), 'global');
  assert.deepStrictEqual([...STUDY_SESSION_SCOPES], ['global', 'resource', 'lesson']);
});

test('ámbito: coherencia validada por reglas', () => {
  assert.strictEqual(validateStudySessionScope('lesson', { lessonId: 'l1' }).ok, true);
  assert.strictEqual(validateStudySessionScope('lesson', { lessonId: 'l1', resourceId: 'c1' }).ok, true);
  assert.strictEqual(validateStudySessionScope('lesson', { resourceId: 'c1' }).ok, false);

  assert.strictEqual(validateStudySessionScope('resource', { resourceId: 'c1' }).ok, true);
  assert.strictEqual(validateStudySessionScope('resource', { resourceId: 'c1', lessonId: 'l1' }).ok, false);
  assert.strictEqual(validateStudySessionScope('resource', {}).ok, false);

  assert.strictEqual(validateStudySessionScope('global', {}).ok, true);
  assert.strictEqual(validateStudySessionScope('global', { resourceId: 'c1' }).ok, false);
});

test('ámbito: reclasificación honesta cuando el ancla desaparece', () => {
  // Sesión de lección cuyo material se borró: el historial se conserva, pero ya
  // no se puede presentar como "Lección".
  assert.strictEqual(resolveEffectiveStudySessionScope('lesson', { resourceId: 'c1', lessonId: null }), 'resource');
  assert.strictEqual(resolveEffectiveStudySessionScope('resource', { resourceId: 'c1' }), 'resource');
  assert.strictEqual(resolveEffectiveStudySessionScope('global', {}), 'global');
  assert.strictEqual(resolveEffectiveStudySessionScope(undefined, { lessonId: 'l1' }), 'lesson');
  assert.strictEqual(resolveEffectiveStudySessionScope('resource', {}), 'global');
});

test('ámbito: etiquetas y descripciones honestas en español', () => {
  assert.strictEqual(studySessionScopeLabel('lesson'), 'Lección');
  assert.strictEqual(studySessionScopeLabel('resource'), 'Recurso');
  assert.strictEqual(studySessionScopeLabel('global'), 'Repaso general');
  assert.strictEqual(isGlobalStudySessionScope('global'), true);

  assert.strictEqual(
    describeStudySessionScope({ scope: 'lesson', resourceTitle: 'Curso', lessonTitle: 'Lección 1' }),
    'Curso › Lección 1'
  );
  assert.strictEqual(
    describeStudySessionScope({ scope: 'lesson', lessonTitle: 'Lección 1' }),
    'Lección 1',
    'Sin curso resuelto no se inventa ninguno'
  );
  assert.strictEqual(describeStudySessionScope({ scope: 'resource' }), 'Recurso');
  assert.strictEqual(describeStudySessionScope({ scope: 'global', resourceTitle: 'Curso' }), 'Repaso general');
});

test('ámbito: las tres sesiones se persisten con su ámbito explícito', async () => {
  await dbBridge.init();
  const course = await dao.createCourse({ title: 'Curso Ámbito Canónico', category: 'Test' });
  const courseId = course.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Ámbito Canónico' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Ámbito Canónico' });

  const lessonSession = await dao.startStudySession({ mode: 'mixed', resourceId: courseId, lessonId: lesson.id });
  const resourceSession = await dao.startStudySession({ mode: 'flashcards', resourceId: courseId });
  const globalSession = await dao.startStudySession({ mode: 'flashcards' });

  try {
    assert.strictEqual((await dao.getStudySessionById(lessonSession))!.scope, 'lesson');
    assert.strictEqual((await dao.getStudySessionById(resourceSession))!.scope, 'resource');
    assert.strictEqual((await dao.getStudySessionById(globalSession))!.scope, 'global');

    // Las tres son historial de aprendizaje y las tres aparecen.
    for (const sid of [lessonSession, resourceSession, globalSession]) {
      await dao.recordStudyFlashcardReview(sid);
      assert.equal(await dao.finalizeStudySession(sid), 'completed');
    }
    const recent = await dao.getRecentStudySessions(50);
    for (const sid of [lessonSession, resourceSession, globalSession]) {
      assert.ok(recent.some(s => s.id === sid), 'Toda sesión completada aparece, incluido el repaso global');
    }
    const globalRow = recent.find(s => s.id === globalSession)!;
    assert.strictEqual(globalRow.scope, 'global');
    assert.strictEqual(globalRow.resource_id, undefined, 'El repaso global no inventa un recurso');
    assert.strictEqual(globalRow.lesson_id, undefined);
  } finally {
    await removeSession(lessonSession);
    await removeSession(resourceSession);
    await removeSession(globalSession);
    await dao.deleteLesson(lesson.id!);
    await dao.deleteModule(mod.id!);
    await dao.deleteCourse(courseId);
  }
});

test('ámbito: un ámbito declarado incoherente es un error de dominio', async () => {
  await dbBridge.init();
  await assert.rejects(
    () => dao.startStudySession({ mode: 'flashcards', resourceId: 'c1', scope: 'global' }),
    /no puede tener recurso ni lección/,
    'Un ámbito global con recurso es un error, no una fila reinterpretada'
  );
  await assert.rejects(
    () => dao.startStudySession({ mode: 'flashcards', resourceId: 'c1', lessonId: 'l1', scope: 'resource' }),
    /no puede tener lección/,
    'Un ámbito de recurso con lección es un error'
  );
});

test('ámbito: la base rechaza un ámbito global con ancla', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  assert.throws(
    () => db.run(
      `INSERT INTO learning_session (id, resource_id, lesson_id, scope, started_at, mode, status)
       VALUES ('ss-scope-invalido', 'c1-react', NULL, 'global', datetime('now'), 'flashcards', 'completed')`
    ),
    /CHECK constraint failed/
  );
  assert.throws(
    () => db.run(
      `INSERT INTO learning_session (id, resource_id, lesson_id, scope, started_at, mode, status)
       VALUES ('ss-scope-desconocido', 'c1-react', NULL, 'otro', datetime('now'), 'flashcards', 'completed')`
    ),
    /CHECK constraint failed/
  );
});

test('ámbito: registrar material nuevo conserva el historial', async () => {
  await dbBridge.init();
  const course = await dao.createCourse({ title: 'Curso Ámbito Historial', category: 'Test' });
  const courseId = course.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Historial Ámbito' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Historial Ámbito' });

  const sid = await dao.startStudySession({ mode: 'mixed', resourceId: courseId, lessonId: lesson.id });
  await dao.recordStudyFlashcardReview(sid);
  assert.equal(await dao.finalizeStudySession(sid), 'completed');

  await dao.deleteLesson(lesson.id!);

  const row = await dao.getStudySessionById(sid);
  assert.ok(row, 'La sesión se conserva tras borrar la lección');
  assert.equal(row!.status, 'completed');
  assert.equal(row!.lesson_id, undefined, 'La lección deja de estar enlazada');
  assert.strictEqual(
    row!.scope,
    'resource',
    'El ámbito efectivo se reclasifica: ya no existe la lección de origen'
  );

  await removeSession(sid);
  await dao.deleteModule(mod.id!);
  await dao.deleteCourse(courseId);
});

test('ámbito: el aprendizaje global cuenta para analítica y racha', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  const before = await dao.getActiveStreak();

  const sid = await dao.startStudySession({ mode: 'flashcards' });
  await dao.recordStudyFlashcardReview(sid);
  assert.equal(await dao.finalizeStudySession(sid), 'completed');

  const today = await dao.getTodayStudySummary();
  assert.ok(today.flashcards_reviewed >= 1, 'El repaso global es actividad de estudio real');
  const row = db.exec("SELECT scope FROM learning_session WHERE id = ?", [sid]);
  assert.strictEqual(row[0].values[0][0], 'global');

  await removeSession(sid);
  const after = await dao.getActiveStreak();
  assert.ok(after >= before, 'La racha nunca disminuye al registrar actividad global');
});
test('ámbito: un respaldo JSON heredado sin `scope` se restaura con su ámbito derivado', async () => {
  await dbBridge.init();
  const course = await dao.createCourse({ title: 'Curso Respaldo Legado', category: 'Test' });
  const courseId = course.id!;

  // Respaldo creado por una versión anterior: la fila de sesión NO trae `scope`.
  const legacyBackup: Record<string, any[]> = {
    learning_session: [{
      id: 'ss-legacy-backup',
      resource_id: courseId,
      lesson_id: null,
      started_at: '2026-01-01 10:00',
      ended_at: '2026-01-01 10:30',
      duration_minutes: 30,
      inactive_seconds: 0,
      mode: 'flashcards',
      cards_reviewed: 3,
      questions_answered: 0,
      correct_answers: 0,
      status: 'completed'
    }]
  };

  const { importJsonBackup } = await import('../src/db/exportImport.ts');
  await importJsonBackup(legacyBackup);

  const restored = await dao.getStudySessionById('ss-legacy-backup');
  assert.ok(restored, 'El respaldo heredado se restaura sin perder la sesión');
  assert.strictEqual(restored!.duration_minutes, 30, 'La actividad del usuario se conserva');
  assert.strictEqual(
    restored!.scope,
    'resource',
    'El ámbito se deriva de las anclas: el valor por defecto global no se impone'
  );

  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_session WHERE id = ?', ['ss-legacy-backup']);
  await dao.deleteCourse(courseId);
});
