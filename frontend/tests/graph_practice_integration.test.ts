import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import type { ConceptEdge, ConceptNode } from '../src/types/models.ts';
import { GRAPH_NODE_LABELS, resolveGraphNodeDestination } from '../src/services/domainLogic.ts';
import { explainIsolation } from '../src/services/graphExploration.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

/* -------------------------------------------------------------------------- */
/* 32.x — El trabajo práctico participa en el grafo                            */
/* -------------------------------------------------------------------------- */

test('32.1 practice work appears as a first-class graph node', async () => {
  await dbBridge.init();
  const graph = await dao.getKnowledgeGraph();

  const work = graph.nodes.find((n) => n.id === 'pw1');
  assert.ok(work, 'El trabajo práctico del seed debe ser un nodo del grafo');
  assert.equal(work!.node_type, 'practice');
  assert.equal(work!.name, 'Refactorizar un componente a custom hooks');
  assert.equal(work!.meta?.resource_id, 'c1-react');
  assert.equal(work!.meta?.lesson_id, 'l4');
  assert.equal(work!.meta?.concept_id, 'cp3');
  assert.equal(work!.meta?.practice_kind, 'code');
  assert.equal(work!.meta?.status, 'DONE');
});

test('32.2 practice work is linked to what it demonstrates, only when both ends exist', async () => {
  await dbBridge.init();
  const graph = await dao.getKnowledgeGraph();
  const has = (source: string, target: string, type: string) =>
    graph.edges.some(
      (e) => e.source_id === source && e.target_id === target && e.connection_type === type && e.derived === true
    );

  assert.ok(has('pw1', 'c1-react', 'about'), 'El trabajo se liga al recurso que evidencia');
  assert.ok(has('l4', 'pw1', 'references'), 'La lección referencia el trabajo realizado');
  assert.ok(has('pw1', 'cp3', 'about'), 'El trabajo se liga al concepto que demuestra');

  // pw2 no tiene lección: no debe existir una arista hacia un extremo inexistente.
  for (const edge of graph.edges) {
    assert.ok(graph.nodes.some((n) => n.id === edge.source_id), `Extremo origen huérfano: ${edge.source_id}`);
    assert.ok(graph.nodes.some((n) => n.id === edge.target_id), `Extremo destino huérfano: ${edge.target_id}`);
  }
});

test('32.3 related knowledge surfaces practice work in both directions', async () => {
  await dbBridge.init();

  const ofResource = await dao.getRelatedKnowledge('c1-react');
  const workFromResource = ofResource.find((item) => item.id === 'pw1');
  assert.ok(workFromResource, 'El recurso debe mostrar su trabajo práctico como evidencia');
  assert.equal(workFromResource!.type, 'practice');
  assert.equal(workFromResource!.title, 'Refactorizar un componente a custom hooks');

  const ofLesson = await dao.getRelatedKnowledge('l4');
  assert.ok(ofLesson.some((item) => item.id === 'pw1' && item.type === 'practice'), 'La lección debe enlazar su trabajo');

  const ofConcept = await dao.getRelatedKnowledge('cp3');
  assert.ok(ofConcept.some((item) => item.id === 'pw1'), 'El concepto debe mostrar el trabajo que lo demuestra');

  const context = await dao.getRelatedKnowledge('pw1');
  assert.ok(context.some((item) => item.id === 'c1-react'), 'El trabajo debe enlazar su contexto de origen');
  assert.ok(context.some((item) => item.id === 'l4'));
});

test('32.4 deleting the learning context removes its practice work from the graph', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const courseId = 'graph-practice-course';
  db.run("INSERT INTO learning_resource (id, title, type) VALUES (?, 'Curso temporal', 'course')", [courseId]);
  db.run('INSERT INTO course (id) VALUES (?)', [courseId]);
  await dbBridge.persist();

  const workId = await dao.addPracticeWork({ title: 'Trabajo temporal', resource_id: courseId });
  try {
    let graph = await dao.getKnowledgeGraph();
    assert.ok(graph.nodes.some((n) => n.id === workId), 'El trabajo debe aparecer mientras el recurso existe');

    db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
    await dbBridge.persist();

    graph = await dao.getKnowledgeGraph();
    assert.ok(!graph.nodes.some((n) => n.id === workId), 'Sin contexto no debe quedar un nodo huérfano');
    assert.ok(!graph.edges.some((e) => e.source_id === workId || e.target_id === workId));
  } finally {
    db.run('DELETE FROM practice_work WHERE id = ?', [workId]);
    db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
    await dbBridge.persist();
  }
});

