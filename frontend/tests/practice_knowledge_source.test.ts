import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { createSemanticChunksFromResources } from '../src/lib/localEmbeddings/chunking.ts';
import { retrieveLocalContext, deduplicateAndDiversify } from '../src/lib/localRag/retrieval.ts';
import { buildRagContext } from '../src/lib/localRag/contextBuilder.ts';
import { aiService } from '../src/ai/aiService.ts';

/**
 * Iteración 34 — El trabajo práctico como fuente de conocimiento de primera
 * clase, más la semántica honesta de los candidatos y la reutilización del
 * contexto recuperado.
 */

async function seedCourseWithPractice(suffix: string) {
  await dbBridge.init();
  const course = await dao.createCourse({
    title: `Curso ${suffix}`,
    description: `Curso de pruebas ${suffix}`,
    category: 'Pruebas'
  });
  assert.equal(course.success, true);
  const courseId = course.id!;
  const workId = await dao.addPracticeWork({
    title: `Ejercicio ${suffix}`,
    description: `Implementa un algoritmo de ordenamiento ${suffix}`,
    resource_id: courseId,
    content: 'Pseudocódigo del algoritmo de ordenamiento por mezcla',
    notes: 'Complejidad O(n log n)'
  });
  return { courseId, workId };
}

test('34.1 chunking indexa el trabajo práctico como fuente semántica con su contenido', () => {
  const chunks = createSemanticChunksFromResources({
    courses: [],
    books: [],
    notes: [],
    flashcards: [],
    concepts: [],
    practiceWork: [
      {
        id: 'pw1',
        title: 'Ensayo sobre la memoria',
        description: 'Reflexión sobre modelos de memoria',
        content: 'Cuerpo del ensayo con argumentos propios',
        notes: 'Revisar citas antes de entregar',
        kind: 'essay'
      }
    ]
  });

  const practice = chunks.filter((c) => c.sourceType === 'practice');
  assert.equal(practice.length, 1);
  assert.equal(practice[0].chunkId, 'practice_pw1');
  assert.equal(practice[0].sourceId, 'pw1');
  // Título + descripción + contenido + notas forman el texto canónico indexable.
  for (const needle of ['Ensayo sobre la memoria', 'modelos de memoria', 'Cuerpo del ensayo', 'Revisar citas']) {
    assert.ok(practice[0].text.includes(needle), `El texto indexado debe incluir "${needle}"`);
  }
});

test('34.2 el trabajo práctico es recuperable por la búsqueda local y cuenta como sustantivo', async () => {
  const { workId } = await seedCourseWithPractice('alfa');

  const result = await retrieveLocalContext('algoritmo de ordenamiento', 5);
  const found = result.documents.find((d) => d.sourceType === 'practice');

  assert.ok(found, 'El trabajo práctico debe ser recuperable');
  assert.equal(found!.id, workId);
  assert.equal(found!.substantive, true, 'La coincidencia es de contenido, no solo de título');
  assert.equal(result.hasSubstantiveContext, true);
});

test('34.3 el ámbito de recurso incluye su trabajo práctico y excluye el ajeno', async () => {
  const beta = await seedCourseWithPractice('beta');
  const gamma = await seedCourseWithPractice('gamma');

  const scoped = await retrieveLocalContext('algoritmo de ordenamiento', 5, {
    resourceId: beta.courseId
  });

  assert.ok(
    scoped.documents.some((d) => d.id === beta.workId),
    'La práctica del recurso en ámbito debe entrar'
  );
  assert.ok(
    !scoped.documents.some((d) => d.id === gamma.workId),
    'La práctica de otro recurso NO debe entrar (frontera dura)'
  );
});

test('34.4 un acierto de solo título no cuenta como contexto sustantivo', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({
    title: 'Zettelkasten Avanzado',
    description: 'Contenido del cuerpo sin coincidencias',
    category: 'Método'
  });

  const result = await retrieveLocalContext('zettelkasten', 5);
  const doc = result.documents.find((d) => d.sourceType === 'course' && d.id === created.id);

  assert.ok(doc, 'El curso debe recuperarse por su título');
  assert.equal(doc!.substantive, false, 'El cuerpo no coincide: no es sustantivo');
  assert.equal(result.hasSubstantiveContext, false, 'Solo metadatos no es fundamentación sólida');

  // El mismo material con coincidencia de CONTENIDO sí es sustantivo.
  await dao.addNote({ title: 'Apuntes varios', content: 'Reflexiones sobre zettelkasten y notas enlazadas.' });
  const withContent = await retrieveLocalContext('zettelkasten', 5);
  assert.equal(withContent.hasSubstantiveContext, true);
});

