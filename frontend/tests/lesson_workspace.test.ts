import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import { retrieveLocalContext } from '../src/lib/localRag/retrieval.ts';
import { createSemanticChunksFromResourcesAsync, computeSha256ContentHash } from '../src/lib/localEmbeddings/chunking.ts';
import { aiService } from '../src/ai/aiService.ts';
import {
  formatPlaybackTime,
  parseTimestampToSeconds,
  extractTimestampParts,
  parseInlineMarkdownTokens,
  filterCourseLessons,
  calculatePlaybackJump,
  resolveNextPlaybackSpeed,
  SUPPORTED_PLAYBACK_SPEEDS
} from '../src/services/domainLogic.ts';

async function cleanupCourse(courseId: string): Promise<void> {
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  db.run('DELETE FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [courseId, courseId]);
  await dbBridge.persist();
}

test('15.1 Lessons expose editable content persisted in SQLite (text/Markdown as data)', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Lección 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo 15' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección con contenido', content: 'Contenido inicial', durationMinutes: 12 });
  assert.equal(lesson.success, true, lesson.error);

  let row = await dao.getLessonById(lesson.id!);
  assert.ok(row);
  assert.equal(row!.content, 'Contenido inicial');
  assert.equal(row!.duration_minutes, 12);

  const upd = await dao.updateLesson(lesson.id!, { content: 'Contenido **actualizado**', title: 'Lección editada' });
  assert.equal(upd.success, true, upd.error);
  row = await dao.getLessonById(lesson.id!);
  assert.equal(row!.content, 'Contenido **actualizado**');
  assert.equal(row!.title, 'Lección editada');

  // El contenido también aparece en el curso cargado
  const course = await dao.getCourseById(courseId);
  const loadedLesson = course!.modules![0].lessons!.find(l => l.id === lesson.id);
  assert.equal(loadedLesson!.content, 'Contenido **actualizado**');

  await cleanupCourse(courseId);
});

test('15.2 updateLesson validates title and duration without corrupting data', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Validación 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Válido' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección válida', content: 'ok' });

  const badTitle = await dao.updateLesson(lesson.id!, { title: 'x' });
  assert.equal(badTitle.success, false);
  const badDuration = await dao.updateLesson(lesson.id!, { durationMinutes: -5 });
  assert.equal(badDuration.success, false);

  const row = await dao.getLessonById(lesson.id!);
  assert.equal(row!.title, 'Lección válida', 'Los datos no deben cambiar tras una validación fallida');
  assert.equal(row!.content, 'ok');

  await cleanupCourse(courseId);
});

test('15.3 Lesson ordering is deterministic and never duplicates positions', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Orden 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Orden' });
  const a = await dao.createLesson({ moduleId: mod.id!, title: 'Lección A' });
  const b = await dao.createLesson({ moduleId: mod.id!, title: 'Lección B' });
  const c = await dao.createLesson({ moduleId: mod.id!, title: 'Lección C' });

  const order = async () => {
    const course = await dao.getCourseById(courseId);
    return course!.modules![0].lessons!.map(l => l.id);
  };

  assert.deepEqual(await order(), [a.id, b.id, c.id]);

  // Bajar A -> B, A, C
  await dao.moveLesson(a.id!, 'down');
  assert.deepEqual(await order(), [b.id, a.id, c.id]);

  // Subir C -> B, C, A
  await dao.moveLesson(c.id!, 'up');
  assert.deepEqual(await order(), [b.id, c.id, a.id]);

  // Límites: no-op con error en los extremos
  const upFirst = await dao.moveLesson(b.id!, 'up');
  assert.equal(upFirst.success, false);
  const downLast = await dao.moveLesson(a.id!, 'down');
  assert.equal(downLast.success, false);

  // Posiciones normalizadas 1..N sin duplicados
  const db = dbBridge.getDatabase();
  const res = db.exec('SELECT order_index FROM lesson WHERE module_id = ? ORDER BY order_index', [mod.id]);
  const positions = res[0].values.map(v => Number(v[0]));
  assert.deepEqual(positions, [1, 2, 3]);

  await cleanupCourse(courseId);
});

