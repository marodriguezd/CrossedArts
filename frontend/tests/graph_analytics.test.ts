import test from 'node:test';
import assert from 'node:assert';

import {
  buildGraphInsights,
  computeComponentSizes,
  computeDegrees,
  computeGraphAnalytics
} from '../src/services/graphExploration.ts';
import type { ConceptEdge, ConceptNode, GraphNodeType } from '../src/types/models.ts';

function node(id: string, type: GraphNodeType = 'concept', extras: Partial<ConceptNode> = {}): ConceptNode {
  return { id, name: extras.name ?? `Nodo ${id}`, node_type: type, ...extras };
}

function edge(source: string, target: string, id = `${source}->${target}`): ConceptEdge {
  return { id, source_id: source, target_id: target, connection_type: 'related_to', weight: 1 };
}

test('graph analytics: grafo vacío produce estadísticas honestas', () => {
  const analytics = computeGraphAnalytics([], []);
  assert.strictEqual(analytics.totalNodes, 0);
  assert.strictEqual(analytics.totalEdges, 0);
  assert.strictEqual(analytics.connectedNodes, 0);
  assert.strictEqual(analytics.isolatedNodes, 0);
  assert.deepStrictEqual(analytics.topConnected, []);
  assert.deepStrictEqual(analytics.highDegree, []);
  assert.strictEqual(analytics.components.count, 0);
  assert.strictEqual(analytics.hasDateInfo, false);

  const insights = buildGraphInsights(analytics);
  assert.strictEqual(insights.length, 1);
  assert.match(insights[0], /vacío/);
});

test('graph analytics: conectividad, aislados y tipos', () => {
  const nodes = [
    node('a', 'concept'),
    node('b', 'concept'),
    node('c', 'concept'),
    node('r1', 'resource')
  ];
  const edges = [edge('a', 'b')];

  const analytics = computeGraphAnalytics(nodes, edges);
  assert.strictEqual(analytics.totalNodes, 4);
  assert.strictEqual(analytics.totalEdges, 1);
  assert.strictEqual(analytics.connectedNodes, 2);
  assert.strictEqual(analytics.isolatedNodes, 2);
  assert.deepStrictEqual(analytics.isolatedIds, ['c', 'r1']);
  assert.strictEqual(analytics.typeCounts.concept, 3);
  assert.strictEqual(analytics.typeCounts.resource, 1);
});

test('graph analytics: nodos desconocidos en aristas no falsean el grado', () => {
  const nodes = [node('a')];
  const edges = [edge('a', 'fantasma'), edge('otro', 'también-fantasma')];
  const degree = computeDegrees(nodes, edges);
  assert.strictEqual(degree.get('a'), 1, 'Solo cuenta extremos que existen como nodo');

  const analytics = computeGraphAnalytics(nodes, edges);
  assert.strictEqual(analytics.totalEdges, 2, 'El total de relaciones es el registrado');
  assert.strictEqual(analytics.isolatedNodes, 0);
});

test('graph analytics: componentes conexos no dirigidos', () => {
  const nodes = ['a', 'b', 'c', 'd', 'e', 'f'].map(id => node(id));
  const edges = [
    edge('a', 'b'),
    edge('b', 'c'), // componente {a,b,c}
    edge('d', 'e'), // componente {d,e}
    edge('f', 'h')  // f conectado a un nodo inexistente → grupo de 1
  ];

  const sizes = computeComponentSizes(nodes, edges);
  assert.deepStrictEqual(sizes, [3, 2, 1]);
  const analytics = computeGraphAnalytics(nodes, edges);
  assert.strictEqual(analytics.components.count, 3);
  assert.strictEqual(analytics.components.largestSize, 3);
});

test('graph analytics: ordena por «más conexiones» sin juicios de importancia', () => {
  const nodes = ['a', 'b', 'c', 'd'].map(id => node(id));
  const edges = [
    edge('a', 'b', 'e1'),
    edge('a', 'c', 'e2'),
    edge('a', 'd', 'e3'),
    edge('b', 'c', 'e4')
  ];

  const analytics = computeGraphAnalytics(nodes, edges);
  assert.strictEqual(analytics.topConnected[0].id, 'a');
  assert.strictEqual(analytics.topConnected[0].degree, 3);
  assert.strictEqual(analytics.topConnected.length, 4, 'Todos con al menos una conexión');
  for (const entry of analytics.topConnected) assert.ok(entry.degree > 0);

  // El vocabulario nunca convierte conexiones en importancia.
  for (const insight of buildGraphInsights(analytics)) {
    assert.doesNotMatch(insight, /más importante|importancia|inteligencia|dominio|dominio|maestría|mastery/i);
  }
  assert.ok(
    buildGraphInsights(analytics).some(text => /más conexiones/.test(text)),
    'La lectura usa la etiqueta literal «más conexiones»'
  );
});

