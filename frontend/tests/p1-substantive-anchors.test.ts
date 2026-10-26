import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  createSemanticChunksFromResources,
  createSemanticChunksFromKnowledgeDocuments
} from '../src/lib/localEmbeddings/chunking.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';
import { LocalEmbeddingEngine } from '../src/lib/localEmbeddings/engine.ts';
import { fuseRankedCandidates } from '../src/lib/localRag/fusion.ts';
import { isWithinScope } from '../src/lib/localRag/scope.ts';

/**
 * P1.3 — "Tiene cuerpo" se separa de "es un hit semántico", y las anclas
 * sobreviven hasta la recuperación.
 *
 * Antes: todo hit semántico se marcaba `substantive: true` (los metadatos
 * satisfacían la puerta de procedencia) y los chunks de notas, tarjetas y
 * práctica perdían `resourceId`/`lessonId`, así que el filtro de ámbito los
 * descartaba aunque pertenecieran al ámbito.
 */

const ENTITIES = {
  courses: [
    {
      id: 'c-sin-cuerpo',
      title: 'Curso sin descripción',
      category: 'Test',
      description: '',
      modules: [
        {
          id: 'm1',
          title: 'Módulo',
          lessons: [{ id: 'l1', title: 'Lección', content: 'contenido real', duration_minutes: 5 }]
        }
      ]
    }
  ],
  books: [],
  notes: [{ id: 'n1', title: 'Nota', content: 'cuerpo de la nota', resource_id: 'c-sin-cuerpo', lesson_id: 'l1' }],
  flashcards: [{ id: 'f1', front: 'P', back: 'R', resource_id: 'c-sin-cuerpo', lesson_id: 'l1' }],
  concepts: [],
  practiceWork: [
    {
      id: 'pw1',
      title: 'Práctica',
      description: 'enunciado',
      content: null,
      notes: null,
      kind: 'exercise',
      resource_id: 'c-sin-cuerpo',
      lesson_id: 'l1'
    }
  ]
};

test('P1.3: un documento sin cuerpo produce chunks NO sustantivos', () => {
  const chunks = createSemanticChunksFromResources(ENTITIES);
  const course = chunks.find(c => c.chunkId === 'course_c-sin-cuerpo')!;
  assert.ok(course, 'el curso debe seguir indexado (sus metadatos son buscables)');
  assert.equal(course.substantive, false, 'sin cuerpo es metadato, no contenido');

  const lesson = chunks.find(c => c.chunkId === 'lesson_l1')!;
  assert.equal(lesson.substantive, true, 'una lección con contenido sí es sustantiva');
});

test('P1.3: notas, tarjetas y práctica conservan sus anclas', () => {
  const chunks = createSemanticChunksFromResources(ENTITIES);

  const note = chunks.find(c => c.chunkId === 'note_n1')!;
  assert.equal(note.resourceId, 'c-sin-cuerpo');
  assert.equal(note.lessonId, 'l1');
  assert.equal(note.substantive, true);

  const card = chunks.find(c => c.chunkId === 'flashcard_f1')!;
  assert.equal(card.resourceId, 'c-sin-cuerpo');
  assert.equal(card.lessonId, 'l1');

  const practice = chunks.find(c => c.chunkId === 'practice_pw1')!;
  assert.equal(practice.resourceId, 'c-sin-cuerpo');
  assert.equal(practice.lessonId, 'l1');
});

test('P1.3: el límite KnowledgeDocument también transporta anclas', () => {
  const chunks = createSemanticChunksFromKnowledgeDocuments([
    {
      id: 'note_n9',
      sourceType: 'note',
      sourceId: 'n9',
      title: 'Nota 9',
      headerText: 'Nota: Nota 9.',
      bodyText: 'contenido',
      resourceId: 'c7',
      lessonId: 'l7'
    },
    {
      id: 'course_c9',
      sourceType: 'course',
      sourceId: 'c9',
      title: 'Curso 9',
      headerText: 'Curso: Curso 9.',
      bodyText: ''
    }
  ]);

  const note = chunks.find(c => c.chunkId === 'note_n9')!;
  assert.equal(note.resourceId, 'c7');
  assert.equal(note.lessonId, 'l7');
  assert.equal(note.substantive, true);

  const course = chunks.find(c => c.chunkId === 'course_c9')!;
  assert.equal(course.substantive, false);
});