test('15.4 Course totals stay consistent across create/edit/delete/reorder/complete', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Totales 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Totales' });
  const l1 = await dao.createLesson({ moduleId: mod.id!, title: 'L1', durationMinutes: 10 });
  const l2 = await dao.createLesson({ moduleId: mod.id!, title: 'L2', durationMinutes: 20 });

  let course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 2);
  assert.equal(course!.total_duration_minutes, 30);

  await dao.updateLesson(l1.id!, { durationMinutes: 15 });
  course = await dao.getCourseById(courseId);
  assert.equal(course!.total_duration_minutes, 35);

  await dao.moveLesson(l1.id!, 'down');
  course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 2, 'Reordenar no cambia los totales');

  await dao.toggleLessonCompleted(l1.id!, true);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.completed_lessons, 1);

  await dao.toggleLessonCompleted(l1.id!, false);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.completed_lessons, 0, 'Reabrir reduce el conteo de completadas');

  await dao.deleteLesson(l2.id!);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 1);
  assert.equal(course!.total_duration_minutes, 15);

  await cleanupCourse(courseId);
});

test('15.5 Lesson workspace aggregates content, notes, concepts and progress', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Workspace 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo WS' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección WS' });

  // Sin contenido, notas ni relaciones -> NOT_STARTED
  let ws = await dao.getLessonWorkspace(lesson.id!);
  assert.ok(ws);
  assert.equal(ws!.progress, 'NOT_STARTED');
  assert.equal(ws!.course?.id, courseId);
  assert.equal(ws!.module?.title, 'Módulo WS');

  // Con contenido -> IN_PROGRESS
  await dao.updateLesson(lesson.id!, { content: 'Contenido de la lección' });
  ws = await dao.getLessonWorkspace(lesson.id!);
  assert.ok(ws!.lesson.content && ws!.lesson.content.length > 0);
  assert.equal(ws!.progress, 'IN_PROGRESS');

  // Nota asociada + concepto relacionado
  await dao.addNote({ title: 'Nota WS', content: 'x', resource_id: courseId, lesson_id: lesson.id });
  await dao.createKnowledgeConnection({ sourceId: lesson.id!, targetId: 'cp1', relationType: 'discusses' });

  ws = await dao.getLessonWorkspace(lesson.id!);
  assert.ok(ws!.notes.some(n => n.title === 'Nota WS'), 'La nota aparece en el workspace');
  assert.ok(ws!.concepts.some(c => c.id === 'cp1'), 'El concepto aparece en el workspace');

  await dao.toggleLessonCompleted(lesson.id!, true);
  ws = await dao.getLessonWorkspace(lesson.id!);
  assert.equal(ws!.progress, 'COMPLETED');

  await cleanupCourse(courseId);
});

test('15.6 getNextLessonForCourse returns the first incomplete lesson deterministically', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Continuar 15', category: 'Test' });
  const courseId = created.id!;
  const m1 = await dao.createModule({ courseId, title: 'Módulo 1' });
  const m2 = await dao.createModule({ courseId, title: 'Módulo 2' });
  const a = await dao.createLesson({ moduleId: m1.id!, title: 'Lección A' });
  const b = await dao.createLesson({ moduleId: m1.id!, title: 'Lección B' });
  const c = await dao.createLesson({ moduleId: m2.id!, title: 'Lección C' });

  let next = await dao.getNextLessonForCourse(courseId);
  assert.equal(next!.lesson.id, a.id, 'Primera lección incompleta por orden');
  assert.equal(next!.allCompleted, false);

  await dao.toggleLessonCompleted(a.id!, true);
  next = await dao.getNextLessonForCourse(courseId);
  assert.equal(next!.lesson.id, b.id);

  await dao.toggleLessonCompleted(b.id!, true);
  await dao.toggleLessonCompleted(c.id!, true);
  next = await dao.getNextLessonForCourse(courseId);
  assert.equal(next!.allCompleted, true, 'Con todo completado marca allCompleted');
  assert.equal(next!.lesson.id, c.id, 'Devuelve la última lección determinísticamente');

  await cleanupCourse(courseId);
});

test('15.7 Lesson content participates in local lexical retrieval (lesson scope)', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso RAG 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo RAG' });
  const lesson = await dao.createLesson({
    moduleId: mod.id!,
    title: 'Lección RAG',
    content: 'El teorema de Pitágoras relaciona los catetos con la hipotenusa en un triángulo rectángulo.'
  });

  const result = await retrieveLocalContext('teorema de Pitágoras', 4, { resourceId: courseId, lessonId: lesson.id! });
  assert.ok(result.documents.some(d => d.id === lesson.id && d.sourceType === 'lesson'), 'El contenido de la lección debe recuperarse');

  await cleanupCourse(courseId);
});

