import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
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
