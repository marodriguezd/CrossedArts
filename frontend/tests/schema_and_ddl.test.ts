import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import { SEED_SQL } from '../src/db/seedDemo.ts';

test('1.1 SQLite Bridge initializes without network and creates all relational tables', async () => {
  const db = await dbBridge.init();
  assert.ok(db, 'Database instance should be created and initialized');

  const tablesQuery = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  assert.ok(tablesQuery.length > 0, 'sqlite_master query should return rows');

  const tableNames = tablesQuery[0].values.map(row => row[0]);
  const expectedTables = [
    'book',
    'concept',
    'course',
    'flashcard',
    'knowledge_connection',
    'learning_resource',
    'learning_session',
    'lesson',
    'module',
    'note'
  ];

  for (const expected of expectedTables) {
    assert.ok(tableNames.includes(expected), `Missing required table: ${expected}`);
  }
});

test('1.2 Seed demo dataset populates initial resources, lessons, notes, and flashcards', async () => {
  const db = dbBridge.getDatabase();

  const countResources = db.exec("SELECT COUNT(*) FROM learning_resource")[0].values[0][0] as number;
  assert.ok(countResources >= 6, `Expected at least 6 learning resources, got ${countResources}`);

  const countCourses = db.exec("SELECT COUNT(*) FROM course")[0].values[0][0] as number;
  assert.strictEqual(countCourses, 3, 'Expected exactly 3 courses in demo seed');

  const countBooks = db.exec("SELECT COUNT(*) FROM book")[0].values[0][0] as number;
  assert.strictEqual(countBooks, 3, 'Expected exactly 3 books in demo seed');

  const countLessons = db.exec("SELECT COUNT(*) FROM lesson")[0].values[0][0] as number;
  assert.ok(countLessons >= 4, 'Expected at least 4 lessons in demo seed');

  const countFlashcards = db.exec("SELECT COUNT(*) FROM flashcard")[0].values[0][0] as number;
  assert.ok(countFlashcards >= 4, 'Expected at least 4 flashcards in demo seed');

  const countConcepts = db.exec("SELECT COUNT(*) FROM concept")[0].values[0][0] as number;
  assert.ok(countConcepts >= 6, 'Expected at least 6 concepts for knowledge graph');
});

test('1.3 PRAGMA foreign_keys stays enforced after persist, export and import', async () => {
  const db = await dbBridge.init();

  const fkEnabled = (database: any): boolean => {
    const res = database.exec('PRAGMA foreign_keys');
    return res.length > 0 && Number(res[0].values[0][0]) === 1;
  };

  // Prueba de EFECTO (no de texto): insertar una nota ligada a una lección
  // inexistente solo puede quedar rechazada si las claves foráneas están
  // realmente activas en esa conexión.
  const probeFkEnforced = (database: any): boolean => {
    try {
      database.run(
        "INSERT INTO note (id, resource_id, lesson_id, title, content, tags) VALUES ('fk-probe', NULL, 'lesson-that-does-not-exist', 'probe FK', 'probe', '')"
      );
    } catch {
      return true; // SQLite rechazó la fila huérfana por restricción.
    }
    const res = database.exec("SELECT id FROM note WHERE id = 'fk-probe'");
    const inserted = res.length > 0 && res[0].values.length > 0;
    database.run("DELETE FROM note WHERE id = 'fk-probe'");
    return !inserted;
  };

  assert.ok(fkEnabled(db), 'PRAGMA foreign_keys debe estar activo tras init');
  assert.ok(probeFkEnforced(db), 'Las FK deben impedir huérfanos tras init');

  await dbBridge.persist();
  assert.ok(fkEnabled(db), 'PRAGMA foreign_keys debe seguir activo tras persist()');
  assert.ok(probeFkEnforced(db), 'Las FK deben seguir activas tras persist()');

  // Roundtrip binario completo sin perder la restricción ni los índices.
  const bytes = dbBridge.exportDatabase();
  await dbBridge.importDatabase(bytes);
  const imported = dbBridge.getDatabase();
  assert.ok(fkEnabled(imported), 'PRAGMA foreign_keys debe reactivarse tras importDatabase');
  assert.ok(probeFkEnforced(imported), 'Las FK deben seguir activas tras el roundtrip binario');

  const indexNames = imported
    .exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_knowledge_connection%'")
    .flatMap((r: any) => r.values.map((v: any[]) => String(v[0])));
  for (const expected of ['idx_knowledge_connection_source', 'idx_knowledge_connection_target', 'idx_knowledge_connection_triple']) {
    assert.ok(indexNames.includes(expected), `El índice ${expected} debe sobrevivir al roundtrip export/import`);
  }
});