test('32.5 practice nodes have a label and a deterministic destination', () => {
  assert.equal(GRAPH_NODE_LABELS.practice, 'Trabajo práctico');

  const withResource: ConceptNode = { id: 'pw-x', name: 'T', node_type: 'practice', meta: { resource_id: 'c1-react' } };
  assert.deepEqual(resolveGraphNodeDestination(withResource), { tab: 'resource', resourceId: 'c1-react' });

  const lessonOnly: ConceptNode = { id: 'pw-y', name: 'T', node_type: 'practice', meta: { lesson_id: 'l1' } };
  assert.deepEqual(resolveGraphNodeDestination(lessonOnly), { tab: 'course', resourceId: 'l1' });

  const orphan: ConceptNode = { id: 'pw-z', name: 'T', node_type: 'practice', meta: {} };
  assert.deepEqual(resolveGraphNodeDestination(orphan), { tab: 'library' });
});

/* -------------------------------------------------------------------------- */
/* 32.x — Filtro vs conectividad real                                          */
/* -------------------------------------------------------------------------- */

const nodes: ConceptNode[] = [
  { id: 'a', name: 'Curso', node_type: 'course' },
  { id: 'b', name: 'Concepto', node_type: 'concept' },
  { id: 'c', name: 'Nota', node_type: 'note' },
  { id: 'd', name: 'Trabajo', node_type: 'practice' },
  { id: 'e', name: 'Aislado de verdad', node_type: 'book' }
];

const edges: ConceptEdge[] = [
  { id: 'e1', source_id: 'a', target_id: 'c', connection_type: 'about', weight: 1 }
];

test('32.6 explainIsolation separates "globally disconnected" from "isolated in this view"', () => {
  const visibleNodes = nodes.filter((n) => n.node_type === 'course' || n.node_type === 'concept');
  // Al filtrar, una arista cuyos extremos no están ambos visibles desaparece:
  // la nota `c` queda oculta, así que `a` se queda sin aristas EN LA VISTA.
  const visibleIds = new Set(visibleNodes.map((n) => n.id));
  const visibleEdges = edges.filter(
    (e) => visibleIds.has(e.source_id) && visibleIds.has(e.target_id)
  );

  const explanation = explainIsolation(nodes, edges, visibleNodes, visibleEdges);
  assert.equal(explanation.isolatedGlobally, 3, 'b, d y e no tienen ninguna relación en el grafo completo');
  assert.deepEqual(explanation.apparentlyIsolatedIds, ['a'], 'a está conectado, pero su arista queda fuera de la vista');
  assert.equal(explanation.apparentlyIsolated, 1);
});

test('32.7 explainIsolation is honest when nothing is filtered', () => {
  const explanation = explainIsolation(nodes, edges, nodes, edges);
  assert.equal(explanation.apparentlyIsolated, 0, 'Sin filtros nada puede parecer aislado');
  assert.equal(explanation.isolatedGlobally, 3);
});

test('32.8 the graph page offers the practice filter and explains view isolation', () => {
  const page = readSource('../src/pages/KnowledgeGraph.tsx');
  assert.ok(page.includes('explainIsolation'), 'Debe distinguir aislamiento real de aislamiento en la vista');
  assert.ok(page.includes("'practice'"), 'El trabajo práctico debe poder filtrarse como tipo de nodo');
  assert.ok(page.includes('aislado') || page.includes('aislados'), 'Debe explicar en español el aislamiento de la vista');
  assert.ok(page.includes('grafo completo'), 'Debe aclarar que la conectividad se mide sobre el grafo completo');
});
