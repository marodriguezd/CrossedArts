/**
 * Frontera semántica `KnowledgeDocument` + manifiesto local de contenido.
 *
 * Garantías verificadas aquí:
 *  - la frontera canónica produce EXACTAMENTE los mismos fragmentos, con los
 *    mismos identificadores y el mismo texto, que el troceado directo sobre
 *    entidades de dominio (cambiar de frontera no invalida el índice);
 *  - se conserva la procedencia completa (recurso, lección, módulo, página);
 *  - los documentos sin cambios reutilizan su identidad de contenido y los
 *    modificados invalidan solo sus propios fragmentos;
 *  - el material eliminado se purga del manifiesto.
 */
import test from 'node:test';
import assert from 'node:assert';

import {
  createSemanticChunksFromResourcesAsync,
  createSemanticChunksFromResources
} from '../src/lib/localEmbeddings/chunking.ts';
import {
  domainEntitiesToKnowledgeDocuments,
  domainEntitiesToKnowledgeDocumentsAsync
} from '../src/ai/knowledge/adapters.ts';
import { buildSemanticCorpus } from '../src/lib/localEmbeddings/corpus.ts';
import {
  semanticContentManifest,
  buildManifestKey,
  computeContentSignature
} from '../src/lib/localEmbeddings/contentManifest.ts';
import type { DomainKnowledgeEntities } from '../src/ai/knowledge/types.ts';
import { EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';

const MODEL = 'onnx-community/embeddinggemma-300m-ONNX';

function entities(): DomainKnowledgeEntities {
  return {
    courses: [
      {
        id: 'c1',
        title: 'Curso de prueba',
        category: 'Programación',
        description: 'Descripción del curso.',
        modules: [
          {
            id: 'm1',
            title: 'Módulo uno',
            lessons: [
              { id: 'l1', title: 'Lección corta', content: 'Contenido breve.', duration_minutes: 10 },
              { id: 'l2', title: 'Lección larga', content: 'Parrafo largo. '.repeat(120), duration_minutes: 25 }
            ]
          }
        ]
      }
    ],
    books: [{ id: 'b1', title: 'Libro', author: 'Autora', category: 'Historia', description: 'Reseña.', reading_percentage: 40 }],
    notes: [{ id: 'n1', title: 'Nota', content: 'Cuerpo de la nota.', tags: 'pág:12', resource_id: 'c1' }],
    flashcards: [{ id: 'f1', front: '¿Qué es X?', back: 'Una X.', resource_id: 'c1', lesson_id: 'l1' }],
    concepts: [{ id: 'k1', name: 'Concepto', description: 'Definición.' }],
    practiceWork: [{ id: 'w1', title: 'Trabajo', description: 'Desc', content: 'Cuerpo', notes: 'Notas', kind: 'project' }]
  };
}

test('KnowledgeDocument es la frontera: mismos fragmentos que el troceado directo', async () => {
  const data = entities();
  const viaDomain = await createSemanticChunksFromResourcesAsync(data as any);
  const viaKnowledge = (await buildSemanticCorpus(data, MODEL)).chunks;

  assert.deepStrictEqual(
    viaKnowledge.map(c => ({ ...c })),
    viaDomain.map(c => ({ ...c })),
    'La frontera canónica no cambia identificadores, texto ni hash'
  );
  assert.ok(viaKnowledge.length > 0);
});

test('KnowledgeDocument conserva la procedencia completa del dominio', async () => {
  const docs = domainEntitiesToKnowledgeDocuments(entities());

  const lesson = docs.find(d => d.sourceType === 'lesson' && d.sourceId === 'l1')!;
  assert.strictEqual(lesson.resourceId, 'c1');
  assert.strictEqual(lesson.moduleId, 'm1');
  assert.strictEqual(lesson.lessonId, 'l1');
  assert.deepStrictEqual(lesson.path, ['Curso de prueba', 'Módulo uno', 'Lección corta']);

  const note = docs.find(d => d.sourceType === 'note')!;
  assert.strictEqual(note.page, 12, 'La página del libro se conserva como metadato');
  assert.strictEqual(note.resourceId, 'c1');

  const flashcard = docs.find(d => d.sourceType === 'flashcard')!;
  assert.strictEqual(flashcard.resourceId, 'c1');
  assert.strictEqual(flashcard.lessonId, 'l1');

  const practice = docs.find(d => d.sourceType === 'practice')!;
  assert.strictEqual(practice.metadata?.kind, 'project', 'El tipo de trabajo práctico se conserva');
  assert.ok(practice.bodyText.includes('Cuerpo'), 'El cuerpo del trabajo práctico se conserva');
});

test('KnowledgeDocument: hashes deterministas y síncronos/asíncronos equivalentes', async () => {
  const data = entities();
  const syncDocs = domainEntitiesToKnowledgeDocuments(data);
  const asyncDocs = await domainEntitiesToKnowledgeDocumentsAsync(data);
  assert.deepStrictEqual(
    syncDocs.map(d => [d.id, d.contentHash]),
    asyncDocs.map(d => [d.id, d.contentHash])
  );
});

test('fragmentos de una lección larga reciben identificadores deterministas', () => {
  const chunks = createSemanticChunksFromResources(entities() as any);
  const longLesson = chunks.filter(c => c.chunkId.startsWith('lesson_l2'));
  assert.ok(longLesson.length > 1, 'Una lección larga se fragmenta');
  assert.strictEqual(longLesson[0].chunkId, 'lesson_l2');
  assert.ok(longLesson.slice(1).every(c => /^lesson_l2_p\d+$/.test(c.chunkId)));

  // Determinismo: dos pasadas producen la misma secuencia.
  const again = createSemanticChunksFromResources(entities() as any);
  assert.deepStrictEqual(again.map(c => c.chunkId), chunks.map(c => c.chunkId));
});

test('manifiesto: contenido sin cambios reutiliza la identidad y no recalcula', async () => {
  await semanticContentManifest.clear(MODEL);

  const first = await buildSemanticCorpus(entities(), MODEL);
  assert.ok(first.recomputedHashes > 0);
  assert.strictEqual(first.reusedHashes, 0);

  const second = await buildSemanticCorpus(entities(), MODEL);
  assert.strictEqual(second.recomputedHashes, 0, 'Nada cambió: no se recalcula ningún SHA-256');
  assert.strictEqual(second.reusedHashes, first.chunks.length);
  assert.deepStrictEqual(
    second.chunks.map(c => [c.chunkId, c.contentHash]),
    first.chunks.map(c => [c.chunkId, c.contentHash])
  );
});

test('manifiesto: cambiar un documento invalida SOLO sus fragmentos', async () => {
  await semanticContentManifest.clear(MODEL);

  const base = entities();
  const first = await buildSemanticCorpus(base, MODEL);
  const beforeHashes = new Map(first.chunks.map(c => [c.chunkId, c.contentHash]));

  const modified = entities();
  modified.notes![0].content = 'Cuerpo de la nota editado por el estudiante.';

  const second = await buildSemanticCorpus(modified, MODEL);
  assert.strictEqual(second.recomputedHashes, 1, 'Solo se recalcula el fragmento de la nota editada');
  assert.strictEqual(second.reusedHashes, first.chunks.length - 1);

  const afterHashes = new Map(second.chunks.map(c => [c.chunkId, c.contentHash]));
  const noteChunks = first.chunks.filter(c => c.sourceId === 'n1').map(c => c.chunkId);
  assert.ok(noteChunks.length > 0);
  for (const [chunkId, hash] of beforeHashes) {
    if (noteChunks.includes(chunkId)) {
      assert.notStrictEqual(afterHashes.get(chunkId), hash, 'El fragmento editado invalida su vector');
    } else {
      assert.strictEqual(afterHashes.get(chunkId), hash, 'El resto del corpus no se ve afectado');
    }
  }
});

test('manifiesto: el material eliminado se purga y no queda disponible', async () => {
  await semanticContentManifest.clear(MODEL);
  const full = await buildSemanticCorpus(entities(), MODEL);
  const noteChunkIds = full.chunks.filter(c => c.sourceId === 'n1').map(c => c.chunkId);
  assert.ok(noteChunkIds.length > 0);

  const reduced = entities();
  reduced.notes = [];
  const afterDeletion = await buildSemanticCorpus(reduced, MODEL);

  assert.strictEqual(afterDeletion.chunks.some(c => c.sourceType === 'note'), false);

  const remainingKeys = new Set(semanticContentManifest.snapshot().map(e => e.key));
  for (const chunkId of noteChunkIds) {
    const key = buildManifestKey(MODEL, EMBEDDING_PIPELINE_VERSION, chunkId);
    assert.ok(!remainingKeys.has(key), 'El fragmento eliminado no permanece en el manifiesto');
  }
});

test('manifiesto: la identidad de la entrada incluye modelo y pipeline', async () => {
  await semanticContentManifest.clear(MODEL);
  await buildSemanticCorpus(entities(), MODEL);

  const other = semanticContentManifest.snapshot();
  assert.ok(other.length > 0);
  assert.ok(other.every(e => e.modelId === MODEL));
  assert.ok(other.every(e => e.pipelineVersion === EMBEDDING_PIPELINE_VERSION));

  // El manifiesto de otro modelo no existe: nada se reutiliza entre modelos.
  await semanticContentManifest.clear(MODEL);
  const cleared = semanticContentManifest.snapshot();
  assert.strictEqual(cleared.filter(e => e.modelId === MODEL).length, 0);
});

test('manifiesto: la firma es determinista y cambia con el contenido', () => {
  assert.strictEqual(computeContentSignature('texto'), computeContentSignature('texto'));
  assert.notStrictEqual(computeContentSignature('texto'), computeContentSignature('texto '));
});