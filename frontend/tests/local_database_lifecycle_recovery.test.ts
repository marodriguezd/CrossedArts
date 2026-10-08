import test from 'node:test';
import assert from 'node:assert/strict';
import initSqlJs from 'sql.js';
import { dbBridge, DatabaseInitializationError, StaleWriteError, isValidSqliteBuffer } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

// ---------------------------------------------------------------------------
// Suite de tests para el ciclo de vida, migraciones y recuperación de la base
// de datos local SQLite en IndexedDB / WebAssembly.
// ---------------------------------------------------------------------------

test('31.1 Fresh database creation initializes all 12 tables and seed data', async () => {
  const fresh = new (dbBridge.constructor as any)();
  const db = await fresh.init();
  assert.ok(db, 'La base de datos debe inicializarse');
  assert.equal(fresh.getInitState(), 'ready');
  assert.equal(fresh.getInitFailure(), null);

  const tablesRes = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;");
  const tableNames = tablesRes[0].values.map((r: any[]) => String(r[0]));

  const expectedTables = [
    'book',
    'concept',
    'course',
    'flashcard',
    'knowledge_connection',
    'learning_goal',
    'learning_resource',
    'learning_session',
    'lesson',
    'module',
    'note',
    'practice_work'
  ];

  for (const table of expectedTables) {
    assert.ok(tableNames.includes(table), `Falta la tabla requerida: ${table}`);
  }
});

test('31.2 Persist -> reload -> reopen cycle preserves data without corruption', async () => {
  const bridgeA = new (dbBridge.constructor as any)();
  let inMemStorage: Uint8Array | null = null;
  bridgeA.saveToStorage = async (bytes: Uint8Array) => { inMemStorage = bytes; };
  bridgeA.loadFromStorage = async () => inMemStorage;

  await bridgeA.init();
  const dbA = bridgeA.getDatabase();
  dbA.run("INSERT INTO note (id, title, content, tags) VALUES ('note-persist-test', 'Nota Persistida', 'Contenido 123', 'tag1');");
  await bridgeA.persist();
  assert.ok(inMemStorage && inMemStorage.byteLength > 0, 'Los bytes deben haberse guardado');

  // Segunda instancia (simula recarga de página)
  const bridgeB = new (dbBridge.constructor as any)();
  bridgeB.saveToStorage = async (bytes: Uint8Array) => { inMemStorage = bytes; };
  bridgeB.loadFromStorage = async () => inMemStorage;

  await bridgeB.init();
  const dbB = bridgeB.getDatabase();
  const rows = dbB.exec("SELECT id, title, content FROM note WHERE id = 'note-persist-test'");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].values[0][1], 'Nota Persistida');
  assert.equal(rows[0].values[0][2], 'Contenido 123');
});

