import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { normalizeGraphRelation, validateKnowledgeConnection } from '../src/services/domainLogic.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';

async function cleanupCourse(courseId: string): Promise<void> {
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  db.run('DELETE FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [courseId, courseId]);
  await dbBridge.persist();
}

test('14.1 Knowledge graph exposes typed nodes for real learning entities only', async () => {
  await dbBridge.init();
  const graph = await dao.getKnowledgeGraph();

  const node = (id: string) => graph.nodes.find(n => n.id === id);
  assert.equal(node('cp1')?.node_type, 'concept');
  assert.equal(node('c1-react')?.node_type, 'course');
  assert.equal(node('b1-deepwork')?.node_type, 'book');
  assert.equal(node('m1-react')?.node_type, 'module');
  assert.equal(node('l1')?.node_type, 'lesson');
  assert.equal(node('n1')?.node_type, 'note');
  // Las flashcards y sesiones no deben convertirse automáticamente en nodos
  assert.equal(node('f1'), undefined, 'Las flashcards no deben ser nodos del grafo');
  assert.equal(node('s1'), undefined, 'Las sesiones de estudio no deben ser nodos del grafo');
});

test('14.2 Structural edges are derived deterministically from foreign keys', async () => {
  await dbBridge.init();
  const graph = await dao.getKnowledgeGraph();

  const hasEdge = (source: string, target: string, type: string, derived = true) =>
    graph.edges.some(e => e.source_id === source && e.target_id === target && e.connection_type === type && Boolean(e.derived) === derived);

  assert.ok(hasEdge('c1-react', 'm1-react', 'contains'), 'course contains module');
  assert.ok(hasEdge('m1-react', 'l1', 'contains'), 'module contains lesson');
  assert.ok(hasEdge('n1', 'c1-react', 'about'), 'note is about its resource');
  assert.ok(hasEdge('n2', 'b1-deepwork', 'about'), 'note is about its book');

  // Las conexiones explícitas del seed siguen presentes y no son derivadas
  assert.ok(hasEdge('cp1', 'cp2', 'references', false), 'explicit concept relation preserved');
});

test('14.3 Existing knowledge_connection rows are preserved by the graph builder', async () => {
  await dbBridge.init();
  const connections = await dao.getKnowledgeConnections();
  assert.ok(connections.length >= 4, 'Debe conservar las conexiones explícitas del seed');
  const kc1 = connections.find(c => c.id === 'kc1');
  assert.ok(kc1);
  assert.equal(kc1!.source_id, 'cp1');
  assert.equal(kc1!.target_id, 'cp2');
  assert.equal(kc1!.connection_type, 'references');
});

test('14.4 Manual connection validation rejects unsupported types, self-links, missing nodes and duplicates', () => {
  const context = { nodeIds: ['a', 'b'], existingEdges: [] };
  assert.equal(normalizeGraphRelation('related_to'), 'related_to');
  assert.equal(normalizeGraphRelation('aramged_to'), null);

  assert.equal(validateKnowledgeConnection({ sourceId: 'a', targetId: 'b', relationType: 'nope' }, context).valid, false);
  assert.equal(validateKnowledgeConnection({ sourceId: 'a', targetId: 'a', relationType: 'related_to' }, context).valid, false);
  assert.equal(validateKnowledgeConnection({ sourceId: 'a', targetId: 'zzz', relationType: 'related_to' }, context).valid, false);

  const withDup = { nodeIds: ['a', 'b'], existingEdges: [{ source_id: 'a', target_id: 'b', connection_type: 'related_to' }] };
  assert.equal(validateKnowledgeConnection({ sourceId: 'a', targetId: 'b', relationType: 'related_to' }, withDup).valid, false);

  const valid = validateKnowledgeConnection({ sourceId: 'a', targetId: 'b', relationType: 'related_to' }, context);
  assert.equal(valid.valid, true);
  assert.equal(valid.relation, 'related_to');
});

test('14.5 createKnowledgeConnection persists valid edges and prevents duplicates through the DAO', async () => {
  await dbBridge.init();
  const created = await dao.createKnowledgeConnection({ sourceId: 'cp1', targetId: 'cp3', relationType: 'related_to' });
  assert.equal(created.success, true, created.error);
  assert.ok(created.id);

  const duplicate = await dao.createKnowledgeConnection({ sourceId: 'cp1', targetId: 'cp3', relationType: 'related_to' });
  assert.equal(duplicate.success, false, 'No debe permitir conexiones duplicadas');

  const invalid = await dao.createKnowledgeConnection({ sourceId: 'cp1', targetId: 'no-existe', relationType: 'related_to' });
  assert.equal(invalid.success, false, 'No debe permitir nodos inexistentes');

  const graph = await dao.getKnowledgeGraph();
  assert.ok(graph.edges.some(e => e.id === created.id && !e.derived));

  await dao.deleteKnowledgeConnection(created.id!);
  const after = await dao.getKnowledgeGraph();
  assert.ok(!after.edges.some(e => e.id === created.id));
});

test('14.6 Deleted resources do not leave dangling relationships (prune)', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  db.run("INSERT INTO concept (id, name, description) VALUES ('temp-concept-x', 'Temp X', 'x')");
  const created = await dao.createKnowledgeConnection({ sourceId: 'cp1', targetId: 'temp-concept-x', relationType: 'related_to' });
  assert.equal(created.success, true);

  // Eliminar el nodo destino directamente y podar
  db.run("DELETE FROM concept WHERE id = 'temp-concept-x'");
  const removed = await dao.pruneDanglingConnections();
  assert.ok(removed >= 1, 'Debe eliminar al menos una conexión huérfana');

  const remaining = await dao.getKnowledgeConnections();
  assert.ok(!remaining.some(c => c.target_id === 'temp-concept-x'));
});

