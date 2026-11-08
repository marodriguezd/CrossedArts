import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { DEMO_PRESETS_META, getDemoPresetSql } from '../src/db/demoPresets.ts';

test('Presets & Clean State: DEMO_PRESETS_META exposes full, ai_data, and reading', () => {
  assert.equal(DEMO_PRESETS_META.length, 3);
  const ids = DEMO_PRESETS_META.map(p => p.id);
  assert.deepEqual(ids, ['full', 'ai_data', 'reading']);
  for (const preset of DEMO_PRESETS_META) {
    const sql = getDemoPresetSql(preset.id);
    assert.ok(sql.length > 50, `Preset ${preset.id} debe tener sentencias SQL válidas`);
  }
});

test('Presets & Clean State: resetClean leaves database completely empty with schema intact', async () => {
  await dbBridge.init();
  await dbBridge.resetClean();

  const courses = await dao.getCourses();
  const books = await dao.getBooks();
  assert.equal(courses.length, 0, 'No debe haber cursos en estado limpio');
  assert.equal(books.length, 0, 'No debe haber libros en estado limpio');

  const notes = await dao.getNotes();
  assert.equal(notes.length, 0, 'No debe haber notas en estado limpio');

  const flashcards = await dao.getFlashcards();
  assert.equal(flashcards.length, 0, 'No debe haber tarjetas pendientes en estado limpio');

  const goals = await dao.getGoals();
  assert.equal(goals.length, 0, 'No debe haber metas en estado limpio');

  // Verify that inserting into a clean database works with foreign keys intact
  const createdCourse = await dao.createCourse({
    title: 'Curso Nuevo en Limpio',
    category: 'Prueba',
    difficulty: 'BEGINNER'
  });
  assert.ok(createdCourse.id, 'Debe permitir crear cursos en el espacio limpio');

  const readBack = await dao.getCourseById(createdCourse.id!);
  assert.equal(readBack?.title, 'Curso Nuevo en Limpio');
});

test('Presets & Clean State: loadDemoPreset(ai_data) loads AI and data courses/concepts', async () => {
  await dbBridge.loadDemoPreset('ai_data');

  const courses = await dao.getCourses();
  assert.equal(courses.length, 1, 'Debe haber 1 curso en el preset ai_data');
  assert.equal(courses[0].id, 'c2-python');

  const book = await dao.getBookById('b2-pragmatic');
  assert.ok(book, 'Debe incluir The Pragmatic Programmer');

  const graph = await dao.getKnowledgeGraph();
  assert.ok(graph.nodes.some(n => n.name === 'Embeddings Vectoriales'), 'Debe incluir conceptos de IA');
});

test('Presets & Clean State: loadDemoPreset(reading) loads productivity books and 4DX notes', async () => {
  await dbBridge.loadDemoPreset('reading');

  const courses = await dao.getCourses();
  const books = await dao.getBooks();
  assert.equal(courses.length, 0, 'No hay cursos en el preset de lectura');
  assert.equal(books.length, 2, 'Debe haber 2 libros en el preset de lectura');

  const deepWork = await dao.getBookById('b1-deepwork');
  assert.ok(deepWork, 'Debe incluir Deep Work');

  const atomic = await dao.getBookById('b3-atomic');
  assert.ok(atomic, 'Debe incluir Atomic Habits');

  const notes = await dao.getNotes();
  assert.ok(notes.some(n => n.title.includes('4DX') || n.content.includes('4DX')), 'Debe incluir notas 4DX');
});

test('Presets & Clean State: loadDemoPreset(full) restores complete demo environment', async () => {
  await dbBridge.loadDemoPreset('full');

  const courses = await dao.getCourses();
  const books = await dao.getBooks();
  assert.equal(courses.length, 3, 'Debe tener 3 cursos');
  assert.equal(books.length, 3, 'Debe tener 3 libros');

  const reactCourse = await dao.getCourseById('c1-react');
  assert.ok(reactCourse, 'Debe incluir el curso c1-react');
});