test('31.3 ROOT CAUSE REGRESSION: Legacy database with flashcard table lacking lesson_id migrates cleanly without corrupt-storage error', async () => {
  // Construir una base de datos con el esquema de una versión anterior donde:
  // - `flashcard` NO tiene la columna `lesson_id`
  // - `note` NO tiene la columna `lesson_id`
  // - `lesson` NO tiene la columna `content`
  // - `practice_work` y `learning_goal` no existían aún
  const SQL = await initSqlJs();
  const legacyDb = new SQL.Database();
  legacyDb.run(`
    CREATE TABLE learning_resource (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      cover_path TEXT,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'NOT_STARTED',
      source_path TEXT,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE course (
      id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
      instructor TEXT,
      difficulty TEXT DEFAULT 'BEGINNER',
      total_duration_minutes INTEGER DEFAULT 0,
      total_lessons INTEGER DEFAULT 0,
      completed_lessons INTEGER DEFAULT 0
    );
    CREATE TABLE book (
      id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
      author TEXT,
      isbn TEXT,
      page_count INTEGER,
      current_page INTEGER DEFAULT 0,
      reading_percentage REAL DEFAULT 0.0
    );
    CREATE TABLE module (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0
    );
    CREATE TABLE lesson (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0,
      duration_minutes INTEGER DEFAULT 0,
      lesson_type TEXT DEFAULT 'VIDEO',
      media_url TEXT,
      is_completed BOOLEAN DEFAULT 0
    );
    CREATE TABLE learning_session (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL REFERENCES learning_resource(id),
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_minutes INTEGER DEFAULT 0,
      inactive_seconds INTEGER DEFAULT 0
    );
    CREATE TABLE note (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE flashcard (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      repetition_count INTEGER DEFAULT 0,
      interval_days INTEGER DEFAULT 1,
      ease_factor REAL DEFAULT 2.5,
      due_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_reviewed DATETIME
    );
    CREATE TABLE concept (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE knowledge_connection (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      connection_type TEXT DEFAULT 'related_to',
      weight REAL DEFAULT 1.0
    );

    -- Insertar datos del usuario que deben preservarse
    INSERT INTO learning_resource (id, title, type) VALUES ('res-1', 'Curso Legacy del Usuario', 'course');
    INSERT INTO course (id, instructor) VALUES ('res-1', 'Profesor X');
    INSERT INTO flashcard (id, resource_id, front, back) VALUES ('fc-1', 'res-1', 'Pregunta Anverso', 'Respuesta Reverso');
    INSERT INTO note (id, resource_id, title, content) VALUES ('note-1', 'res-1', 'Nota Valiosa', 'Texto importante que no se debe perder');
    INSERT INTO learning_session (id, resource_id, duration_minutes) VALUES ('ses-1', 'res-1', 45);
  `);

  const legacyBytes = legacyDb.export();
  legacyDb.close();

  // Simular la carga de esta base legacy por el SQLiteBridge
  const bridge = new (dbBridge.constructor as any)();
  let savedStorage: Uint8Array | null = legacyBytes;
  bridge.saveToStorage = async (bytes: Uint8Array) => { savedStorage = bytes; };
  bridge.loadFromStorage = async () => savedStorage;

  // NO debe lanzar DatabaseInitializationError ni fallar con "no such column: lesson_id"
  const db = await bridge.init();
  assert.equal(bridge.getInitState(), 'ready', 'El estado de inicialización debe ser ready');
  assert.equal(bridge.getInitFailure(), null);

  // Verificar que los datos del usuario se conservaron intactos
  const fcRows = db.exec("SELECT id, front, back, lesson_id FROM flashcard WHERE id = 'fc-1'");
  assert.equal(fcRows.length, 1);
  assert.equal(fcRows[0].values[0][1], 'Pregunta Anverso');
  assert.equal(fcRows[0].values[0][2], 'Respuesta Reverso');
  assert.equal(fcRows[0].values[0][3], null, 'lesson_id debe estar disponible como null para datos legacy');

  const noteRows = db.exec("SELECT id, title, content, lesson_id FROM note WHERE id = 'note-1'");
  assert.equal(noteRows.length, 1);
  assert.equal(noteRows[0].values[0][1], 'Nota Valiosa');

  const sessionRows = db.exec("SELECT id, resource_id, duration_minutes, status, mode FROM learning_session WHERE id = 'ses-1'");
  assert.equal(sessionRows.length, 1);
  assert.equal(sessionRows[0].values[0][2], 45);
  assert.equal(sessionRows[0].values[0][3], 'completed');

  // Verificar que las tablas nuevas como practice_work y learning_goal fueron creadas
  const goalCheck = db.exec("SELECT COUNT(*) FROM learning_goal");
  assert.ok(goalCheck.length > 0);

  const practiceCheck = db.exec("SELECT COUNT(*) FROM practice_work");
  assert.ok(practiceCheck.length > 0);

  // Verificar que los índices requeridos existen
  const idxRows = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_flashcard_lesson'");
  assert.equal(idxRows.length, 1, 'El índice idx_flashcard_lesson debe haber sido creado');
});

test('31.4 Truncated or corrupted database payload does NOT delete data and triggers corrupt-storage with recovery path', async () => {
  const corruptedBytes = new Uint8Array([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00, 0x00, 0x01, 0x00]); // Header pero truncado/corrupto

  const bridge = new (dbBridge.constructor as any)();
  let storageBytes: Uint8Array | null = corruptedBytes;
  bridge.saveToStorage = async (bytes: Uint8Array) => { storageBytes = bytes; };
  bridge.loadFromStorage = async () => storageBytes;

  let thrown: any = null;
  try {
    await bridge.init();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown, 'Debe lanzar error al abrir base de datos corrupta');
  assert.ok(thrown instanceof DatabaseInitializationError);
  assert.equal(thrown.failure.code, 'corrupt-storage');
  assert.match(thrown.failure.message, /no se puede abrir de forma segura/i);

  // LOS BYTES PERSISTIDOS SIGUEN INTACTOS (nunca se borran en fallo)
  assert.equal(storageBytes, corruptedBytes, 'Los datos en almacenamiento no deben ser sobreescritos ni borrados');
  assert.equal(bridge.getInitState(), 'failed');
});

test('31.5 Invalid binary header payload is rejected before SQL initialization', async () => {
  const invalidHeaderBytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  assert.equal(isValidSqliteBuffer(invalidHeaderBytes), false);

  const bridge = new (dbBridge.constructor as any)();
  let storageBytes: Uint8Array | null = invalidHeaderBytes;
  bridge.saveToStorage = async (bytes: Uint8Array) => { storageBytes = bytes; };
  bridge.loadFromStorage = async () => storageBytes;

  let thrown: any = null;
  try {
    await bridge.init();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof DatabaseInitializationError);
  assert.equal(thrown.failure.code, 'corrupt-storage');
  assert.equal(storageBytes, invalidHeaderBytes, 'Los datos no deben ser alterados');
});