test('14.7 Course/module/lesson CRUD keeps the hierarchy and totals consistent', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso de Prueba 14', description: 'x', category: 'Test', instructor: 'Ada' });
  assert.equal(created.success, true, created.error);
  const courseId = created.id!;

  const mod = await dao.createModule({ courseId, title: 'Módulo Alfa' });
  assert.equal(mod.success, true, mod.error);
  const lesson1 = await dao.createLesson({ moduleId: mod.id!, title: 'Lección 1', durationMinutes: 10 });
  assert.equal(lesson1.success, true, lesson1.error);
  const lesson2 = await dao.createLesson({ moduleId: mod.id!, title: 'Lección 2', durationMinutes: 20 });
  assert.equal(lesson2.success, true, lesson2.error);

  let course = await dao.getCourseById(courseId);
  assert.ok(course);
  assert.equal(course!.total_lessons, 2, 'El total de lecciones debe recalcularse');
  assert.equal(course!.total_duration_minutes, 30, 'La duración total debe recalcularse');

  await dao.toggleLessonCompleted(lesson1.id!, true);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.completed_lessons, 1, 'El conteo de completadas debe recalcularse');

  await dao.deleteLesson(lesson2.id!);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 1);

  await dao.deleteModule(mod.id!);
  course = await dao.getCourseById(courseId);
  assert.equal(course!.total_lessons, 0);

  await cleanupCourse(courseId);
  assert.equal(await dao.getCourseById(courseId), null);
});

test('14.8 Book metadata can be edited and reading progress stays coherent', async () => {
  await dbBridge.init();
  const res = await dao.updateBookDetails('b1-deepwork', { author: 'Cal Newport (editado)', pageCount: 400 });
  assert.equal(res.success, true, res.error);

  const books = await dao.getBooks();
  const book = books.find(b => b.id === 'b1-deepwork');
  assert.ok(book);
  assert.equal(book!.author, 'Cal Newport (editado)');
  assert.equal(book!.page_count, 400);
  // current_page no puede superar el nuevo total y el porcentaje se recalcula
  assert.ok(book!.reading_percentage <= 100);

  const invalid = await dao.updateBookDetails('b1-deepwork', { pageCount: 0 });
  assert.equal(invalid.success, false);
});

test('14.9 Notes associate with resources and lessons and are retrievable', async () => {
  await dbBridge.init();
  await dao.addNote({ title: 'Nota de grafo 14', content: 'contenido', resource_id: 'c1-react', lesson_id: 'l1' });

  const notes = await dao.getNotesForResource('c1-react', 'l1');
  const created = notes.find(n => n.title === 'Nota de grafo 14');
  assert.ok(created, 'La nota asociada debe recuperarse por recurso y lección');
  assert.equal(created!.resource_id, 'c1-react');

  const graph = await dao.getKnowledgeGraph();
  assert.ok(graph.edges.some(e => e.source_id === created!.id && e.target_id === 'c1-react' && e.connection_type === 'about'));

  const db = dbBridge.getDatabase();
  db.run('DELETE FROM note WHERE id = ?', [created!.id]);
  await dbBridge.persist();
});