test('15.8 Editing lesson content changes only that lesson chunk hash (incremental invalidation)', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const buildChunks = async () => {
    const resources = await dao.getAllLearningResources();
    return createSemanticChunksFromResourcesAsync(resources);
  };

  const before = await buildChunks();
  const beforeLesson = before.find(c => c.chunkId === 'lesson_l1');
  const beforeOther = before.find(c => c.chunkId === 'lesson_l2');
  assert.ok(beforeLesson && beforeOther);

  const originalContent = (await dao.getLessonById('l1'))!.content;
  try {
    await dao.updateLesson('l1', { content: 'Contenido completamente nuevo para invalidar el hash.' });
    const after = await buildChunks();
    const afterLesson = after.find(c => c.chunkId === 'lesson_l1');
    const afterOther = after.find(c => c.chunkId === 'lesson_l2');

    assert.notEqual(afterLesson!.contentHash, beforeLesson!.contentHash, 'El hash de la lección editada cambia');
    assert.equal(afterOther!.contentHash, beforeOther!.contentHash, 'Otras lecciones no se invalidan');
  } finally {
    await dao.updateLesson('l1', { content: originalContent ?? '' });
    db.run('SELECT 1');
    await dbBridge.persist();
  }
});

test('15.9 SHA-256 lesson content hash is deterministic', async () => {
  const h1 = await computeSha256ContentHash('Lección: Álgebra lineal');
  const h2 = await computeSha256ContentHash('Lección: Álgebra lineal');
  const h3 = await computeSha256ContentHash('Lección: Álgebra lineal ');
  assert.equal(h1, h2);
  assert.notEqual(h1, h3);
  assert.equal(h1.length, 64);
});

test('15.10 Lesson-scoped generation remains fully offline (no network)', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    const fc = await aiService.generateFlashcards({ count: 3, difficulty: 'medium', topic: 'Virtual DOM', resourceId: 'c1-react', lessonId: 'l1' });
    const q = await aiService.generatePracticeQuestions({ count: 3, difficulty: 'medium', topic: 'Virtual DOM', resourceId: 'c1-react', lessonId: 'l1' });
    assert.ok(Array.isArray(fc.cards));
    assert.ok(Array.isArray(q.questions));
    assert.equal(calls, 0, 'La generación con ámbito de lección no debe usar la red');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('15.11 Legacy databases gain the lesson content column without losing data', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  // Esquema legado SIN la columna content
  legacy.run(SCHEMA_SQL.replace('  content TEXT,\n', ''));
  legacy.run("INSERT INTO learning_resource (id, title, type) VALUES ('legacy-course-15', 'Curso Legado 15', 'course')");
  legacy.run("INSERT INTO course (id, instructor, difficulty) VALUES ('legacy-course-15', 'Ada', 'BEGINNER')");
  legacy.run("INSERT INTO module (id, course_id, title) VALUES ('legacy-mod-15', 'legacy-course-15', 'M')");
  legacy.run("INSERT INTO lesson (id, module_id, title, order_index) VALUES ('legacy-les-15', 'legacy-mod-15', 'Lección Legada', 1)");
  const legacyBytes = legacy.export();
  legacy.close();

  try {
    await dbBridge.importDatabase(legacyBytes);
    const lesson = await dao.getLessonById('legacy-les-15');
    assert.ok(lesson, 'La lección histórica debe conservarse');
    assert.equal(lesson!.title, 'Lección Legada');

    const upd = await dao.updateLesson('legacy-les-15', { content: 'Contenido añadido tras migrar' });
    assert.equal(upd.success, true, upd.error);
    const updated = await dao.getLessonById('legacy-les-15');
    assert.equal(updated!.content, 'Contenido añadido tras migrar');
  } finally {
    await dbBridge.importDatabase(originalBytes);
  }
});

test('15.12 Deleting a module cascades its lessons and keeps connections clean', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Borrado 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Borrado' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Borrada' });
  await dao.createKnowledgeConnection({ sourceId: lesson.id!, targetId: 'cp1', relationType: 'discusses' });

  await dao.deleteModule(mod.id!);

  assert.equal(await dao.getLessonById(lesson.id!), null, 'Las lecciones del módulo se eliminan');
  const connections = await dao.getKnowledgeConnections();
  assert.ok(!connections.some(c => c.source_id === lesson.id || c.target_id === lesson.id), 'No quedan conexiones colgantes');

  const course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 0);

  await cleanupCourse(courseId);
});

