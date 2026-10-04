import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { initialStudySessionState, studySessionReducer } from '../src/services/studySession.ts';
import {
  buildMixedStudyPlan,
  summarizeStudySession,
  formatNextReviewInterval,
  resolveShortcutOptionIndex
} from '../src/services/domainLogic.ts';
import { aiService } from '../src/ai/aiService.ts';

async function removeSession(id: string): Promise<void> {
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_session WHERE id = ?', [id]);
  await dbBridge.persist();
}

test('13.1 Study session lifecycle reducer transitions deterministically and rejects invalid moves', () => {
  let s = initialStudySessionState;
  assert.equal(s.phase, 'idle');

  s = studySessionReducer(s, { type: 'START_REQUESTED', mode: 'mixed', resourceId: 'c1-react' });
  assert.equal(s.phase, 'starting');
  assert.equal(s.mode, 'mixed');

  s = studySessionReducer(s, { type: 'STARTED', sessionId: 'ss-x', startedAt: 1000 });
  assert.equal(s.phase, 'active');
  assert.equal(s.persisted, true);
  assert.equal(s.sessionId, 'ss-x');

  s = studySessionReducer(s, { type: 'PAUSE' });
  assert.equal(s.phase, 'paused');
  s = studySessionReducer(s, { type: 'RESUME' });
  assert.equal(s.phase, 'active');

  s = studySessionReducer(s, { type: 'COMPLETED' });
  assert.equal(s.phase, 'completed');
  // Movimiento inválido ignorado tras finalizar
  assert.equal(studySessionReducer(s, { type: 'PAUSE' }).phase, 'completed');

  // Fallo de inicio -> failed
  const startReq = studySessionReducer(initialStudySessionState, { type: 'START_REQUESTED', mode: 'flashcards' });
  const failed = studySessionReducer(startReq, { type: 'START_FAILED', error: 'storage' });
  assert.equal(failed.phase, 'failed');
  assert.equal(failed.persisted, false);

  // Fallo al finalizar -> permanece active (nunca se reporta completada)
  const reset = studySessionReducer(failed, { type: 'RESET' });
  const req2 = studySessionReducer(reset, { type: 'START_REQUESTED', mode: 'flashcards' });
  const active2 = studySessionReducer(req2, { type: 'STARTED', sessionId: 'ss-y', startedAt: 1 });
  const finalizeFail = studySessionReducer(active2, { type: 'FINALIZE_FAILED', error: 'boom' });
  assert.equal(finalizeFail.phase, 'active');
  assert.equal(finalizeFail.error, 'boom');
});

test('13.2 startStudySession persists an active record that can be resumed', async () => {
  await dbBridge.init();
  const id = await dao.startStudySession({ mode: 'flashcards', resourceId: 'c1-react' });

  const active = await dao.getActiveStudySession();
  assert.ok(active, 'Debe existir una sesión activa tras iniciarla');
  assert.equal(active!.id, id);
  assert.equal(active!.mode, 'flashcards');
  assert.equal(active!.status, 'active');
  assert.equal(active!.cards_reviewed, 0);

  await dao.cancelStudySession(id);
  const finished = await dao.getStudySessionById(id);
  assert.equal(finished!.status, 'cancelled');
  await removeSession(id);
});

test('13.3 Flashcard review persists SM-2 results and the session counter increments once per review', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  const cardId = 'test-ss-card-1';
  db.run(
    `INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
     VALUES (?, 'c1-react', 'Pregunta sesión', 'Respuesta sesión', 0, 1, 2.5, datetime('now', '-1 day'))`,
    [cardId]
  );

  const sid = await dao.startStudySession({ mode: 'flashcards' });

  const first = await dao.reviewFlashcardSM2(cardId, 4);
  assert.ok(first, 'Debe devolver el resultado SM-2 calculado');
  assert.equal(first!.repetitionCount, 1);
  assert.equal(first!.intervalDays, 1);
  await dao.recordStudyFlashcardReview(sid);

  let row = await dao.getStudySessionById(sid);
  assert.equal(row!.cards_reviewed, 1, 'El contador debe incrementar exactamente una vez');

  const second = await dao.reviewFlashcardSM2(cardId, 5);
  assert.equal(second!.repetitionCount, 2);
  assert.equal(second!.intervalDays, 6);
  await dao.recordStudyFlashcardReview(sid);

  row = await dao.getStudySessionById(sid);
  assert.equal(row!.cards_reviewed, 2);
  assert.ok(row!.duration_minutes >= 1, 'Una sesión con actividad debe registrar al menos 1 minuto');
  assert.ok(row!.questions_answered === 0);

  await dao.cancelStudySession(sid);
  db.run('DELETE FROM flashcard WHERE id = ?', [cardId]);
  await removeSession(sid);
});