test('31.6 Storage failure during load and save is classified as storage-unavailable and is retryable', async () => {
  const bridge = new (dbBridge.constructor as any)();
  bridge.loadFromStorage = async () => {
    throw new Error('IndexedDB transaction blocked');
  };
  bridge.saveToStorage = async () => {
    throw new Error('IndexedDB transaction blocked');
  };

  let thrown: any = null;
  try {
    await bridge.init();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof DatabaseInitializationError);
  assert.equal(thrown.failure.code, 'storage-unavailable');
  assert.equal(thrown.failure.retryable, true);
  assert.match(thrown.failure.message, /almacenamiento local/i);
});

test('31.7 importDatabase upgrades legacy database and commits migrated version', async () => {
  const SQL = await initSqlJs();
  const legacyDb = new SQL.Database();
  legacyDb.run(`
    CREATE TABLE learning_resource (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      cover_path TEXT,
      category TEXT DEFAULT 'General',
      status TEXT DEFAULT 'NOT_STARTED',
      source_path TEXT,
      type TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE course (
      id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
      instructor TEXT,
      difficulty TEXT DEFAULT 'BEGINNER',
      total_duration_minutes INTEGER DEFAULT 0,
      total_lessons INTEGER DEFAULT 0,
      completed_lessons INTEGER DEFAULT 0
    );
    CREATE TABLE book (
      id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
      author TEXT,
      isbn TEXT,
      page_count INTEGER,
      current_page INTEGER DEFAULT 0,
      reading_percentage REAL DEFAULT 0.0
    );
    CREATE TABLE module (
      id TEXT PRIMARY KEY,
      course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      order_index INTEGER DEFAULT 0
    );
    CREATE TABLE lesson (
      id TEXT PRIMARY KEY,
      module_id TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      content TEXT,
      order_index INTEGER DEFAULT 0,
      duration_minutes INTEGER DEFAULT 0,
      lesson_type TEXT DEFAULT 'VIDEO',
      media_url TEXT,
      is_completed BOOLEAN DEFAULT 0
    );
    CREATE TABLE learning_session (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
      lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME,
      duration_minutes INTEGER DEFAULT 0,
      inactive_seconds INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'flashcards',
      cards_reviewed INTEGER DEFAULT 0,
      questions_answered INTEGER DEFAULT 0,
      correct_answers INTEGER DEFAULT 0,
      status TEXT DEFAULT 'completed'
    );
    CREATE TABLE note (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
      lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE flashcard (
      id TEXT PRIMARY KEY,
      resource_id TEXT REFERENCES learning_resource(id) ON DELETE CASCADE,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      repetition_count INTEGER DEFAULT 0,
      interval_days INTEGER DEFAULT 1,
      ease_factor REAL DEFAULT 2.5,
      due_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_reviewed DATETIME
    );
    CREATE TABLE concept (
      id TEXT PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    );
    CREATE TABLE knowledge_connection (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      connection_type TEXT DEFAULT 'related_to',
      weight REAL DEFAULT 1.0
    );

    INSERT INTO learning_resource (id, title, type) VALUES ('c1', 'Curso Importado', 'course');
    INSERT INTO course (id, instructor) VALUES ('c1', 'Ada');
    INSERT INTO flashcard (id, resource_id, front, back) VALUES ('f1', 'c1', 'A', 'B');
  `);

  const bytes = legacyDb.export();
  legacyDb.close();

  const bridge = new (dbBridge.constructor as any)();
  await bridge.init();
  await bridge.importDatabase(bytes);

  const imported = bridge.getDatabase();
  const res = imported.exec("SELECT id, front, lesson_id FROM flashcard WHERE id = 'f1'");
  assert.equal(res[0].values[0][1], 'A');
  assert.equal(res[0].values[0][2], null);
});

test('31.8 exportPersistedRecovery reads directly from storage and returns valid sqlite filename', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run("CREATE TABLE learning_resource (id TEXT PRIMARY KEY);");
  const bytes = db.export();
  db.close();

  const bridge = new (dbBridge.constructor as any)();
  bridge.loadFromStorage = async () => bytes;

  // En entorno Node.js sin document, exportPersistedRecovery retorna null sin lanzar
  const resultNode = await bridge.exportPersistedRecovery();
  assert.equal(resultNode, null);

  // Simular DOM con document para verificar descarga de recovery
  (globalThis as any).document = {
    createElement: (tag: string) => ({
      tagName: tag,
      href: '',
      download: '',
      click: () => {},
    }),
    body: {
      appendChild: () => {},
      removeChild: () => {},
    }
  };
  (globalThis as any).URL = {
    createObjectURL: () => 'blob:crossedarts-recovery-probe',
    revokeObjectURL: () => {},
  };

  const filename = await bridge.exportPersistedRecovery();
  assert.ok(filename && filename.startsWith('crossedarts-recovery-'));
  assert.ok(filename.endsWith('.sqlite'));

  delete (globalThis as any).document;
});

