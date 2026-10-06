import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { ConceptEdge, ConceptNode, GraphNodeType } from '../src/types/models.ts';
import {
  applyGraphFilters,
  availableRelationTypes,
  collectNeighborhood,
  computeConnectivityStats,
  nodeTypeOf
} from '../src/services/graphExploration.ts';

const nodes: ConceptNode[] = [
  { id: 'a', name: 'Curso A', node_type: 'course' },
  { id: 'b', name: 'Concepto B', node_type: 'concept' },
  { id: 'c', name: 'Concepto C', node_type: 'concept' },
  { id: 'd', name: 'Nota D', node_type: 'note' },
  { id: 'e', name: 'Libro E', node_type: 'book' }
];

const edges: ConceptEdge[] = [
  { id: 'e1', source_id: 'a', target_id: 'b', connection_type: 'contains', weight: 1 },
  { id: 'e2', source_id: 'b', target_id: 'c', connection_type: 'related_to', weight: 1 },
  { id: 'e3', source_id: 'a', target_id: 'd', connection_type: 'about', weight: 1 }
];

const ALL_TYPES = new Set<GraphNodeType>(['concept', 'course', 'book', 'module', 'lesson', 'note', 'resource']);

/* -------------------------------------------------------------------------- */
/* 28.x — Vecindario                                                           */
/* -------------------------------------------------------------------------- */

test('28.1 collectNeighborhood honours the hop depth', () => {
  assert.deepEqual(Array.from(collectNeighborhood(edges, 'a', 0)).sort(), ['a']);
  assert.deepEqual(Array.from(collectNeighborhood(edges, 'a', 1)).sort(), ['a', 'b', 'd']);
  assert.deepEqual(Array.from(collectNeighborhood(edges, 'a', 2)).sort(), ['a', 'b', 'c', 'd']);
  // Profundidad grande: el conjunto se estabiliza, no hay bucle infinito.
  assert.deepEqual(Array.from(collectNeighborhood(edges, 'a', 99)).sort(), ['a', 'b', 'c', 'd']);
});

test('28.2 collectNeighborhood respects an allowed-node restriction', () => {
  const allowed = new Set(['a', 'b']);
  assert.deepEqual(Array.from(collectNeighborhood(edges, 'a', 2, allowed)).sort(), ['a', 'b']);
});

test('28.3 collectNeighborhood returns empty for an unknown or empty root', () => {
  assert.equal(collectNeighborhood(edges, '', 2).size, 0);
  const allowed = new Set(['a']);
  assert.equal(collectNeighborhood(edges, 'zzz', 2, allowed).size, 0);
});

test('28.4 collectNeighborhood survives a cycle without revisiting nodes', () => {
  const cyclic: ConceptEdge[] = [
    { id: 'c1', source_id: 'a', target_id: 'b', connection_type: 'related_to', weight: 1 },
    { id: 'c2', source_id: 'b', target_id: 'a', connection_type: 'related_to', weight: 1 }
  ];
  assert.deepEqual(Array.from(collectNeighborhood(cyclic, 'a', 5)).sort(), ['a', 'b']);
});

/* -------------------------------------------------------------------------- */
/* 28.x — Tipos de relación y filtrado combinado                               */
/* -------------------------------------------------------------------------- */

test('28.5 availableRelationTypes lists unique types in stable order', () => {
  assert.deepEqual(availableRelationTypes(edges), ['about', 'contains', 'related_to']);
  assert.deepEqual(availableRelationTypes([]), []);
});

test('28.6 nodeTypeOf defaults to resource and applyGraphFilters drops dangling edges', () => {
  assert.equal(nodeTypeOf({ id: 'x', name: 'X' }), 'resource');

  const withoutBooks = new Set<GraphNodeType>(Array.from(ALL_TYPES).filter(t => t !== 'book'));
  const filtered = applyGraphFilters(nodes, edges, {
    activeTypes: withoutBooks,
    activeRelations: null,
    focusNodeId: null,
    focusDepth: 0
  });
  assert.equal(filtered.nodes.some(n => n.id === 'e'), false);
  // Ninguna arista puede quedar con un extremo invisible.
  for (const edge of filtered.edges) {
    assert.ok(filtered.nodes.some(n => n.id === edge.source_id));
    assert.ok(filtered.nodes.some(n => n.id === edge.target_id));
  }
});

test('28.7 relation filters: null means all, an empty set means no edges', () => {
  const allRelations = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: null,
    focusNodeId: null,
    focusDepth: 0
  });
  assert.equal(allRelations.edges.length, 3);

  const onlyContains = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: new Set(['contains']),
    focusNodeId: null,
    focusDepth: 0
  });
  assert.deepEqual(onlyContains.edges.map(e => e.id), ['e1']);
  assert.equal(onlyContains.nodes.length, 5, 'Ocultar relaciones no elimina nodos');

  const none = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: new Set<string>(),
    focusNodeId: null,
    focusDepth: 0
  });
  assert.equal(none.edges.length, 0);
});

test('28.8 focus mode keeps the neighborhood and the edges within it', () => {
  const oneHop = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: null,
    focusNodeId: 'a',
    focusDepth: 1
  });
  assert.deepEqual(oneHop.nodes.map(n => n.id).sort(), ['a', 'b', 'd']);
  assert.deepEqual(oneHop.edges.map(e => e.id).sort(), ['e1', 'e3']);

  const twoHops = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: null,
    focusNodeId: 'a',
    focusDepth: 2
  });
  assert.deepEqual(twoHops.nodes.map(n => n.id).sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual(twoHops.edges.map(e => e.id).sort(), ['e1', 'e2', 'e3']);
});

test('28.9 focus is ignored without a selected node', () => {
  const result = applyGraphFilters(nodes, edges, {
    activeTypes: ALL_TYPES,
    activeRelations: null,
    focusNodeId: null,
    focusDepth: 2
  });
  assert.equal(result.nodes.length, 5);
  assert.equal(result.edges.length, 3);
});

/* -------------------------------------------------------------------------- */
/* 28.x — Conectividad                                                         */
/* -------------------------------------------------------------------------- */

test('28.10 computeConnectivityStats counts connected and isolated nodes', () => {
  const stats = computeConnectivityStats(nodes, edges);
  assert.equal(stats.total, 5);
  assert.equal(stats.connected, 4);
  assert.equal(stats.isolated, 1);
  assert.deepEqual(stats.isolatedIds, ['e']);

  const empty = computeConnectivityStats([], []);
  assert.deepEqual(empty, { total: 0, connected: 0, isolated: 0, isolatedIds: [] });
});

/* -------------------------------------------------------------------------- */
/* 28.x — Integración en la vista del grafo                                    */
/* -------------------------------------------------------------------------- */

test('28.11 the graph page wires relation filters, focus mode and connectivity', () => {
  const source = readFileSync(new URL('../src/pages/KnowledgeGraph.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('applyGraphFilters'), 'Debe usar el filtrado compartido');
  assert.ok(source.includes('availableRelationTypes'), 'Debe ofrecer solo las relaciones existentes');
  assert.ok(source.includes('computeConnectivityStats'), 'Debe mostrar la conectividad real');
  assert.ok(source.includes('Enfoque del vecindario'), 'Debe existir el control de enfoque');
  assert.ok(source.includes('Filtros de relaciones del grafo'), 'Debe existir el filtro de relaciones');
});
