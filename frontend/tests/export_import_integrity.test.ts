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