test('1.4 Deleting a lesson applies ON DELETE SET NULL to notes and sessions while preserving history', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const created = await dao.createCourse({ title: 'Curso FK Lección 1', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo FK Lección' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección FK' });

  await dao.addNote({ title: 'Nota FK lección', content: 'contenido', resource_id: courseId, lesson_id: lesson.id });
  const sid = await dao.startStudySession({ mode: 'flashcards', resourceId: courseId, lessonId: lesson.id });
  await dao.recordStudyFlashcardReview(sid);
  await dao.finalizeStudySession(sid);

  await dao.deleteLesson(lesson.id!);

  const noteRow = db.exec("SELECT lesson_id FROM note WHERE title = 'Nota FK lección'");
  assert.equal(noteRow[0].values.length, 1, 'La nota se conserva tras borrar la lección');
  assert.equal(noteRow[0].values[0][0], null, 'note.lesson_id debe anularse (ON DELETE SET NULL)');

  const sesRow = db.exec('SELECT resource_id, lesson_id, status FROM learning_session WHERE id = ?', [sid]);
  assert.equal(sesRow[0].values.length, 1, 'El historial de estudio se conserva');
  assert.equal(sesRow[0].values[0][0], courseId, 'Borrar UNA lección no desvincula el recurso de la sesión');
  assert.equal(sesRow[0].values[0][1], null, 'learning_session.lesson_id debe anularse (ON DELETE SET NULL)');
  assert.equal(sesRow[0].values[0][2], 'completed', 'El estado histórico no cambia');

  // Limpieza.
  db.run("DELETE FROM note WHERE title = 'Nota FK lección'");
  db.run('DELETE FROM learning_session WHERE id = ?', [sid]);
  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  await dbBridge.persist();
});

test('1.5 knowledge_connection gains deterministic indexes, uniqueness and dedup migration', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const listConnectionIndexes = (database: any): string[] => {
    const res = database.exec("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_knowledge_connection%'");
    return res.length ? res[0].values.map((v: any[]) => String(v[0])) : [];
  };

  const indexNames = listConnectionIndexes(db);
  for (const expected of ['idx_knowledge_connection_source', 'idx_knowledge_connection_target', 'idx_knowledge_connection_triple']) {
    assert.ok(indexNames.includes(expected), `Falta el índice ${expected}`);
  }

  // El índice único rechaza duplicados exactos de tripleta.
  db.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type) VALUES ('kc-uniq-1', 'probe-src', 'probe-tgt', 'related_to')");
  let duplicateRejected = false;
  try {
    db.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type) VALUES ('kc-uniq-2', 'probe-src', 'probe-tgt', 'related_to')");
  } catch {
    duplicateRejected = true;
  }
  assert.ok(duplicateRejected, 'La tripleta exacta duplicada debe quedar rechazada');
  db.run("DELETE FROM knowledge_connection WHERE id = 'kc-uniq-1'");

  // Migración de deduplicación sobre datos legacy: sin índice único, se crean
  // duplicados exactos y el roundtrip binario debe deduplicarlos conservando
  // deterministamente la fila con el id menor.
  db.run('DROP INDEX idx_knowledge_connection_triple');
  db.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type) VALUES ('kc-legacy-zzz', 'legacy-src', 'legacy-tgt', 'mentions')");
  db.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type) VALUES ('kc-legacy-aaa', 'legacy-src', 'legacy-tgt', 'mentions')");

  const bytes = dbBridge.exportDatabase();
  await dbBridge.importDatabase(bytes);
  const imported = dbBridge.getDatabase();

  const rows = imported.exec("SELECT id FROM knowledge_connection WHERE source_id = 'legacy-src' ORDER BY id ASC");
  assert.equal(rows[0].values.length, 1, 'La deduplicación debe dejar UNA sola fila por tripleta');
  assert.equal(rows[0].values[0][0], 'kc-legacy-aaa', 'Se conserva de forma determinista la fila con el id menor');

  assert.ok(
    listConnectionIndexes(imported).includes('idx_knowledge_connection_triple'),
    'El índice único debe recrearse tras la migración de deduplicación'
  );

  // Limpieza.
  imported.run("DELETE FROM knowledge_connection WHERE source_id = 'legacy-src'");
  await dbBridge.persist();
});