test('P1.3: el motor guarda substantivo y anclas junto al vector', async () => {
  await embeddingCache.clearCache();

  const engine = new LocalEmbeddingEngine();
  await engine.loadModel('Xenova/all-MiniLM-L6-v2', {
    detectCapabilities: async () => ({ state: 'supported', backend: 'wasm' } as any),
    createPipeline: (async () => {
      const pipe: any = async () => ({ data: new Float32Array(384).fill(0.05) });
      pipe.dispose = async () => undefined;
      return pipe;
    }) as any
  });

  await engine.indexChunks([
    {
      chunkId: 'note_t1',
      sourceType: 'note',
      sourceId: 'n1',
      title: 'Nota',
      text: 'cuerpo',
      contentHash: 'hash-1',
      substantive: true,
      resourceId: 'c1',
      lessonId: 'l1'
    },
    {
      chunkId: 'course_t1',
      sourceType: 'course',
      sourceId: 'c1',
      title: 'Curso',
      text: 'Curso: X.',
      contentHash: 'hash-2',
      substantive: false
    }
  ]);

  const entries = await embeddingCache.getAllEntriesForModel(
    'Xenova/all-MiniLM-L6-v2',
    EMBEDDING_PIPELINE_VERSION
  );
  const note = entries.find(e => e.chunkId === 'note_t1')!;
  const course = entries.find(e => e.chunkId === 'course_t1')!;

  assert.equal(note.substantive, true);
  assert.equal(note.resourceId, 'c1');
  assert.equal(note.lessonId, 'l1');
  assert.equal(course.substantive, false);
});

test('P1.3: una nota del ámbito entra en recuperación semántica con su perímetro', () => {
  const { candidates } = fuseRankedCandidates({
    lexicalCandidates: new Map(),
    lexicalRanked: [],
    semanticRanked: [
      {
        chunkId: 'note_n1',
        score: 0.88,
        entry: {
          sourceId: 'n1',
          sourceType: 'note',
          title: 'Nota del ámbito',
          text: 'cuerpo de la nota',
          substantive: true,
          resourceId: 'c1',
          lessonId: 'l1'
        }
      }
    ]
  });

  const note = candidates[0];
  assert.equal(note.substantive, true);

  const scope = new Set(['c1', 'l1']);
  assert.equal(
    isWithinScope({ sourceId: note.id, resourceId: note.resourceId, lessonId: note.lessonId }, scope),
    true,
    'sin anclas la nota se descartaría al filtrar por ámbito'
  );

  // El perímetro sigue siendo una frontera dura para lo ajeno.
  const foreign = candidates.find(c => c.id === note.id)!;
  assert.equal(
    isWithinScope({ sourceId: 'ajeno', resourceId: undefined, lessonId: undefined }, new Set(['c1'])),
    false
  );
  assert.ok(foreign);
});

test('P1.3: un hit semántico sin cuerpo no aporta contexto sustantivo', () => {
  const { candidates } = fuseRankedCandidates({
    lexicalCandidates: new Map(),
    lexicalRanked: [],
    semanticRanked: [
      {
        chunkId: 'course_header',
        score: 0.97,
        entry: {
          sourceId: 'c1',
          sourceType: 'course',
          title: 'Curso',
          text: 'Curso: X. Categoría: Y.',
          substantive: false
        }
      }
    ]
  });

  assert.equal(candidates[0].substantive, false);
  assert.equal(candidates.some(c => c.substantive === true), false);
});