test('31.9 Corrupt B-tree page fails PRAGMA quick_check and is classified as corrupt-storage', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(
    "CREATE TABLE learning_resource (id TEXT PRIMARY KEY, title TEXT, type TEXT); INSERT INTO learning_resource VALUES ('r1', 'Test', 'course');"
  );
  const validBytes = db.export();
  db.close();

  // Corromper intencionadamente una página intermedia (dejando la cabecera SQLite intacta)
  const damagedBytes = new Uint8Array(validBytes);
  damagedBytes.fill(0xff, 100, 500);

  const bridge = new (dbBridge.constructor as any)();
  bridge.loadFromStorage = async () => damagedBytes;

  let thrown: any = null;
  try {
    await bridge.init();
  } catch (err) {
    thrown = err;
  }

  assert.ok(thrown instanceof DatabaseInitializationError);
  assert.equal(thrown.failure.code, 'corrupt-storage');
  assert.match(thrown.failure.message, /no se puede abrir de forma segura/i);
});

test('31.10 Multiple parallel init() calls with legacy database resolve deterministically without concurrency collision', async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE learning_resource (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, cover_path TEXT, category TEXT, status TEXT, source_path TEXT, type TEXT NOT NULL, created_at DATETIME, updated_at DATETIME);
    CREATE TABLE course (id TEXT PRIMARY KEY REFERENCES learning_resource(id), instructor TEXT, difficulty TEXT, total_duration_minutes INTEGER, total_lessons INTEGER, completed_lessons INTEGER);
    CREATE TABLE book (id TEXT PRIMARY KEY, author TEXT, isbn TEXT, page_count INTEGER, current_page INTEGER, reading_percentage REAL);
    CREATE TABLE module (id TEXT PRIMARY KEY, course_id TEXT, title TEXT, order_index INTEGER);
    CREATE TABLE lesson (id TEXT PRIMARY KEY, module_id TEXT, title TEXT, content TEXT, order_index INTEGER, duration_minutes INTEGER, lesson_type TEXT, media_url TEXT, is_completed BOOLEAN);
    CREATE TABLE learning_session (id TEXT PRIMARY KEY, resource_id TEXT, lesson_id TEXT, started_at DATETIME, ended_at DATETIME, duration_minutes INTEGER, inactive_seconds INTEGER, mode TEXT, cards_reviewed INTEGER, questions_answered INTEGER, correct_answers INTEGER, status TEXT);
    CREATE TABLE note (id TEXT PRIMARY KEY, resource_id TEXT, lesson_id TEXT, title TEXT, content TEXT, tags TEXT, created_at DATETIME, updated_at DATETIME);
    CREATE TABLE flashcard (id TEXT PRIMARY KEY, resource_id TEXT, front TEXT, back TEXT, repetition_count INTEGER, interval_days INTEGER, ease_factor REAL, due_date DATETIME, last_reviewed DATETIME);
    CREATE TABLE concept (id TEXT PRIMARY KEY, name TEXT UNIQUE, description TEXT);
    CREATE TABLE knowledge_connection (id TEXT PRIMARY KEY, source_id TEXT, target_id TEXT, connection_type TEXT, weight REAL);
    INSERT INTO learning_resource (id, title, type) VALUES ('res-c', 'Concurrencia Test', 'course');
  `);
  const bytes = db.export();
  db.close();

  const bridge = new (dbBridge.constructor as any)();
  bridge.loadFromStorage = async () => bytes;

  const [res1, res2, res3, res4] = await Promise.all([
    bridge.init(),
    bridge.init(),
    bridge.init(),
    bridge.init()
  ]);

  assert.equal(res1, res2);
  assert.equal(res2, res3);
  assert.equal(res3, res4);
  assert.equal(bridge.getInitState(), 'ready');
});

test('31.11 Stale write error in persist preserves remote snapshot and sets stale-other-tab', async () => {
  const bridge = new (dbBridge.constructor as any)();
  await bridge.init();
  const db = bridge.getDatabase();
  db.run("INSERT INTO note (id, title, content) VALUES ('note-stale-test', 'T1', 'C1')");

  // Simular conflicto CAS: otra pestaña avanzó la revisión
  bridge.saveToStorageWithCas = async () => {
    throw new StaleWriteError(5);
  };

  await assert.rejects(
    async () => bridge.persist(),
    /StaleWriteError|Otra pestaña guardó una versión más nueva/i
  );

  const report = bridge.getStorageReport();
  assert.equal(report.state, 'stale-other-tab');
});