test('graph analytics: grado inusualmente alto con umbral estadístico', () => {
  // 8 nodos con grado 1 y uno con grado 7: el central supera media + 2σ.
  const nodes = ['hub', 'n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'].map(id => node(id));
  const edges: ConceptEdge[] = [];
  let i = 0;
  for (const leaf of ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7']) {
    edges.push(edge('hub', leaf, `e${i++}`));
  }

  const analytics = computeGraphAnalytics(nodes, edges);
  assert.ok(analytics.highDegreeThreshold >= 4, 'El umbral mínimo es 4 para grafos pequeños');
  assert.strictEqual(analytics.highDegree.length, 1);
  assert.strictEqual(analytics.highDegree[0].id, 'hub');

  const insights = buildGraphInsights(analytics);
  assert.ok(insights.some(text => /inusualmente alto/.test(text)));
});

test('graph analytics: sin grado elevado no se etiqueta nada como inusual', () => {
  const nodes = ['a', 'b'].map(id => node(id));
  const edges = [edge('a', 'b')];
  const analytics = computeGraphAnalytics(nodes, edges);
  assert.deepStrictEqual(analytics.highDegree, []);
  assert.ok(!buildGraphInsights(analytics).some(text => /inusualmente alto/.test(text)));
});

test('graph analytics: recursos con conectividad débil', () => {
  const nodes = [
    node('libro-solo', 'book'),
    node('recurso-sin-nada', 'resource'),
    node('recurso-dos', 'resource'),
    node('concepto-suelto', 'concept')
  ];
  const edges = [edge('recurso-dos', 'concepto-suelto')];

  const analytics = computeGraphAnalytics(nodes, edges);
  const weakIds = analytics.weakResources.map(entry => entry.id).sort();
  assert.deepStrictEqual(weakIds, ['libro-solo', 'recurso-dos', 'recurso-sin-nada'],
    'Solo los tipos de recurso entran en la lista de poca conectividad (0 o 1 conexión)');
  assert.ok(
    !weakIds.includes('concepto-suelto'),
    'Un concepto suelto no es un "recurso poco conectado"'
  );
  assert.ok(
    analytics.weakResources.every(entry => entry.degree <= 1),
    'Poco conectado significa 0 o 1 conexión'
  );

  const insights = buildGraphInsights(analytics);
  assert.ok(insights.some(text => /poco conectados/.test(text)));
});

test('graph analytics: actividad reciente solo cuando hay fechas reales', () => {
  const sinFechas = [node('a'), node('b')];
  const analyticsSinFechas = computeGraphAnalytics(sinFechas, []);
  assert.strictEqual(analyticsSinFechas.hasDateInfo, false);
  assert.deepStrictEqual(analyticsSinFechas.recent, []);
  assert.ok(!buildGraphInsights(analyticsSinFechas).some(text => /Actividad reciente/.test(text)));

  const conFechas = [
    node('nuevo', 'note', { name: 'Nota nueva', meta: { created_at: '2026-10-05 10:00:00' } }),
    node('viejo', 'note', { name: 'Nota vieja', meta: { created_at: '2026-01-01 10:00:00' } }),
    node('actualizado', 'course', { name: 'Curso tocado', meta: { updated_at: '2026-10-06 09:00:00' } }),
    node('raro', 'concept', { name: 'Fecha ilegible', meta: { created_at: 'no-fecha' } })
  ];
  const analytics = computeGraphAnalytics(conFechas, []);
  assert.strictEqual(analytics.hasDateInfo, true);
  assert.ok(analytics.recent.length >= 3);
  assert.strictEqual(analytics.recent[0].name, 'Curso tocado', 'Ordena del más reciente al más antiguo');
  assert.strictEqual(analytics.recent[0].date, '2026-10-06');
  assert.ok(
    !analytics.recent.some(entry => entry.id === 'raro'),
    'Las fechas ilegibles no generan actividad'
  );
});

test('graph analytics: grupos separados se explican de forma accionable', () => {
  const nodes = ['a', 'b', 'c'].map(id => node(id));
  const analytics = computeGraphAnalytics(nodes, []);
  const insights = buildGraphInsights(analytics);
  assert.ok(insights.some(text => text.includes('3 nodos no tienen ninguna relación')));
  assert.ok(insights.some(text => /3 grupos sin conexión/.test(text)));
});