test('15.13 Lesson workspace queries make zero network requests', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    await dao.getLessonWorkspace('l1');
    await dao.getNextLessonForCourse('c1-react');
    await dao.moveLesson('l1', 'down');
    await dao.moveLesson('l1', 'up');
    assert.equal(calls, 0, 'El espacio de trabajo de la lección debe ser 100% local');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('15.14 CourseDetail hosts the LessonWorkspace without duplicating lesson detail logic', async () => {
  const { readFileSync } = await import('node:fs');
  const courseDetail = readFileSync(new URL('../src/pages/CourseDetail.tsx', import.meta.url), 'utf8');
  assert.ok(courseDetail.includes('LessonWorkspace'), 'CourseDetail debe usar el componente de espacio de trabajo');
  assert.ok(!courseDetail.includes('window.confirm'), 'Sin diálogos nativos');

  const workspace = readFileSync(new URL('../src/components/lesson/LessonWorkspace.tsx', import.meta.url), 'utf8');
  for (const label of ['Estudiar esta lección', 'Repasar flashcards', 'Preguntas de práctica', 'Explicar esta lección', 'Generar flashcards']) {
    assert.ok(workspace.includes(label), `El workspace debe exponer la acción "${label}"`);
  }
  assert.ok(workspace.includes('Aprendizaje relacionado'), 'Debe incluir el panel de aprendizaje relacionado');
  assert.ok(workspace.includes('Continuar'), 'Debe incluir la acción de continuación');
});

test('15.15 Lesson workspace notes and progress stay isolated per lesson (regression)', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Aislamiento 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo Aislamiento' });
  const lessonA = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Aislamiento A' });
  const lessonB = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Aislamiento B' });
  const lessonC = await dao.createLesson({ moduleId: mod.id!, title: 'Lección Aislamiento C' });

  await dao.addNote({ title: 'Nota de A', content: 'contenido A', resource_id: courseId, lesson_id: lessonA.id });
  await dao.addNote({ title: 'Nota de B', content: 'contenido B', resource_id: courseId, lesson_id: lessonB.id });
  await dao.addNote({ title: 'Nota del curso', content: 'contenido curso', resource_id: courseId });

  // Cada lección solo ve SUS notas: ni las de lecciones hermanas (mismo
  // resource_id) ni la nota general del curso.
  const wsA = await dao.getLessonWorkspace(lessonA.id!);
  assert.equal(wsA!.notes.length, 1, 'La lección A solo ve su propia nota');
  assert.equal(wsA!.notes[0].title, 'Nota de A');

  const wsB = await dao.getLessonWorkspace(lessonB.id!);
  assert.equal(wsB!.notes.length, 1, 'La lección B solo ve su propia nota');
  assert.equal(wsB!.notes[0].title, 'Nota de B');

  // Regresión del defecto confirmado: la nota de una lección hermana o la nota
  // del curso NO pueden marcar progreso en una lección sin actividad propia.
  const wsC = await dao.getLessonWorkspace(lessonC.id!);
  assert.equal(wsC!.notes.length, 0, 'La lección C no hereda notas ajenas');
  assert.equal(wsC!.progress, 'NOT_STARTED', 'El progreso no puede contarse con notas de otras lecciones');

  // La propia nota sí activa el estado legítimo de la lección A.
  assert.equal(wsA!.progress, 'IN_PROGRESS', 'La nota propia de A cuenta como actividad propia');

  // Consultas de nota: acotado estricto por lección cuando se especifica ámbito.
  const scopedA = await dao.getNotesForResource(courseId, lessonA.id!);
  assert.equal(scopedA.length, 1, 'getNotesForResource con ámbito de lección no debe filtrar por resource_id');
  assert.equal(scopedA[0].title, 'Nota de A');

  const onlyLessonA = await dao.getNotesForLesson(lessonA.id!);
  assert.equal(onlyLessonA.length, 1);
  assert.equal(onlyLessonA[0].title, 'Nota de A');

  // Sin ámbito de lección el listado por recurso sigue siendo el alcance del curso.
  const courseScoped = await dao.getNotesForResource(courseId);
  assert.equal(courseScoped.length, 3, 'El listado a nivel de recurso conserva su alcance de curso');

  // Limpieza explícita para no dejar notas huérfanas en otras pruebas.
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM note WHERE title IN (?, ?, ?)', ['Nota de A', 'Nota de B', 'Nota del curso']);
  await dbBridge.persist();
  await cleanupCourse(courseId);
});