test('13.4 Practice question counters track correct and incorrect answers independently', async () => {
  await dbBridge.init();
  const sid = await dao.startStudySession({ mode: 'practice' });
  await dao.recordStudyQuestionAnswer(sid, true);
  await dao.recordStudyQuestionAnswer(sid, true);
  await dao.recordStudyQuestionAnswer(sid, false);

  const row = await dao.getStudySessionById(sid);
  assert.equal(row!.questions_answered, 3);
  assert.equal(row!.correct_answers, 2);
  assert.equal(row!.cards_reviewed, 0);

  await dao.cancelStudySession(sid);
  await removeSession(sid);
});

test('13.5 Completion sets status, duration and aggregates into today summary and recent sessions', async () => {
  await dbBridge.init();
  const sid = await dao.startStudySession({ mode: 'mixed', resourceId: 'c1-react' });
  await dao.recordStudyFlashcardReview(sid);
  await dao.recordStudyQuestionAnswer(sid, true);

  const status = await dao.finalizeStudySession(sid);
  assert.equal(status, 'completed');

  const row = await dao.getStudySessionById(sid);
  assert.equal(row!.status, 'completed');
  assert.ok(row!.ended_at, 'Debe registrar ended_at');
  assert.ok(row!.duration_minutes >= 1);
  assert.equal(row!.resource_title, 'React 18 & TypeScript Masterclass');

  const summary = summarizeStudySession({
    cards_reviewed: row!.cards_reviewed,
    questions_answered: row!.questions_answered,
    correct_answers: row!.correct_answers,
    duration_minutes: row!.duration_minutes
  });
  assert.equal(summary.itemsReviewed, 2);
  assert.equal(summary.flashcards, 1);
  assert.equal(summary.questions, 1);
  assert.equal(summary.correct, 1);
  assert.equal(summary.incorrect, 0);

  const today = await dao.getTodayStudySummary();
  assert.ok(today.items_reviewed >= 2);
  assert.ok(today.flashcards_reviewed >= 1);
  assert.ok(today.questions_answered >= 1);

  const recent = await dao.getRecentStudySessions(20);
  assert.ok(recent.some(s => s.id === sid));

  await removeSession(sid);
});

test('13.6 Cancellation keeps already persisted reviews and marks the session as cancelled', async () => {
  await dbBridge.init();
  const sid = await dao.startStudySession({ mode: 'flashcards' });
  await dao.recordStudyFlashcardReview(sid);
  await dao.cancelStudySession(sid);

  const row = await dao.getStudySessionById(sid);
  assert.equal(row!.status, 'cancelled');
  assert.equal(row!.cards_reviewed, 1, 'Los repasos ya persistidos se conservan');
  assert.ok(row!.duration_minutes >= 1);

  const active = await dao.getActiveStudySession();
  assert.ok(!active || active.id !== sid, 'Una sesión cancelada no debe poder reanudarse');
  await removeSession(sid);
});

test('13.7 Persistence failure never reports completion and keeps the session active', async () => {
  await dbBridge.init();
  const sid = await dao.startStudySession({ mode: 'flashcards' });
  await dao.recordStudyFlashcardReview(sid);

  const originalPersist = dbBridge.persist;
  dbBridge.persist = async () => {
    throw new Error('storage unavailable');
  };

  try {
    await assert.rejects(() => dao.finalizeStudySession(sid), /storage unavailable/);
  } finally {
    dbBridge.persist = originalPersist;
  }

  const row = await dao.getStudySessionById(sid);
  assert.equal(row!.status, 'active', 'La sesión debe seguir activa si la persistencia falló');
  assert.equal(row!.ended_at, undefined, 'No debe quedar un ended_at de una finalización no persistida');

  const status = await dao.finalizeStudySession(sid);
  assert.equal(status, 'completed');
  await removeSession(sid);
});

test('13.8 Zero-activity sessions create no study history and do not inflate the streak', async () => {
  await dbBridge.init();
  const before = await dao.getActiveStreak();

  const sid = await dao.startStudySession({ mode: 'practice' });
  const status = await dao.finalizeStudySession(sid);
  assert.equal(status, 'cancelled', 'Una sesión sin actividad no puede marcarse como completada');

  const row = await dao.getStudySessionById(sid);
  assert.equal(row!.duration_minutes, 0);
  assert.equal(row!.status, 'cancelled');

  const recent = await dao.getRecentStudySessions(50);
  assert.ok(!recent.some(s => s.id === sid), 'No debe aparecer en el historial de sesiones completadas');

  const after = await dao.getActiveStreak();
  assert.equal(after, before, 'La racha no debe cambiar sin actividad de estudio');
  await removeSession(sid);
});

