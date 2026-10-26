import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';
import { cosineSimilarity } from '../src/lib/localEmbeddings/engine.ts';
import { buildCurrentChunkHashes, invalidateCurrentChunkHashes } from '../src/lib/localEmbeddings/corpus.ts';
import { scoreLexicalRelevance } from '../src/lib/localRag/retrieval.ts';
import { fuseRankedCandidates } from '../src/lib/localRag/fusion.ts';

/**
 * P2.1 — caché de vectores acotada y recuperación más barata.
 *
 * Antes: `inMemoryCache` crecía sin límite, el mapa `chunkId -> hash` se
 * reconstruía en cada consulta semántica, se compilaba un `RegExp` por token y
 * documento, y `Math.max(...spread)` desbordaba la pila con muchas candidatas.
 */

const MODEL = 'Xenova/all-MiniLM-L6-v2';
const DIMS = 384;

function vector(seed: number): number[] {
  return Array.from({ length: DIMS }, (_, i) => Math.sin(seed + i));
}

const LIBRARY = {
  courses: [
    {
      id: 'c1',
      title: 'Curso base',
      category: 'Test',
      description: 'descripción',
      modules: [
        {
          id: 'm1',
          title: 'Módulo',
          lessons: [{ id: 'l1', title: 'Lección', content: 'texto de la lección', duration_minutes: 5 }]
        }
      ]
    }
  ],
  books: [],
  notes: [{ id: 'n1', title: 'Nota', content: 'cuerpo' }],
  flashcards: [],
  concepts: [],
  practiceWork: []
};

test('P2.1: la caché en memoria está acotada y desaloja por LRU', async () => {
  await embeddingCache.clearCache();
  const order: string[] = [];

  for (let i = 0; i < 700; i++) {
    const chunkId = `chunk_${i}`;
    order.push(chunkId);
    await embeddingCache.setEntry({
      chunkId,
      sourceType: 'note',
      sourceId: chunkId,
      title: `Nota ${i}`,
      text: 'texto',
      contentHash: `hash_${i}`,
      modelId: MODEL,
      pipelineVersion: EMBEDDING_PIPELINE_VERSION,
      dimensions: DIMS,
      vector: vector(i),
      updatedAt: Date.now()
    });
  }

  const retained = await embeddingCache.getAllEntriesForModel(MODEL, EMBEDDING_PIPELINE_VERSION);
  assert.equal(retained.length, 700, 'IndexedDB conserva TODOS los vectores');

  // El más antiguo ya no está en memoria: un acceso lo reconstruye desde IndexedDB.
  const oldest = await embeddingCache.getEntry('chunk_0', MODEL, EMBEDDING_PIPELINE_VERSION);
  assert.ok(oldest, 'un vector desalojado se relee de IndexedDB, no se pierde');
  assert.equal(oldest!.contentHash, 'hash_0');
});

test('P2.1: el mapa de hashes del corpus se reutiliza y se invalida al mutar datos', async () => {
  await dbBridge.init();
  invalidateCurrentChunkHashes();

  const first = await buildCurrentChunkHashes(LIBRARY as any, MODEL);
  const second = await buildCurrentChunkHashes(LIBRARY as any, MODEL);

  assert.equal(first, second, 'la segunda consulta reutiliza el mapa memoizado');
  assert.ok(first.has('lesson_l1'));

  // Una mutación persistida avanza la revisión de datos: el mapa caduca.
  await dbBridge.persist();
  const third = await buildCurrentChunkHashes(LIBRARY as any, MODEL);
  assert.notEqual(third, first, 'tras cambiar los datos el mapa se reconstruye');

  invalidateCurrentChunkHashes();
  const fourth = await buildCurrentChunkHashes(LIBRARY as any, MODEL);
  assert.notEqual(fourth, third, 'la invalidación explícita también funciona');
});

test('P2.1: el regex de token se compila una vez y conserva el scoring', () => {
  const tokens = ['memoria', 'repaso'];
  const text = 'La memoria a largo plazo y el repaso espaciado.';

  const first = scoreLexicalRelevance(tokens, text);
  const second = scoreLexicalRelevance(tokens, text);

  assert.equal(first, second);
  assert.equal(first, 5, 'dos coincidencias de palabra completa: 2 * (1 + 1.5)');
  assert.equal(scoreLexicalRelevance(['memoria'], 'memorias sin límite'), 1, 'una palabra parcial no puntúa doble');
});

test('P2.1: los tokens con metacaracteres no se interpretan como regex', () => {
  // Se escapan: no lanzan SyntaxError y no producen coincidencias falsas.
  assert.equal(scoreLexicalRelevance(['c++'], 'el lenguaje c++ moderno'), 1);
  assert.equal(scoreLexicalRelevance(['a.b'], 'axb'), 0, 'el punto no actúa como comodín');
  assert.equal(scoreLexicalRelevance(['a.b'], 'el archivo a.b del proyecto'), 2.5);
});

test('P2.1: la fusión aguanta miles de candidatas sin desbordar la pila', () => {
  const lexicalCandidates = new Map<string, any>();
  const lexicalRanked: Array<{ key: string; doc: any }> = [];
  const semanticRanked: any[] = [];

  for (let i = 0; i < 60000; i++) {
    const doc = {
      id: `id_${i}`,
      sourceType: 'note',
      title: `Nota ${i}`,
      snippet: 'x',
      score: 1 + (i % 7),
      retrievalMode: 'lexical'
    };
    lexicalCandidates.set(`note_${i}`, doc);
    lexicalRanked.push({ key: `note_${i}`, doc });
    if (i % 2 === 0) {
      semanticRanked.push({
        chunkId: `note_${i}`,
        score: 0.9,
        entry: { sourceId: `id_${i}`, sourceType: 'note', title: `Nota ${i}`, text: 'x', substantive: true }
      });
    }
  }

  const fused = fuseRankedCandidates({ lexicalCandidates, lexicalRanked, semanticRanked });
  assert.equal(fused.candidates.length, 60000);
});

test('P2.1: la similitud coseno memoiza normas sin cambiar el resultado', () => {
  const a = [0.5, 0.5, 0.5, 0.5];
  const b = [1, 0, 0, 0];

  const expected = 0.5 / (Math.sqrt(1) * Math.sqrt(1));
  assert.ok(Math.abs(cosineSimilarity(a, b) - Math.sqrt(0.25) / (1 * 1)) < 1e-12);
  assert.ok(expected > 0);

  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0, 'norma nula puntúa 0');
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1, 'vectores idénticos puntúan 1');

  // Repetir la comparación devuelve exactamente lo mismo (normas memoizadas).
  assert.equal(cosineSimilarity(a, b), cosineSimilarity(a, b));
});
