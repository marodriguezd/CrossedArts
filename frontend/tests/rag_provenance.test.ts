import test from 'node:test';
import assert from 'node:assert';

import {
  buildRagContext,
  buildSourceCitation,
  resolveCitationNavigate,
  MAX_SOURCES
} from '../src/lib/localRag/contextBuilder.ts';
import type { RetrievedDocument } from '../src/lib/localRag/retrieval.ts';
import { retrieveLocalContext } from '../src/lib/localRag/retrieval.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';

function doc(overrides: Partial<RetrievedDocument> & { id: string; sourceType: RetrievedDocument['sourceType'] }): RetrievedDocument {
  return { title: overrides.title ?? `Fuente ${overrides.id}`, snippet: 'fragmento', score: 1, ...overrides };
}

test('rag provenance: sin documentos no hay citas ni contexto', () => {
  const built = buildRagContext([]);
  assert.strictEqual(built.hasContext, false);
  assert.deepStrictEqual(built.citations, []);
  assert.deepStrictEqual(built.sourceTitles, []);
  assert.strictEqual(built.formattedContextText, '');
});

test('rag provenance: cada cita identifica tipo, ruta, página y capítulo', () => {
  const documents: RetrievedDocument[] = [
    doc({
      id: 'l3',
      sourceType: 'lesson',
      title: 'React 18 › Server Components',
      path: ['React 18', 'Módulo 1', 'Server Components'],
      resourceId: 'c1-react',
      lessonId: 'l3',
      retrievalMode: 'hybrid'
    }),
    doc({ id: 'b1', sourceType: 'book', title: 'Deep Work', page: 42, resourceId: 'b1' }),
    doc({ id: 'n1', sourceType: 'note', title: 'Patrones de rendimiento', chapter: 'Memoización' })
  ];

  const built = buildRagContext(documents);
  assert.strictEqual(built.hasContext, true);
  assert.strictEqual(built.citations.length, 3);
  assert.deepStrictEqual(built.sourceTitles, documents.map(d => d.title));

  const [lessonCitation, bookCitation, noteCitation] = built.citations;
  assert.deepStrictEqual(lessonCitation.path, ['React 18', 'Módulo 1', 'Server Components']);
  assert.strictEqual(lessonCitation.retrievalMode, 'hybrid');
  assert.deepStrictEqual(lessonCitation.navigate, { kind: 'lesson', id: 'l3' });
  assert.strictEqual(bookCitation.page, 42);
  assert.deepStrictEqual(bookCitation.navigate, { kind: 'resource', id: 'b1' });
  assert.strictEqual(noteCitation.chapter, 'Memoización');
  assert.deepStrictEqual(noteCitation.navigate, { kind: 'note', id: 'n1' });

  // El texto de contexto conserva los marcadores de procedencia.
  assert.match(built.formattedContextText, /TIPO="LESSON"/);
  assert.match(built.formattedContextText, /TIPO="BOOK".*PAGINA="42"/s);
});

test('rag provenance: la ruta nunca se inventa si la recuperación no la conoce', () => {
  const built = buildRagContext([doc({ id: 'x', sourceType: 'concept', title: 'Concepto suelto' })]);
  assert.strictEqual(built.citations[0].path, undefined);
  assert.deepStrictEqual(built.citations[0].navigate, { kind: 'concept', id: 'x' });
});

test('rag provenance: destino determinista por tipo de fuente', () => {
  assert.deepStrictEqual(
    resolveCitationNavigate(doc({ id: 'c1', sourceType: 'course', resourceId: 'c1' })),
    { kind: 'resource', id: 'c1' }
  );
  assert.deepStrictEqual(
    resolveCitationNavigate(doc({ id: 'b1', sourceType: 'book' })),
    { kind: 'resource', id: 'b1' },
    'Sin resourceId se usa el propio id del libro'
  );
  assert.deepStrictEqual(
    resolveCitationNavigate(doc({ id: 'fc1', sourceType: 'flashcard', resourceId: 'c1' })),
    { kind: 'resource', id: 'c1' },
    'La tarjeta abre su recurso'
  );
  assert.strictEqual(
    resolveCitationNavigate(doc({ id: 'fc2', sourceType: 'flashcard' })),
    null,
    'Una tarjeta sin recurso no tiene destino: no se finge navegación'
  );
  assert.deepStrictEqual(
    resolveCitationNavigate(doc({ id: 'l1', sourceType: 'lesson' })),
    { kind: 'lesson', id: 'l1' }
  );
});

test('rag provenance: claves de cita estables y dentro del límite de fuentes', () => {
  const many = Array.from({ length: 10 }, (_, i) => doc({ id: `n${i}`, sourceType: 'note' }));
  const built = buildRagContext(many);

  assert.strictEqual(built.citations.length, MAX_SOURCES, 'Las citas cubren las fuentes realmente usadas');
  assert.strictEqual(built.sourceTitles.length, MAX_SOURCES);
  const keys = new Set(built.citations.map(citation => citation.key));
  assert.strictEqual(keys.size, built.citations.length, 'Las claves deben ser únicas');

  const single = buildSourceCitation(doc({ id: 'único', sourceType: 'note' }), 0);
  assert.ok(single.key.includes('único'));
  assert.strictEqual(single.sourceType, 'note');
});

test('rag provenance: la recuperación real conserva la ruta del curso al que pertenece', async () => {
  await dbBridge.init();

  const result = await retrieveLocalContext('Virtual DOM Fiber reconciliación', 4);
  assert.ok(result.documents.length > 0, 'La semilla contiene material indexable');

  const lessonDoc = result.documents.find(d => d.sourceType === 'lesson');
  assert.ok(lessonDoc, 'Debe recuperarse al menos una lección');
  assert.ok(lessonDoc.path && lessonDoc.path.length >= 3, 'La ruta de la lección tiene curso, módulo y lección');
  assert.strictEqual(lessonDoc.path![0], 'React 18 & TypeScript Masterclass');
  assert.ok(lessonDoc.resourceId, 'La lección conserva su curso de origen');
  assert.deepStrictEqual(resolveCitationNavigate(lessonDoc), { kind: 'lesson', id: lessonDoc.id });

  const built = buildRagContext(result.documents);
  for (const citation of built.citations) {
    assert.ok(citation.title.length > 0, 'Toda cita identifica su fuente');
    assert.ok(citation.navigate === null || typeof citation.navigate.id === 'string');
  }
});

test('rag provenance: una consulta sin resultados no produce citas', async () => {
  await dbBridge.init();
  const result = await retrieveLocalContext('zzzznadaexactoparecido9999', 4);
  const built = buildRagContext(result.documents);
  assert.strictEqual(built.hasContext, false);
  assert.deepStrictEqual(built.citations, []);
});
