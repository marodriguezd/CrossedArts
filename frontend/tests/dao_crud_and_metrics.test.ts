import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { resolveLocalDay } from '../src/services/localDate.ts';

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

test('2.7 dao.getActiveStreak calculates real streak based on calendar days with sessions', async () => {
  const db = dbBridge.getDatabase();
  
  // Backup de sesiones existentes
  const existingSessions = db.exec('SELECT id, resource_id, started_at, duration_minutes FROM learning_session');
  
  try {
    // 1. Caso: Sin sesiones
    db.run('DELETE FROM learning_session');
    let streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 0, 'Streak with no sessions must be 0');

    // 2. Caso: Una sesión hoy
    db.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('test-s1', 'c1-react', datetime('now'), 30)");
    streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 1, 'Streak with one session today must be 1');

    // 3. Caso: Múltiples sesiones en el mismo día (hoy)
    db.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('test-s2', 'c1-react', datetime('now'), 45)");
    streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 1, 'Multiple sessions on the same calendar day count as 1 day towards streak');

    // 4. Caso: Días consecutivos (hoy, ayer, anteayer -> 3 días)
    db.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('test-s3', 'c1-react', datetime('now', '-1 day'), 25)");
    db.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('test-s4', 'c1-react', datetime('now', '-2 days'), 60)");
    streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 3, 'Consecutive study days (today, yesterday, 2 days ago) must yield 3');

    // 5. Caso: Brecha/hueco en la racha (sesión hace 4 días no debe sumar si hay un hueco el día 3)
    db.run("INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES ('test-s5', 'c1-react', datetime('now', '-4 days'), 30)");
    streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 3, 'Gap in study dates stops streak increment');

    // 6. Caso: Sin sesión HOY (día local), pero con sesión ayer y anteayer (racha de 2)
    //
    // El borrado usa el DÍA LOCAL, igual que la racha. Antes esta prueba borraba
    // por `date('now')` (UTC) mientras la racha se computaba por día UTC, de modo
    // que solo coincidía por casualidad: al caer la ejecución entre las 22:00 y
    // las 24:00 UTC, la sesión "de hoy" ya tenía fecha local del día siguiente y
    // la prueba medía una racha de 3 en lugar de 2. Ahora la prueba expresa su
    // intención en los mismos términos que la implementación y es determinista
    // en cualquier franja horaria.
    const { day: localToday, utcOffsetModifier } = resolveLocalDay();
    db.run('DELETE FROM learning_session WHERE date(started_at, ?) = ?', [utcOffsetModifier, localToday]);
    streak = await dao.getActiveStreak();
    assert.strictEqual(streak, 2, 'Streak counts backwards from yesterday if no session has been recorded yet today');
  } finally {
    // Restaurar sesiones originales
    db.run('DELETE FROM learning_session');
    if (existingSessions.length && existingSessions[0].values) {
      for (const row of existingSessions[0].values) {
        db.run(
          'INSERT INTO learning_session (id, resource_id, started_at, duration_minutes) VALUES (?, ?, ?, ?)',
          row
        );
      }
    }
  }
});

test('2.8 dao parameterized methods prevent SQL injection across all query boundaries', async () => {
  const injectionId = "nonexistent' OR '1'='1";
  
  // getCourseById no debe ser vulnerable ni devolver cursos indebidos
  const course = await dao.getCourseById(injectionId);
  assert.strictEqual(course, null, 'Course search with injection string should return null');

  // reviewFlashcardSM2 no debe explotar con id malicioso
  await dao.reviewFlashcardSM2(injectionId, 5);

  // updateBookProgress con id que contenga comillas
  await dao.updateBookProgress("fake'id", 10, 100);
});

