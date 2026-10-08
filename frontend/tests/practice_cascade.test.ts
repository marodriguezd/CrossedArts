import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';

/**
 * Iteración 35 — El trabajo práctico es evidencia del estudiante: borrar su
 * recurso o lección NO debe destruirlo. Los vínculos usan ON DELETE SET NULL y
 * las bases antiguas (con CASCADE) se reconstruyen conservando sus filas.
 */

test('35.1 el DDL canónico del trabajo práctico usa SET NULL, nunca CASCADE', () => {
  const practiceDdl = SCHEMA_SQL.slice(
    SCHEMA_SQL.indexOf('CREATE TABLE IF NOT EXISTS practice_work'),
    SCHEMA_SQL.indexOf('CREATE INDEX IF NOT EXISTS idx_practice_work_resource')
  );
  assert.ok(practiceDdl.includes('ON DELETE SET NULL'), 'Los vínculos deben usar SET NULL');
  assert.ok(!/practice_work[\s\S]*ON DELETE CASCADE/.test(practiceDdl), 'Ningún vínculo debe borrar el trabajo');
});

test('35.2 una base legada con CASCADE se migra y conserva el trabajo del usuario', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  try {
    legacy.run(SCHEMA_SQL);
    // Reconstruye practice_work como lo hacían las versiones antiguas (CASCADE).
    legacy.run('DROP TABLE practice_work;');
    legacy.run(`CREATE TABLE practice_work (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE CASCADE,
      lesson_id TEXT REFERENCES lesson(id) ON DELETE CASCADE,
      concept_id TEXT REFERENCES concept(id) ON DELETE SET NULL,
      kind TEXT DEFAULT 'exercise',
      status TEXT DEFAULT 'PLANNED',
      artifact_url TEXT,
      notes TEXT,
      self_rating INTEGER,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
    legacy.run("INSERT INTO learning_resource (id, title, type, category, status) VALUES ('legacy-r', 'Recurso legado', 'course', 'General', 'NOT_STARTED')");
    legacy.run("INSERT INTO practice_work (id, title, resource_id, kind, status) VALUES ('legacy-pw', 'Trabajo legado', 'legacy-r', 'project', 'IN_PROGRESS')");

    const beforeCols = new Set(legacy.exec('PRAGMA table_info(practice_work)')[0].values.map((row) => String(row[1])));
    assert.ok(!beforeCols.has('content'), 'La base legada no tiene la columna content (la añade otra migración)');

    await dbBridge.importDatabase(legacy.export());

    const db = dbBridge.getDatabase();
    const fkRows = db.exec('PRAGMA foreign_key_list(practice_work)')[0].values;
    const parentCascades = fkRows.filter((row) => {
      const table = String(row[2]);
      return (table === 'learning_resource' || table === 'lesson') && String(row[6]).toUpperCase() === 'CASCADE';
    });
    assert.equal(parentCascades.length, 0, 'La migración elimina los CASCADE de los vínculos padre');
    assert.ok(
      fkRows.some((row) => String(row[6]).toUpperCase() === 'SET NULL'),
      'Los vínculos padre pasan a SET NULL'
    );

    // La fila y sus datos se conservan íntegros.
    const preserved = await dao.getPracticeWorkById('legacy-pw');
    assert.ok(preserved, 'El trabajo legado sobrevive a la migración');
    assert.equal(preserved!.resource_id, 'legacy-r');
    assert.equal(preserved!.title, 'Trabajo legado');
    // La recién añadida columna content existe pero está vacía para la fila heredada.
    assert.equal(preserved!.content, undefined);
    const afterCols = new Set(db.exec('PRAGMA table_info(practice_work)')[0].values.map((row) => String(row[1])));
    assert.ok(afterCols.has('content'), 'Ambas migraciones se componen correctamente');
  } finally {
    try { legacy.close(); } catch { /* cierre defensivo */ }
    await dbBridge.importDatabase(originalBytes);
  }
});

test('35.3 borrar el recurso padre conserva el trabajo práctico (SET NULL)', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const course = await dao.createCourse({ title: 'Curso efímero', description: 'Se borrará', category: 'Pruebas' });
  assert.equal(course.success, true);
  const workId = await dao.addPracticeWork({
    title: 'Evidencia que debe sobrevivir',
    resource_id: course.id!,
    content: 'Trabajo del estudiante'
  });

  db.run('DELETE FROM learning_resource WHERE id = ?', [course.id!]);
  await dbBridge.persist();

  const survivor = await dao.getPracticeWorkById(workId);
  assert.ok(survivor, 'El trabajo práctico NO debe borrarse con su recurso');
  assert.ok(!survivor!.resource_id, 'El vínculo queda huérfano (NULL), no destruido');
  assert.equal(survivor!.content, 'Trabajo del estudiante');

  // Sigue siendo visible en el índice global (no se oculta por estar huérfano).
  const all = await dao.getAllPracticeWork();
  assert.ok(all.some((w) => w.id === workId), 'El artefacto huérfano sigue siendo visible');
});