test('15.8 Video playback formatting, timestamp parsing and interactive note segment extraction', () => {
  // formatPlaybackTime
  assert.equal(formatPlaybackTime(0), '00:00');
  assert.equal(formatPlaybackTime(75), '01:15');
  assert.equal(formatPlaybackTime(3665), '01:01:05');
  assert.equal(formatPlaybackTime(-10), '00:00');
  assert.equal(formatPlaybackTime(NaN), '00:00');

  // parseTimestampToSeconds
  assert.equal(parseTimestampToSeconds('01:15'), 75);
  assert.equal(parseTimestampToSeconds('1:15'), 75);
  assert.equal(parseTimestampToSeconds('[01:15]'), 75);
  assert.equal(parseTimestampToSeconds('01:01:05'), 3665);
  assert.equal(parseTimestampToSeconds('[01:01:05]'), 3665);
  assert.equal(parseTimestampToSeconds('01:65'), null, 'Segundos >= 60 deben ser rechazados');
  assert.equal(parseTimestampToSeconds('invalido'), null);
  assert.equal(parseTimestampToSeconds(''), null);

  // extractTimestampParts
  const plain = extractTimestampParts('Nota simple sin marcas de tiempo');
  assert.equal(plain.length, 1);
  assert.equal(plain[0].isTimestamp, false);

  const mixed = extractTimestampParts('Ver explicación en [02:30] y luego repasar [01:15:00] al final.');
  assert.equal(mixed.length, 5);
  assert.equal(mixed[0].text, 'Ver explicación en ');
  assert.equal(mixed[0].isTimestamp, false);
  assert.equal(mixed[1].text, '[02:30]');
  assert.equal(mixed[1].isTimestamp, true);
  assert.equal(mixed[1].seconds, 150);
  assert.equal(mixed[1].rawTimestamp, '02:30');
  assert.equal(mixed[2].text, ' y luego repasar ');
  assert.equal(mixed[2].isTimestamp, false);
  assert.equal(mixed[3].text, '[01:15:00]');
  assert.equal(mixed[3].isTimestamp, true);
  assert.equal(mixed[3].seconds, 4500);
  assert.equal(mixed[4].text, ' al final.');
  assert.equal(mixed[4].isTimestamp, false);
});

test('15.9 dao.deleteNote removes notes from SQLite with clean persistence', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Test Notas Delete', category: 'Test' });
  const courseId = created.id!;

  await dao.addNote({ title: 'Nota Borrable', content: 'Contenido a eliminar', resource_id: courseId });
  let notes = await dao.getNotesForResource(courseId);
  assert.equal(notes.length, 1);
  const noteId = notes[0].id;

  const deleted = await dao.deleteNote(noteId);
  assert.equal(deleted, true);

  notes = await dao.getNotesForResource(courseId);
  assert.equal(notes.length, 0, 'La nota debe haber sido eliminada de la base de datos');

  await cleanupCourse(courseId);
});

test('15.10 parseInlineMarkdownTokens parses code, bold, italic and timestamps into tokens', () => {
  const tokens = parseInlineMarkdownTokens('Texto con **negrita**, *cursiva*, `codigo` y marca [01:30] al final.');
  
  const boldToken = tokens.find(t => t.type === 'bold');
  assert.ok(boldToken);
  assert.equal(boldToken!.content, 'negrita');

  const italicToken = tokens.find(t => t.type === 'italic');
  assert.ok(italicToken);
  assert.equal(italicToken!.content, 'cursiva');

  const codeToken = tokens.find(t => t.type === 'code');
  assert.ok(codeToken);
  assert.equal(codeToken!.content, 'codigo');

  const tsToken = tokens.find(t => t.type === 'timestamp');
  assert.ok(tsToken);
  assert.equal(tsToken!.content, '01:30');
  assert.equal(tsToken!.seconds, 90);
});

