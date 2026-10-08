import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import {
  resolveSearchResultDestination,
  resolveGraphNodeDestination,
  describeDestructiveAction
} from '../src/services/domainLogic.ts';
import { initialStudySessionState, studySessionReducer } from '../src/services/studySession.ts';
import { aiService } from '../src/ai/aiService.ts';

async function removeSession(sessionId: string): Promise<void> {
  const db = dbBridge.getDatabase();
  db.run('DELETE FROM learning_session WHERE id = ?', [sessionId]);
  await dbBridge.persist();
}

test('15.1 resolveSearchResultDestination maps every searchable type to a deterministic destination', () => {
  assert.deepEqual(resolveSearchResultDestination({ id: 'c1', type: 'course', title: 'C', resourceId: 'c1' }), { tab: 'course', resourceId: 'c1' });
  assert.deepEqual(resolveSearchResultDestination({ id: 'b1', type: 'book', title: 'B', resourceId: 'b1' }), { tab: 'resource', resourceId: 'b1' });
  assert.deepEqual(resolveSearchResultDestination({ id: 'r1', type: 'resource', title: 'R', resourceId: 'r1' }), { tab: 'resource', resourceId: 'r1' });
  assert.deepEqual(resolveSearchResultDestination({ id: 'l1', type: 'lesson', title: 'L', resourceId: 'c1', lessonId: 'l1' }), { tab: 'course', resourceId: 'c1', lessonId: 'l1' });
  assert.deepEqual(resolveSearchResultDestination({ id: 'n1', type: 'note', title: 'N' }), { tab: 'note', noteId: 'n1' });
  assert.deepEqual(resolveSearchResultDestination({ id: 'cp1', type: 'concept', title: 'Cpto' }), { tab: 'concept', conceptId: 'cp1' });
});

test('15.2 resolveGraphNodeDestination covers every node type (modules open through their course)', () => {
  assert.deepEqual(resolveGraphNodeDestination({ id: 'c1', node_type: 'course' }), { tab: 'course', resourceId: 'c1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'b1', node_type: 'book' }), { tab: 'resource', resourceId: 'b1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'r1', node_type: 'resource' }), { tab: 'resource', resourceId: 'r1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'l1', node_type: 'lesson', meta: { course_id: 'c1' } }), { tab: 'course', resourceId: 'c1', lessonId: 'l1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'n1', node_type: 'note' }), { tab: 'note', noteId: 'n1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'cp1', node_type: 'concept' }), { tab: 'concept', conceptId: 'cp1' });
  assert.deepEqual(resolveGraphNodeDestination({ id: 'm1', node_type: 'module', meta: { course_id: 'c1' } }), { tab: 'course', resourceId: 'c1' });
});

test('15.3 describeDestructiveAction states the consequence honestly and marks irreversible actions', () => {
  for (const action of ['delete-course', 'delete-module', 'delete-lesson', 'delete-connection'] as const) {
    const d = describeDestructiveAction(action, 'Elemento X');
    assert.ok(d.title.length > 0);
    assert.ok(d.consequence.includes('Elemento X'));
    assert.equal(d.reversible, false);
    assert.ok(d.confirmLabel.length > 0);
  }
});

test('15.4 getResourceDetail(book) returns metadata and related knowledge without the full graph', async () => {
  await dbBridge.init();
  const detail = await dao.getResourceDetail('b1-deepwork');
  assert.ok(detail);
  assert.equal(detail!.kind, 'book');
  assert.equal(detail!.resource.title, 'Deep Work: Rules for Focused Success');
  assert.ok(detail!.book);
  assert.ok((detail!.book!.author || '').includes('Cal Newport'));
  assert.ok(detail!.book!.page_count > 0);
  assert.ok(detail!.fragments.some(f => f.id === 'n2'), 'Las notas del libro aparecen como fragmentos');
  assert.ok(detail!.related.some(r => r.id === 'n2' && r.type === 'note'), 'La nota se lista como relacionada');
});