test('2.9 dao.updateBookProgress validates input, clamps pages, and updates resource status correctly', async () => {
  const books = await dao.getBooks();
  assert.ok(books.length > 0, 'Demo books must exist');
  const book = books[0];
  const total = book.page_count;

  // 1. Invalid totalPages rejects gracefully
  const invalidTotalRes = await dao.updateBookProgress(book.id, 10, 0);
  assert.strictEqual(invalidTotalRes.success, false);
  assert.ok(invalidTotalRes.error?.includes('páginas'));

  // 2. Set to 0 pages -> NOT_STARTED
  const zeroRes = await dao.updateBookProgress(book.id, 0, total);
  assert.strictEqual(zeroRes.success, true);
  let updated = (await dao.getBooks()).find(b => b.id === book.id);
  assert.strictEqual(updated?.current_page, 0);
  assert.strictEqual(updated?.reading_percentage, 0);
  assert.strictEqual(updated?.status, 'NOT_STARTED');

  // 3. Set below 0 clamps to 0 -> NOT_STARTED
  const negativeRes = await dao.updateBookProgress(book.id, -25, total);
  assert.strictEqual(negativeRes.success, true);
  updated = (await dao.getBooks()).find(b => b.id === book.id);
  assert.strictEqual(updated?.current_page, 0);
  assert.strictEqual(updated?.reading_percentage, 0);
  assert.strictEqual(updated?.status, 'NOT_STARTED');

  // 4. Set partial progress -> IN_PROGRESS
  const partialPage = Math.floor(total / 2);
  const partialRes = await dao.updateBookProgress(book.id, partialPage, total);
  assert.strictEqual(partialRes.success, true);
  updated = (await dao.getBooks()).find(b => b.id === book.id);
  assert.strictEqual(updated?.current_page, partialPage);
  const expectedPct = Math.round((partialPage / total) * 100);
  assert.strictEqual(updated?.reading_percentage, expectedPct);
  assert.strictEqual(updated?.status, 'IN_PROGRESS');

  // 5. Set completed (exact total) -> COMPLETED
  const completeRes = await dao.updateBookProgress(book.id, total, total);
  assert.strictEqual(completeRes.success, true);
  updated = (await dao.getBooks()).find(b => b.id === book.id);
  assert.strictEqual(updated?.current_page, total);
  assert.strictEqual(updated?.reading_percentage, 100);
  assert.strictEqual(updated?.status, 'COMPLETED');

  // 6. Set beyond total clamps to total -> COMPLETED
  const overflowRes = await dao.updateBookProgress(book.id, total + 500, total);
  assert.strictEqual(overflowRes.success, true);
  updated = (await dao.getBooks()).find(b => b.id === book.id);
  assert.strictEqual(updated?.current_page, total);
  assert.strictEqual(updated?.reading_percentage, 100);
  assert.strictEqual(updated?.status, 'COMPLETED');
});

test('2.10 domainLogic pure calculations for book progress and SM-2 work deterministically', async () => {
  const { calculateBookProgress, calculateSM2 } = await import('../src/services/domainLogic.ts');

  // Book progress pure calculations
  const invalid = calculateBookProgress(5, -1);
  assert.strictEqual(invalid.valid, false);

  const zero = calculateBookProgress(0, 100);
  assert.strictEqual(zero.valid, true);
  if (zero.valid) {
    assert.strictEqual(zero.data.clampedPage, 0);
    assert.strictEqual(zero.data.percentage, 0);
    assert.strictEqual(zero.data.status, 'NOT_STARTED');
  }

  const half = calculateBookProgress(50, 100);
  assert.strictEqual(half.valid, true);
  if (half.valid) {
    assert.strictEqual(half.data.clampedPage, 50);
    assert.strictEqual(half.data.percentage, 50);
    assert.strictEqual(half.data.status, 'IN_PROGRESS');
  }

  // SM-2 pure calculations
  const initial = { repetitionCount: 0, intervalDays: 1, easeFactor: 2.5 };
  const firstPass = calculateSM2(initial, 4);
  assert.strictEqual(firstPass.repetitionCount, 1);
  assert.strictEqual(firstPass.intervalDays, 1);

  const secondPass = calculateSM2(firstPass, 5);
  assert.strictEqual(secondPass.repetitionCount, 2);
  assert.strictEqual(secondPass.intervalDays, 6);

  const failPass = calculateSM2(secondPass, 2);
  assert.strictEqual(failPass.repetitionCount, 0);
  assert.strictEqual(failPass.intervalDays, 1);
  assert.ok(failPass.easeFactor >= 1.3);
});


