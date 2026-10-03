import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

test('2.1 dao.getKPIs calculates metrics from relational tables accurately', async () => {
  await dbBridge.init();
  const kpis = await dao.getKPIs();

  assert.ok(kpis.total_resources >= 6, 'Total resources should be >= 6');
  assert.ok(kpis.completed_resources >= 2, 'Completed resources should be >= 2');
  assert.ok(kpis.total_study_hours > 0, 'Total study hours should be positive');
  assert.ok(kpis.active_streak_days >= 1, 'Active streak should be recorded');
  assert.ok(kpis.pending_reviews >= 0, 'Pending reviews should be a valid non-negative number');
});

test('2.2 dao.getCourses and getCourseById builds complete hierarchy with modules and lessons', async () => {
  const courses = await dao.getCourses();
  assert.ok(courses.length >= 3, 'Should retrieve at least 3 courses');

  const reactCourse = await dao.getCourseById('c1-react');
  assert.ok(reactCourse, 'React course must exist');
  assert.strictEqual(reactCourse?.title, 'React 18 & TypeScript Masterclass');
  assert.ok(reactCourse?.modules && reactCourse.modules.length > 0, 'Course must have modules');

  const firstModule = reactCourse.modules[0];
  assert.ok(firstModule.lessons && firstModule.lessons.length > 0, 'Module must contain lessons');
  assert.strictEqual(firstModule.lessons[0].id, 'l1');
  assert.strictEqual(firstModule.lessons[0].is_completed, true);
});

test('2.3 dao.toggleLessonCompleted updates lesson completion status in SQLite', async () => {
  const reactCourse = await dao.getCourseById('c1-react');
  assert.ok(reactCourse?.modules);
  const lessonToToggle = reactCourse.modules[0].lessons![2]; // l3 (initially false)
  assert.strictEqual(lessonToToggle.is_completed, false);

  await dao.toggleLessonCompleted(lessonToToggle.id, true);

  const updatedCourse = await dao.getCourseById('c1-react');
  const updatedLesson = updatedCourse!.modules![0].lessons![2];
  assert.strictEqual(updatedLesson.is_completed, true);

  // Revertir para mantener consistencia
  await dao.toggleLessonCompleted(lessonToToggle.id, false);
});

test('2.4 dao.getBooks and updateBookProgress updates pages and completes resource when finished', async () => {
  const books = await dao.getBooks();
  const deepWork = books.find(b => b.id === 'b1-deepwork');
  assert.ok(deepWork, 'Deep work book must exist');

  // Actualizar progreso a 152 / 304 páginas (50%)
  await dao.updateBookProgress('b1-deepwork', 152, 304);

  let updatedBooks = await dao.getBooks();
  let updatedBook = updatedBooks.find(b => b.id === 'b1-deepwork');
  assert.strictEqual(updatedBook?.current_page, 152);
  assert.strictEqual(updatedBook?.reading_percentage, 50.0);
  assert.strictEqual(updatedBook?.status, 'IN_PROGRESS');

  // Actualizar progreso al 100% (304 / 304)
  await dao.updateBookProgress('b1-deepwork', 304, 304);
  updatedBooks = await dao.getBooks();
  updatedBook = updatedBooks.find(b => b.id === 'b1-deepwork');
  assert.strictEqual(updatedBook?.reading_percentage, 100.0);
  assert.strictEqual(updatedBook?.status, 'COMPLETED');
});

test('2.5 dao.addNote safely handles quotes and escapes to prevent SQL injection', async () => {
  const injectionTitle = "Nota con comillas simples: 'O'Reilly' y caracteres raros: \"<>&;";
  const injectionContent = "Contenido con comillas 'test' y drop table attempt: '; DROP TABLE note; --";
  const tags = "seguridad, sql, test";

  await dao.addNote({
    title: injectionTitle,
    content: injectionContent,
    tags: tags
  });

  const notes = await dao.getNotes();
  const added = notes.find(n => n.title === injectionTitle);
  assert.ok(added, 'Note with single quotes must be inserted without SQL error');
  assert.strictEqual(added?.content, injectionContent);

  // Verificar que la tabla note no fue borrada
  assert.ok(notes.length >= 3, 'Notes table must remain intact');
});

test('2.6 dao.getKnowledgeGraph returns valid nodes and directional relations', async () => {
  const graph = await dao.getKnowledgeGraph();
  assert.ok(graph.nodes.length >= 6, 'Must contain at least 6 concept nodes');
  assert.ok(graph.edges.length >= 4, 'Must contain at least 4 concept relations');

  const reactNode = graph.nodes.find(n => n.name === 'React 18');
  assert.ok(reactNode, 'React 18 concept node must exist');

  const connection = graph.edges.find(e => e.source_id === 'cp1' && e.target_id === 'cp2');
  assert.ok(connection, 'Connection between React 18 and Virtual DOM must exist');
  assert.strictEqual(connection?.connection_type, 'references');
});