test('15.11 filterCourseLessons: Filters modules and lessons by title or content with accurate counters', () => {
  const sampleModules = [
    {
      id: 'm1',
      course_id: 'c1',
      title: 'Fundamentos de React',
      order_index: 1,
      lessons: [
        { id: 'l1', module_id: 'm1', title: 'Componentes Funcionales', content: 'Uso de funciones puras', order_index: 1, duration_minutes: 10, lesson_type: 'VIDEO' as const, is_completed: true },
        { id: 'l2', module_id: 'm1', title: 'Hooks Básicos', content: 'useState y useEffect', order_index: 2, duration_minutes: 15, lesson_type: 'VIDEO' as const, is_completed: false }
      ]
    },
    {
      id: 'm2',
      course_id: 'c1',
      title: 'Arquitectura de Estado',
      order_index: 2,
      lessons: [
        { id: 'l3', module_id: 'm2', title: 'Context API', content: 'Evitar prop drilling', order_index: 1, duration_minutes: 20, lesson_type: 'VIDEO' as const, is_completed: false },
        { id: 'l4', module_id: 'm2', title: 'Zustand y Redux', content: 'Gestores globales', order_index: 2, duration_minutes: 25, lesson_type: 'VIDEO' as const, is_completed: false }
      ]
    }
  ];

  // 1. Consulta vacía -> todos los módulos y lecciones
  const empty = filterCourseLessons(sampleModules, '');
  assert.equal(empty.filteredModules.length, 2);
  assert.equal(empty.totalMatchingLessons, 4);

  // 2. Coincidencia por título de lección ('hooks')
  const hooks = filterCourseLessons(sampleModules, 'hooks');
  assert.equal(hooks.filteredModules.length, 1);
  assert.equal(hooks.totalMatchingLessons, 1);
  assert.equal(hooks.filteredModules[0].lessons![0].id, 'l2');

  // 3. Coincidencia por contenido de lección ('prop drilling')
  const propDrilling = filterCourseLessons(sampleModules, 'prop drilling');
  assert.equal(propDrilling.filteredModules.length, 1);
  assert.equal(propDrilling.totalMatchingLessons, 1);
  assert.equal(propDrilling.filteredModules[0].lessons![0].id, 'l3');

  // 4. Coincidencia por título de módulo ('Arquitectura') -> incluye todas las lecciones de ese módulo
  const arch = filterCourseLessons(sampleModules, 'Arquitectura');
  assert.equal(arch.filteredModules.length, 1);
  assert.equal(arch.totalMatchingLessons, 2);

  // 5. Sin coincidencias
  const none = filterCourseLessons(sampleModules, 'inexistente 999');
  assert.equal(none.filteredModules.length, 0);
  assert.equal(none.totalMatchingLessons, 0);
});

test('15.12 calculatePlaybackJump: Clamps jumps within valid bounds [0, duration]', () => {
  const duration = 120; // 2 minutos

  // 1. Salto hacia adelante estándar (+10s)
  assert.equal(calculatePlaybackJump(45, 10, duration), 55);

  // 2. Salto hacia atrás estándar (-10s)
  assert.equal(calculatePlaybackJump(45, -10, duration), 35);

  // 3. Salto hacia atrás cerca del inicio -> clamped a 0
  assert.equal(calculatePlaybackJump(5, -10, duration), 0);
  assert.equal(calculatePlaybackJump(0, -10, duration), 0);

  // 4. Salto hacia adelante cerca del final -> clamped a duration
  assert.equal(calculatePlaybackJump(115, 10, duration), 120);
  assert.equal(calculatePlaybackJump(120, 10, duration), 120);

  // 5. Entradas inválidas o infinitas
  assert.equal(calculatePlaybackJump(NaN, 10, duration), 10);
  assert.equal(calculatePlaybackJump(-20, 10, duration), 10);
  assert.equal(calculatePlaybackJump(50, 10, Infinity), 60);
});