test('13.9 Future-dated sessions do not count toward the streak', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  const before = await dao.getActiveStreak();

  db.run(`INSERT INTO learning_session (id, resource_id, started_at, duration_minutes, mode, status)
          VALUES ('test-future-ss', 'c1-react', datetime('now', '+2 days'), 30, 'flashcards', 'completed')`);

  const after = await dao.getActiveStreak();
  assert.equal(after, before, 'Los registros con fecha futura no deben extender la racha');

  db.run("DELETE FROM learning_session WHERE id = 'test-future-ss'");
});

test('13.10 Mixed study plan is deterministic (flashcards first, then practice)', () => {
  assert.deepEqual(buildMixedStudyPlan(2, 3), ['flashcard', 'flashcard', 'practice', 'practice', 'practice']);
  assert.deepEqual(buildMixedStudyPlan(0, 2), ['practice', 'practice']);
  assert.deepEqual(buildMixedStudyPlan(2, 0), ['flashcard', 'flashcard']);
  assert.deepEqual(buildMixedStudyPlan(-3, 1), ['practice']);
  assert.deepEqual(buildMixedStudyPlan(2, 3), buildMixedStudyPlan(2, 3));
});

test('13.11 SM-2 next review formatting uses the actual calculated interval', () => {
  assert.equal(formatNextReviewInterval(1), '1 día');
  assert.equal(formatNextReviewInterval(6), '6 días');
  assert.equal(formatNextReviewInterval(45), '2 meses');
  assert.equal(formatNextReviewInterval(0), '1 día');
});

test('13.12 Practice questions remain ephemeral and never create permanent storage', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const flashBefore = db.exec('SELECT COUNT(*) FROM flashcard')[0].values[0][0] as number;

  aiService.saveSettings({
    provider: 'demo',
    ollamaUrl: '',
    ollamaModel: '',
    apiKey: '',
    apiModel: '',
    localModelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    localAiEnabled: false
  });

  const res = await aiService.generatePracticeQuestions({ count: 3, difficulty: 'medium', topic: 'React' });
  assert.equal(res.error, undefined, `No debe fallar en modo demo: ${res.error}`);
  assert.ok(res.questions.length >= 1);

  const questionTables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%question%'");
  assert.equal(questionTables.length, 0, 'No debe existir una tabla de preguntas persistentes');

  const flashAfter = db.exec('SELECT COUNT(*) FROM flashcard')[0].values[0][0] as number;
  assert.equal(flashAfter, flashBefore, 'Generar preguntas de práctica no debe persistir filas');
});

test('13.14 Migration upgrades a legacy learning_session schema without losing history', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(`CREATE TABLE learning_resource (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, cover_path TEXT, category TEXT DEFAULT 'General',
    status TEXT DEFAULT 'NOT_STARTED', source_path TEXT, type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP);`);
  legacy.run(`CREATE TABLE learning_session (
    id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES learning_resource(id) ON DELETE CASCADE,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP, ended_at DATETIME, duration_minutes INTEGER DEFAULT 0,
    inactive_seconds INTEGER DEFAULT 0);`);
  legacy.run("INSERT INTO learning_resource (id, title, type) VALUES ('r1', 'Recurso Legado', 'course')");
  legacy.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('legacy-1', 'r1', datetime('now', '-1 day'), 42)");
  const legacyBytes = legacy.export();
  legacy.close();

  try {
    await dbBridge.importDatabase(legacyBytes);
    const db = dbBridge.getDatabase();
    const cols = db.exec('PRAGMA table_info(learning_session)')[0].values.map(r => String(r[1]));
    for (const col of ['mode', 'cards_reviewed', 'questions_answered', 'correct_answers', 'status']) {
      assert.ok(cols.includes(col), `La migración debe añadir la columna ${col}`);
    }
    const row = db.exec("SELECT duration_minutes, mode, status FROM learning_session WHERE id = 'legacy-1'");
    assert.equal(row[0].values[0][0], 42, 'La duración histórica debe conservarse');
    assert.equal(row[0].values[0][1], 'flashcards');
    assert.equal(row[0].values[0][2], 'completed');
  } finally {
    await dbBridge.importDatabase(originalBytes);
  }
});