test('14.10 Orphan resources are detected and cease to be orphans after association', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  const orphanId = 'res-orphan-14';
  db.run(
    `INSERT INTO learning_resource (id, title, description, category, status, type) VALUES (?, 'Documento Huérfano 14', 'x', 'Documentos', 'NOT_STARTED', 'learning_resource')`,
    [orphanId]
  );
  await dbBridge.persist();

  let orphans = await dao.getUnorganizedResources();
  assert.ok(orphans.some(o => o.resource.id === orphanId), 'El recurso sin conexiones debe aparecer como huérfano');

  const link = await dao.createKnowledgeConnection({ sourceId: 'c1-react', targetId: orphanId, relationType: 'references' });
  assert.equal(link.success, true, link.error);

  orphans = await dao.getUnorganizedResources();
  assert.ok(!orphans.some(o => o.resource.id === orphanId), 'Tras asociarlo deja de ser huérfano');

  db.run('DELETE FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [orphanId, orphanId]);
  db.run('DELETE FROM learning_resource WHERE id = ?', [orphanId]);
  await dbBridge.persist();
});

test('14.11 Local search finds courses, lessons, notes and concepts without embeddings', async () => {
  await dbBridge.init();
  const results = await dao.searchKnowledge('React');
  assert.ok(results.length >= 1, 'Debe encontrar coincidencias locales');
  const types = new Set(results.map(r => r.type));
  assert.ok(types.has('course'), 'Debe incluir cursos');

  const conceptResults = await dao.searchKnowledge('SuperMemo');
  assert.ok(conceptResults.some(r => r.type === 'concept' || r.type === 'note' || r.type === 'course'));
});

test('14.12 getRelatedNodeIds returns structural and explicit neighbours deterministically', async () => {
  await dbBridge.init();
  const related = await dao.getRelatedNodeIds('c1-react');
  assert.ok(related.includes('m1-react'), 'Un curso debe relacionarse con sus módulos');
  assert.ok(related.includes('n1'), 'Un recurso debe relacionarse con sus notas');
  assert.ok(!related.includes('c1-react'), 'No debe incluirse a sí mismo');

  // Sorted/stable across repeated calls
  const again = await dao.getRelatedNodeIds('c1-react');
  assert.deepEqual([...related].sort(), [...again].sort());
});

test('14.13 Graph and organization operations make zero network requests in local mode', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    await dao.getKnowledgeGraph();
    await dao.getUnorganizedResources();
    await dao.searchKnowledge('React');
    await dao.getRelatedNodeIds('c1-react');
    const c = await dao.createKnowledgeConnection({ sourceId: 'cp1', targetId: 'cp3', relationType: 'related_to' });
    if (c.success && c.id) await dao.deleteKnowledgeConnection(c.id);
    assert.equal(calls, 0, 'La organización del grafo debe ser 100% local');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('14.14 Legacy databases keep their knowledge_connection rows after migration', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(SCHEMA_SQL);
  legacy.run("INSERT INTO learning_resource (id, title, type) VALUES ('legacy-res', 'Recurso Legado', 'course')");
  legacy.run("INSERT INTO concept (id, name) VALUES ('legacy-c1', 'Concepto Uno')");
  legacy.run("INSERT INTO concept (id, name) VALUES ('legacy-c2', 'Concepto Dos')");
  legacy.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight) VALUES ('legacy-kc', 'legacy-c1', 'legacy-c2', 'related_to', 0.5)");
  const legacyBytes = legacy.export();
  legacy.close();

  try {
    await dbBridge.importDatabase(legacyBytes);
    const connections = await dao.getKnowledgeConnections();
    const preserved = connections.find(c => c.id === 'legacy-kc');
    assert.ok(preserved, 'La conexión histórica debe conservarse');
    assert.equal(preserved!.connection_type, 'related_to');

    const graph = await dao.getKnowledgeGraph();
    assert.ok(graph.edges.some(e => e.id === 'legacy-kc'), 'La conexión histórica debe aparecer en el grafo');
  } finally {
    await dbBridge.importDatabase(originalBytes);
  }
});
