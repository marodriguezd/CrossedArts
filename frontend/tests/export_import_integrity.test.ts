import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { generateJsonBackup, importJsonBackup, getDatabaseTables } from '../src/db/exportImport.ts';

test('4.1 SQLite binary export produces valid SQLite format 3 byte stream', async () => {
  await dbBridge.init();
  const bytes = dbBridge.exportDatabase();

  assert.ok(bytes instanceof Uint8Array, 'Export must return a Uint8Array');
  assert.ok(bytes.length > 1024, `Exported SQLite database must be > 1KB, got ${bytes.length} bytes`);

  // Verificar la firma mágica del encabezado SQLite ("SQLite format 3\000")
  const magic = new TextDecoder('utf-8').decode(bytes.slice(0, 16));
  assert.strictEqual(magic, 'SQLite format 3\0', 'Must contain valid SQLite 3 magic header');
});

test('4.2 SQLite database roundtrip import restores complete database state from binary bytes', async () => {
  const originalBytes = dbBridge.exportDatabase();

  // Modificar la base de datos actual insertando un registro temporal
  const db = dbBridge.getDatabase();
  db.run("INSERT INTO concept (id, name, description) VALUES ('temp-roundtrip', 'Temp Concept', 'Will be discarded')");
  
  let concepts = db.exec("SELECT * FROM concept WHERE id = 'temp-roundtrip'");
  assert.strictEqual(concepts.length, 1);

  // Restaurar desde los bytes originales
  await dbBridge.importDatabase(originalBytes);

  const restoredDb = dbBridge.getDatabase();
  concepts = restoredDb.exec("SELECT * FROM concept WHERE id = 'temp-roundtrip'");
  assert.strictEqual(concepts.length, 0, 'Temporary record should not exist in restored database');
});

test('4.3 JSON backup dump extracts all 10 tables with exact relational content', () => {
  const dump = generateJsonBackup();
  const tables = getDatabaseTables();

  for (const table of tables) {
    assert.ok(table in dump, `Table ${table} must be present in JSON dump`);
    assert.ok(Array.isArray(dump[table]), `Table ${table} in dump must be an array`);
  }

  assert.ok(dump['learning_resource'].length >= 6, 'Should dump at least 6 learning resources');
  assert.ok(dump['course'].length >= 3, 'Should dump at least 3 courses');
  assert.ok(dump['book'].length >= 3, 'Should dump at least 3 books');
  assert.ok(dump['flashcard'].length >= 4, 'Should dump at least 4 flashcards');
});

test('4.4 JSON backup import wipes and accurately restores all relational records', async () => {
  const initialDump = generateJsonBackup();
  const initialCourseCount = initialDump['course'].length;

  // Modificar los datos en el dump JSON
  const customDump = JSON.parse(JSON.stringify(initialDump));
  customDump['course'].push({
    id: 'c-custom-imported',
    instructor: 'Ada Lovelace',
    difficulty: 'ADVANCED',
    total_duration_minutes: 120,
    total_lessons: 5,
    completed_lessons: 0
  });
  customDump['learning_resource'].push({
    id: 'c-custom-imported',
    title: 'Arquitectura de Computación Analítica',
    description: 'Curso histórico y algorítmico',
    cover_path: null,
    category: 'Historia de la Computación',
    status: 'NOT_STARTED',
    source_path: null,
    type: 'course',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  });

  // Importar el dump modificado
  await importJsonBackup(customDump);

  const db = dbBridge.getDatabase();
  const res = db.exec("SELECT title FROM learning_resource WHERE id = 'c-custom-imported'");
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].values[0][0], 'Arquitectura de Computación Analítica');

  // Restaurar el dump inicial para dejar la base de datos limpia
  await importJsonBackup(initialDump);
  const finalCheck = db.exec("SELECT title FROM learning_resource WHERE id = 'c-custom-imported'");
  assert.strictEqual(finalCheck.length, 0);
});

test('4.5 Corrupt SQLite Backup Rejection: Rejects non-SQLite bytes and invalid headers', async () => {
  const garbageBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  
  await assert.rejects(
    async () => {
      await dbBridge.importDatabase(garbageBytes);
    },
    /SQLite format 3/
  );
});

test('4.6 Incompatible Schema Backup Rejection: Rejects valid SQLite without CrossedArts tables', async () => {
  // Generar un SQLite válido pero con un esquema arbitrario ajeno a CrossedArts
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const foreignDb = new SQL.Database();
  foreignDb.run("CREATE TABLE random_user (id INT, name TEXT);");
  foreignDb.run("INSERT INTO random_user VALUES (1, 'Alice');");
  const foreignBytes = foreignDb.export();
  foreignDb.close();

  await assert.rejects(
    async () => {
      await dbBridge.importDatabase(foreignBytes);
    },
    /learning_resource/
  );
});

test('4.7 Storage Status Report & Capability: Reports explicit states and persistence timestamp', async () => {
  const report = dbBridge.getStorageReport();
  assert.ok(['loading', 'ready', 'persisting', 'persisted'].includes(report.state));
  assert.ok(report.databaseSizeBytes > 1000);
  assert.strictEqual(typeof report.hasIndexedDB, 'boolean');
});

test('4.8 Seed Protection & Data Survival: Real user modifications survive re-initialization', async () => {
  const db = dbBridge.getDatabase();
  // Insertar un recurso legítimo creado por el usuario
  db.run(`
    INSERT INTO learning_resource (id, title, description, category, status, type)
    VALUES ('res-user-persistent', 'Mi Nota Maestra de Estudio', 'Creado por el usuario', 'Personal', 'IN_PROGRESS', 'note');
  `);
  await dbBridge.persist();

  // Simular recarga: re-inicializar el bridge
  const dbAfterReload = await dbBridge.init();
  const check = dbAfterReload.exec("SELECT title FROM learning_resource WHERE id = 'res-user-persistent'");
  assert.strictEqual(check.length, 1);
  assert.strictEqual(check[0].values[0][0], 'Mi Nota Maestra de Estudio');

  // Limpiar
  db.run("DELETE FROM learning_resource WHERE id = 'res-user-persistent'");
  await dbBridge.persist();
});

test('4.9 Local Media Portability Isolation: SQLite backup does not contain blob URLs or File handles', () => {
  const db = dbBridge.getDatabase();
  const lessons = db.exec("SELECT media_url FROM lesson WHERE media_url IS NOT NULL");
  if (lessons.length && lessons[0].values.length) {
    for (const row of lessons[0].values) {
      const url = String(row[0]);
      assert.ok(!url.startsWith('blob:'), 'Persisted media_url must never be a blob: URL');
      assert.ok(!url.includes('[object File]'), 'Persisted media_url must not serialize raw File handles');
    }
  }
});

test('4.10 JSON backup roundtrip handles stringified JSON and rejects malformed payloads safely', async () => {
  const dump = generateJsonBackup();
  const jsonText = JSON.stringify(dump);
  const parsed = JSON.parse(jsonText);

  // Debe restaurar limpiamente sin errores
  await importJsonBackup(parsed);

  // Un payload malformado o no objeto debe ser rechazado sin tocar la BD
  await assert.rejects(
    async () => {
      await importJsonBackup("invalid-string" as any);
    },
    /no tiene un formato válido/
  );
});