test('13.13 Study session operations in local mode make zero network requests', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw new Error('VIOLATION: acceso de red no permitido en la sesión de estudio');
  };

  try {
    const sid = await dao.startStudySession({ mode: 'mixed' });
    await dao.recordStudyFlashcardReview(sid);
    await dao.recordStudyQuestionAnswer(sid, true);
    await dao.getTodayStudySummary();
    await dao.getRecentStudySessions(5);
    await dao.getDueFlashcards();
    await dao.finalizeStudySession(sid);
    assert.equal(networkCalls, 0, 'La sesión de estudio local no debe realizar peticiones de red');
    await removeSession(sid);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('13.15 Study history preserves the lesson scope and exposes it to the Dashboard', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const created = await dao.createCourse({ title: 'Curso Ámbito 13', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Ámbito' });
  const lessonA = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Ámbito A' });
  const lessonB = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Ámbito B' });

  // Sesión con ámbito de lección A (con actividad real -> completed).
  const sidA = await dao.startStudySession({ mode: 'flashcards', resourceId: courseId, lessonId: lessonA.id });
  await dao.recordStudyFlashcardReview(sidA);
  assert.equal(await dao.finalizeStudySession(sidA), 'completed');

  // Sesión con ámbito de lección B.
  const sidB = await dao.startStudySession({ mode: 'mixed', resourceId: courseId, lessonId: lessonB.id });
  await dao.recordStudyQuestionAnswer(sidB, true);
  assert.equal(await dao.finalizeStudySession(sidB), 'completed');

  // Sesión a nivel de curso (sin lección): el historial NO debe inventar un ámbito.
  const sidC = await dao.startStudySession({ mode: 'flashcards', resourceId: courseId });
  await dao.recordStudyFlashcardReview(sidC);
  assert.equal(await dao.finalizeStudySession(sidC), 'completed');

  const recent = await dao.getRecentStudySessions(20);
  const byId = (id: string) => recent.find(s => s.id === id);

  const sessA = byId(sidA);
  assert.ok(sessA, 'La sesión de la lección A debe aparecer en el historial reciente');
  assert.equal(sessA!.lesson_id, lessonA.id, 'El historial conserva el ámbito de lección');
  assert.equal(sessA!.lesson_title, 'Lección Ámbito A', 'El Dashboard puede mostrar el título de la lección');
  assert.equal(sessA!.resource_title, 'Curso Ámbito 13');

  const sessB = byId(sidB);
  assert.ok(sessB);
  assert.equal(sessB!.lesson_id, lessonB.id, 'Cada sesión mantiene SU lección, sin mezclar ámbitos');
  assert.equal(sessB!.lesson_title, 'Lección Ámbito B');

  const sessC = byId(sidC);
  assert.ok(sessC, 'La sesión de curso también entra en el historial');
  assert.equal(sessC!.lesson_id, undefined, 'Una sesión de curso no debe mostrar lección inventada');
  assert.equal(sessC!.lesson_title, undefined);

  // Persistencia: el ámbito sobrevive a una nueva lectura desde SQLite.
  const reloaded = await dao.getStudySessionById(sidA);
  assert.equal(reloaded!.lesson_id, lessonA.id);

  await removeSession(sidA);
  await removeSession(sidB);
  await removeSession(sidC);
  db.run('DELETE FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [courseId, courseId]);
  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  await dbBridge.persist();
});

test('13.16 Study session keyboard shortcut resolution: numbers, letters and bounds', () => {
  // Pruebas para teclas numéricas (1..N)
  assert.equal(resolveShortcutOptionIndex('1', 4), 0);
  assert.equal(resolveShortcutOptionIndex('2', 4), 1);
  assert.equal(resolveShortcutOptionIndex('3', 4), 2);
  assert.equal(resolveShortcutOptionIndex('4', 4), 3);
  assert.equal(resolveShortcutOptionIndex('5', 4), null, 'Índice fuera de rango debe retornar null');
  assert.equal(resolveShortcutOptionIndex('0', 4), null, 'Índice 0 no es una opción válida (1-based)');

  // Pruebas para letras (A..D tanto mayúsculas como minúsculas)
  assert.equal(resolveShortcutOptionIndex('a', 4), 0);
  assert.equal(resolveShortcutOptionIndex('A', 4), 0);
  assert.equal(resolveShortcutOptionIndex('b', 4), 1);
  assert.equal(resolveShortcutOptionIndex('B', 4), 1);
  assert.equal(resolveShortcutOptionIndex('c', 4), 2);
  assert.equal(resolveShortcutOptionIndex('C', 4), 2);
  assert.equal(resolveShortcutOptionIndex('d', 4), 3);
  assert.equal(resolveShortcutOptionIndex('D', 4), 3);
  assert.equal(resolveShortcutOptionIndex('e', 4), null, 'Opción E fuera de límite de 4');

  // Teclas no válidas
  assert.equal(resolveShortcutOptionIndex('Enter', 4), null);
  assert.equal(resolveShortcutOptionIndex(' ', 4), null);
  assert.equal(resolveShortcutOptionIndex('', 4), null);
});