test('15.5 getResourceDetail(imported resource) exposes source metadata and extracted fragments', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();
  db.run(
    `INSERT INTO learning_resource (id, title, description, category, status, source_path, type)
     VALUES ('doc-test-15', 'Documento de Prueba 15', 'desc', 'Documentos', 'NOT_STARTED', 'local://test15.pdf#sha256=abc123', 'learning_resource')`
  );
  db.run(
    `INSERT INTO note (id, resource_id, title, content, tags)
     VALUES ('note-test-15-1', 'doc-test-15', 'Fragmento 1', 'contenido extraido del documento', 'documento,pdf,sha256:abc123')`
  );
  await dbBridge.persist();

  try {
    const detail = await dao.getResourceDetail('doc-test-15');
    assert.ok(detail);
    assert.equal(detail!.kind, 'resource');
    assert.equal(detail!.source?.fileName, 'test15.pdf');
    assert.equal(detail!.source?.fingerprint, 'abc123');
    assert.equal(detail!.fragments.length, 1);
    assert.equal(detail!.fragments[0].content, 'contenido extraido del documento');
  } finally {
    db.run('DELETE FROM note WHERE id = ?', ['note-test-15-1']);
    db.run('DELETE FROM learning_resource WHERE id = ?', ['doc-test-15']);
    await dbBridge.persist();
  }
});

test('15.6 getResourceDetail(concept) resolves the concept and its explicit relations', async () => {
  await dbBridge.init();
  const detail = await dao.getResourceDetail('cp1');
  assert.ok(detail);
  assert.equal(detail!.kind, 'concept');
  assert.equal(detail!.resource.title, 'React 18');
  assert.ok(detail!.related.some(r => r.id === 'cp2' && r.relation === 'references'));
  assert.ok(detail!.related.some(r => r.id === 'cp3' && r.relation === 'requires'));
});

test('15.7 resolveNodeKind identifies every openable node type and rejects unknown ids', async () => {
  await dbBridge.init();
  assert.equal(await dao.resolveNodeKind('c1-react'), 'course');
  assert.equal(await dao.resolveNodeKind('b1-deepwork'), 'book');
  assert.equal(await dao.resolveNodeKind('cp1'), 'concept');
  assert.equal(await dao.resolveNodeKind('l1'), 'lesson');
  assert.equal(await dao.resolveNodeKind('n1'), 'note');
  assert.equal(await dao.resolveNodeKind('m1-react'), 'module');
  assert.equal(await dao.resolveNodeKind('no-existe-15'), null);
});

test('15.8 getRelatedKnowledge combines explicit and structural relations without inventing any', async () => {
  await dbBridge.init();
  const courseRelated = await dao.getRelatedKnowledge('c1-react');
  assert.ok(courseRelated.some(r => r.id === 'm1-react' && r.type === 'module'), 'curso contiene módulos');
  assert.ok(courseRelated.some(r => r.id === 'n1' && r.type === 'note'), 'curso tiene notas');

  const lessonRelated = await dao.getRelatedKnowledge('l1');
  assert.ok(lessonRelated.some(r => r.id === 'm1-react' && r.type === 'module'), 'lección pertenece a un módulo');
  assert.ok(lessonRelated.some(r => r.id === 'c1-react' && r.type === 'course'), 'lección pertenece a un curso');

  const types = new Set(courseRelated.map(r => r.type));
  assert.ok(!types.has('flashcard' as any), 'las flashcards nunca se inventan como relaciones');
});

test('15.9 startStudySession persists the lesson scope and history identifies what was studied', async () => {
  await dbBridge.init();
  const sid = await dao.startStudySession({ mode: 'mixed', resourceId: 'c1-react', lessonId: 'l1' });
  try {
    const row = await dao.getStudySessionById(sid);
    assert.ok(row);
    assert.equal(row!.lesson_id, 'l1');
    assert.equal(row!.resource_id, 'c1-react');
    assert.equal(row!.lesson_title, '01. Introducción al Virtual DOM y Fiber');
  } finally {
    await removeSession(sid);
  }
});