test('15.13 resolveNextPlaybackSpeed: Steps through supported speeds without overflowing bounds', () => {
  assert.deepEqual(SUPPORTED_PLAYBACK_SPEEDS, [0.75, 1, 1.25, 1.5, 1.75, 2]);

  // 1. Incrementar velocidades
  assert.equal(resolveNextPlaybackSpeed(0.75, 'increase'), 1);
  assert.equal(resolveNextPlaybackSpeed(1, 'increase'), 1.25);
  assert.equal(resolveNextPlaybackSpeed(1.25, 'increase'), 1.5);
  assert.equal(resolveNextPlaybackSpeed(1.5, 'increase'), 1.75);
  assert.equal(resolveNextPlaybackSpeed(1.75, 'increase'), 2);
  // Al límite máximo no sube más
  assert.equal(resolveNextPlaybackSpeed(2, 'increase'), 2);

  // 2. Decrementar velocidades
  assert.equal(resolveNextPlaybackSpeed(2, 'decrease'), 1.75);
  assert.equal(resolveNextPlaybackSpeed(1.75, 'decrease'), 1.5);
  assert.equal(resolveNextPlaybackSpeed(1.5, 'decrease'), 1.25);
  assert.equal(resolveNextPlaybackSpeed(1.25, 'decrease'), 1);
  assert.equal(resolveNextPlaybackSpeed(1, 'decrease'), 0.75);
  // Al límite mínimo no baja más
  assert.equal(resolveNextPlaybackSpeed(0.75, 'decrease'), 0.75);

  // 3. Valores atípicos / intermedios
  assert.equal(resolveNextPlaybackSpeed(1.1, 'increase'), 1.25);
  assert.equal(resolveNextPlaybackSpeed(1.1, 'decrease'), 1);
});

test('15.14 Flashcard CRUD with lesson_id: Creates, queries, updates and deletes lesson flashcards', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Flashcards 15', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo FC' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección FC', durationMinutes: 10 });
  const lessonId = lesson.id!;

  // 1. Crear tarjeta con validación
  const emptyRes = await dao.createFlashcard({ resource_id: courseId, lesson_id: lessonId, front: '', back: 'algo' });
  assert.equal(emptyRes.success, false);

  const cardRes = await dao.createFlashcard({
    resource_id: courseId,
    lesson_id: lessonId,
    front: '¿Qué es el algoritmo SM-2?',
    back: 'Un algoritmo de repetición espaciada basado en factor de facilidad e intervalos crecientes.'
  });
  assert.equal(cardRes.success, true);
  assert.ok(cardRes.id);

  // 2. Obtener tarjetas de la lección
  const cards = await dao.getFlashcardsForLesson(lessonId);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].front, '¿Qué es el algoritmo SM-2?');
  assert.equal(cards[0].lesson_id, lessonId);
  assert.equal(cards[0].resource_id, courseId);
  assert.equal(cards[0].interval_days, 1);
  assert.equal(cards[0].ease_factor, 2.5);

  // 3. Actualizar tarjeta
  const updRes = await dao.updateFlashcard(cards[0].id, {
    front: '¿Qué es el algoritmo SuperMemo-2 (SM-2)?',
    back: 'Algoritmo de cálculo de intervalos para repetición espaciada.'
  });
  assert.equal(updRes.success, true);

  const updatedCards = await dao.getFlashcardsForLesson(lessonId);
  assert.equal(updatedCards[0].front, '¿Qué es el algoritmo SuperMemo-2 (SM-2)?');

  // 4. Eliminar tarjeta
  const delRes = await dao.deleteFlashcard(cards[0].id);
  assert.equal(delRes.success, true);
  const remaining = await dao.getFlashcardsForLesson(lessonId);
  assert.equal(remaining.length, 0);

  await cleanupCourse(courseId);
});

test('15.15 getLessonWorkspace includes lesson flashcards and tracks progress activity', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Workspace FC', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo WFC' });
  const lesson = await dao.createLesson({ moduleId: mod.id!, title: 'Lección WFC', durationMinutes: 10 });
  const lessonId = lesson.id!;

  // Inicialmente sin contenido, notas ni tarjetas -> NOT_STARTED
  let ws = await dao.getLessonWorkspace(lessonId);
  assert.ok(ws);
  assert.equal(ws.progress, 'NOT_STARTED');
  assert.equal(ws.flashcards?.length, 0);

  // Añadir una tarjeta a la lección -> progress pasa a IN_PROGRESS
  await dao.createFlashcard({
    resource_id: courseId,
    lesson_id: lessonId,
    front: 'Pregunta de prueba',
    back: 'Respuesta de prueba'
  });

  ws = await dao.getLessonWorkspace(lessonId);
  assert.ok(ws);
  assert.equal(ws.flashcards?.length, 1);
  assert.equal(ws.flashcards![0].front, 'Pregunta de prueba');
  assert.equal(ws.progress, 'IN_PROGRESS');

  await cleanupCourse(courseId);
});