test('34.5 totalCandidates describe los candidatos aceptados antes de diversificar', async () => {
  const { courseId } = await seedCourseWithPractice('delta');
  const result = await retrieveLocalContext('algoritmo de ordenamiento delta', 2, { resourceId: courseId });

  assert.equal(typeof result.totalCandidates, 'number');
  assert.equal(typeof result.diversifiedCandidates, 'number');
  assert.ok(result.totalCandidates >= result.diversifiedCandidates, 'La fase previa nunca es menor');
  assert.ok(result.diversifiedCandidates >= result.documents.length, 'El recorte a limit ocurre al final');
});

test('34.6 deduplicateAndDiversify limita a dos fragmentos por fuente', () => {
  const candidates = [
    { id: 'misma', sourceType: 'note' as const, title: 't1', snippet: 's1', score: 3, chunkKey: 'k1' },
    { id: 'misma', sourceType: 'note' as const, title: 't2', snippet: 's2', score: 2, chunkKey: 'k2' },
    { id: 'misma', sourceType: 'note' as const, title: 't3', snippet: 's3', score: 1, chunkKey: 'k3' },
    { id: 'otra', sourceType: 'note' as const, title: 't4', snippet: 's4', score: 1, chunkKey: 'k4' }
  ];
  const diversified = deduplicateAndDiversify(candidates, 2);
  assert.equal(diversified.length, 3);
  assert.equal(diversified.filter((d) => d.id === 'misma').length, 2);
});

test('34.7 buildRagContext solo marca contexto sustantivo si una fuente incluida lo es', () => {
  const metadataOnly = buildRagContext([
    { id: 'c1', sourceType: 'course', title: 'Curso por título', snippet: 'Sin cuerpo relevante', score: 1, substantive: false }
  ]);
  assert.equal(metadataOnly.hasContext, true);
  assert.equal(metadataOnly.hasSubstantiveContext, false);

  const substantive = buildRagContext([
    { id: 'n1', sourceType: 'note', title: 'Nota', snippet: 'cuerpo', score: 1, substantive: true }
  ]);
  assert.equal(substantive.hasSubstantiveContext, true);
});

test('34.8 summarizeText no contamina el resumen con contenido ajeno (disableRetrieval)', async () => {
  await dbBridge.init();
  await dao.addNote({
    title: 'Nota ajena sobre fotosintesis',
    content: 'La fotosintesis convierte la luz solar en energia quimica.'
  });

  const response = await aiService.askTutor(
    [{ role: 'user', content: 'Resume este texto: la fotosintesis es un proceso biologico.' }],
    '',
    undefined,
    undefined,
    { disableRetrieval: true }
  );

  assert.deepEqual(response.sources, [], 'Sin recuperación no debe haber fuentes');
  assert.deepEqual(response.citations, []);
  assert.equal(response.hasSubstantiveContext, false);
});

test('34.9 prebuiltContext usa EXACTAMENTE las fuentes dadas y no vuelve a recuperar', async () => {
  await dbBridge.init();
  await dao.addNote({
    title: 'Contenido de biblioteca que no debe aparecer',
    content: 'react fiber concurrencia en la biblioteca'
  });

  const supplied = [
    {
      id: 'n-proporcionada',
      sourceType: 'note' as const,
      title: 'Fuente proporcionada',
      snippet: 'contexto exacto suministrado',
      score: 1,
      substantive: true
    }
  ];

  const response = await aiService.askTutor(
    [{ role: 'user', content: 'react fiber concurrencia' }],
    '',
    undefined,
    undefined,
    { prebuiltContext: { documents: supplied, retrievalMode: 'lexical', hasSubstantiveContext: true } }
  );

  assert.deepEqual(response.sources, ['Fuente proporcionada']);
  assert.equal(response.citations?.length, 1);
  assert.equal(response.citations?.[0].title, 'Fuente proporcionada');
  assert.ok(
    !response.sources.some((s) => s.includes('biblioteca')),
    'La segunda recuperación no debe filtrar material ajeno'
  );
  assert.equal(response.retrievalMode, 'lexical');
  assert.equal(response.hasSubstantiveContext, true);
});