test('15.10 Study session reducer carries the lesson scope through its lifecycle', () => {
  const starting = studySessionReducer(initialStudySessionState, { type: 'START_REQUESTED', mode: 'practice', resourceId: 'c1-react', lessonId: 'l1' });
  assert.equal(starting.phase, 'starting');
  assert.equal(starting.lessonId, 'l1');
  assert.equal(starting.resourceId, 'c1-react');

  const active = studySessionReducer(starting, { type: 'STARTED', sessionId: 's-15', startedAt: Date.now() });
  assert.equal(active.phase, 'active');
  assert.equal(active.lessonId, 'l1');

  const resumed = studySessionReducer(initialStudySessionState, { type: 'RESUMED', sessionId: 's-15', mode: 'mixed', resourceId: 'c1-react', lessonId: 'l1', startedAt: Date.now() });
  assert.equal(resumed.lessonId, 'l1');
});

test('15.11 Lesson-scoped study generation stays fully offline (no network)', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    const fc = await aiService.generateFlashcards({ count: 3, difficulty: 'medium', topic: 'React', resourceId: 'c1-react', lessonId: 'l1' });
    const q = await aiService.generatePracticeQuestions({ count: 3, difficulty: 'medium', topic: 'React', resourceId: 'c1-react', lessonId: 'l1' });
    assert.ok(Array.isArray(fc.cards));
    assert.ok(Array.isArray(q.questions));
    assert.equal(calls, 0, 'El ámbito de lección no debe introducir peticiones de red');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('15.12 CourseDetail uses the accessible dialog instead of window.confirm', () => {
  const courseDetail = readFileSync(new URL('../src/pages/CourseDetail.tsx', import.meta.url), 'utf8');
  assert.ok(!courseDetail.includes('window.confirm'), 'No debe quedar window.confirm en CourseDetail');
  assert.ok(courseDetail.includes('ConfirmDialog'), 'Debe usar el diálogo reutilizable');

  const dialog = readFileSync(new URL('../src/components/common/ConfirmDialog.tsx', import.meta.url), 'utf8');
  assert.ok(dialog.includes('role="dialog"'));
  assert.ok(dialog.includes('aria-modal'));
  assert.ok(dialog.includes('aria-labelledby'));
  assert.ok(dialog.includes("e.key === 'Escape'"));
});

test('15.13 Restored backups with dangling connections are excluded from the graph and pruned deterministically', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  legacy.run(SCHEMA_SQL);
  legacy.run("INSERT INTO learning_resource (id, title, type) VALUES ('legacy-node', 'Nodo Legado', 'learning_resource')");
  // Conexión explícita cuyo destino no existe (restauración parcial / datos huérfanos)
  legacy.run("INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight) VALUES ('legacy-dangling', 'legacy-node', 'missing-node', 'related_to', 1.0)");
  const legacyBytes = legacy.export();
  legacy.close();

  try {
    await dbBridge.importDatabase(legacyBytes);
    const graph = await dao.getKnowledgeGraph();
    assert.ok(!graph.edges.some(e => e.id === 'legacy-dangling'), 'La arista huérfana no debe renderizarse');

    // La fila histórica sigue presente hasta que se ejecuta la limpieza explícita.
    const before = await dao.getKnowledgeConnections();
    assert.ok(before.some(c => c.id === 'legacy-dangling'));

    const removed = await dao.pruneDanglingConnections();
    assert.ok(removed >= 1);
    const after = await dao.getKnowledgeConnections();
    assert.ok(!after.some(c => c.id === 'legacy-dangling'));
  } finally {
    await dbBridge.importDatabase(originalBytes);
  }
});

test('15.14 Resource detail queries make zero network requests', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network forbidden'); };
  try {
    await dao.getResourceDetail('b1-deepwork');
    await dao.getResourceDetail('cp1');
    await dao.getRelatedKnowledge('c1-react');
    await dao.resolveNodeKind('l1');
    assert.equal(calls, 0, 'El detalle de recursos debe ser 100% local');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
