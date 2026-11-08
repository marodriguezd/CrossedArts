/**
 * Ciclo de vida del manifiesto de contenido (IndexedDB real, `fake-indexeddb`).
 *
 * Dos defectos que sólo se ven cuando el manifiesto SÍ persiste:
 *
 *  1. `persist` sólo escribía: la purga borraba de memoria pero las claves
 *     eliminadas seguían en IndexedDB, así que cada arranque las recargaba y las
 *     volvía a purgar. El manifiesto nunca encogía.
 *  2. `ensureLoaded` cargaba UNA sola vez por instancia: tras resolver el corpus
 *     para un modelo, resolverlo para otro no leía sus entradas guardadas y
 *     recalculaba todos los SHA-256. La identidad es (modelo, pipeline), así que
 *     la carga también.
 */
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildManifestKey,
  computeContentSignature,
  semanticContentManifest,
  type ManifestEntry
} from '../src/lib/localEmbeddings/contentManifest.ts';
import { EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';
import { computeSha256ContentHash, type SemanticChunk } from '../src/lib/localEmbeddings/chunking.ts';

const IDB_NAME = 'CrossedArts_SemanticManifest';
const STORE_NAME = 'chunk_hashes';

function openManifestDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('modelPipeline', ['modelId', 'pipelineVersion'], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Claves realmente guardadas para una identidad: lo que vería el próximo arranque. */
async function storedKeys(modelId: string, pipelineVersion: string): Promise<string[]> {
  const db = await openManifestDb();
  try {
    return await new Promise<string[]>((resolve) => {
      const store = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
      if (!store.indexNames.contains('modelPipeline')) {
        resolve([]);
        return;
      }
      const keys: string[] = [];
      const request = store
        .index('modelPipeline')
        .openKeyCursor(IDBKeyRange.only([modelId, pipelineVersion]));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(keys);
          return;
        }
        keys.push(String(cursor.primaryKey));
        cursor.continue();
      };
      request.onerror = () => resolve(keys);
    });
  } finally {
    db.close();
  }
}

function chunk(chunkId: string, text: string): SemanticChunk {
  return {
    chunkId,
    sourceType: 'note',
    sourceId: 'n1',
    title: 'Nota',
    text,
    contentHash: ''
  };
}

test('la purga se persiste: la clave eliminada no vuelve en el siguiente arranque', async () => {
  await semanticContentManifest.clear();
  const modelId = 'modelo-purga';

  await semanticContentManifest.resolveChunkHashes(
    [chunk('note_a', 'Contenido A'), chunk('note_b', 'Contenido B')],
    modelId
  );
  const before = await storedKeys(modelId, EMBEDDING_PIPELINE_VERSION);
  assert.ok(
    before.includes(buildManifestKey(modelId, EMBEDDING_PIPELINE_VERSION, 'note_b')),
    'el fragmento debe estar guardado antes de purgarlo'
  );

  const after = await semanticContentManifest.resolveChunkHashes(
    [chunk('note_a', 'Contenido A')],
    modelId
  );
  assert.strictEqual(after.purged, 1, 'el fragmento ausente del corpus se purga');

  const persisted = await storedKeys(modelId, EMBEDDING_PIPELINE_VERSION);
  assert.ok(
    !persisted.includes(buildManifestKey(modelId, EMBEDDING_PIPELINE_VERSION, 'note_b')),
    'la entrada purgada no puede seguir en IndexedDB: se recargaría en cada arranque'
  );
  assert.ok(
    persisted.includes(buildManifestKey(modelId, EMBEDDING_PIPELINE_VERSION, 'note_a')),
    'el fragmento vivo sigue guardado'
  );
});

test('cada identidad (modelo, pipeline) se carga una vez: cambiar de modelo lee sus hashes', async () => {
  await semanticContentManifest.clear();
  const modelA = 'modelo-a';
  const modelB = 'modelo-b';
  const text = 'Mismo texto evaluado por dos modelos distintos.';
  const target = chunk('note_same', text);
  const hash = await computeSha256ContentHash(text);

  const db = await openManifestDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({
      key: buildManifestKey(modelB, EMBEDDING_PIPELINE_VERSION, 'note_same'),
      chunkId: 'note_same',
      modelId: modelB,
      pipelineVersion: EMBEDDING_PIPELINE_VERSION,
      signature: computeContentSignature(text),
      contentHash: hash
    } satisfies ManifestEntry);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();

  const forA = await semanticContentManifest.resolveChunkHashes([target], modelA);
  assert.strictEqual(forA.recomputed, 1, 'la identidad A no tenía nada guardado');

  const forB = await semanticContentManifest.resolveChunkHashes([target], modelB);
  assert.strictEqual(
    forB.reused,
    1,
    'la identidad B se lee de IndexedDB aunque A ya estuviera cargada'
  );
  assert.strictEqual(forB.recomputed, 0);
  assert.strictEqual(forB.chunks[0].contentHash, hash);
});

test('olvidar una identidad borra sólo sus claves y no toca las demás', async () => {
  await semanticContentManifest.clear();
  const modelA = 'modelo-olvido-a';
  const modelB = 'modelo-olvido-b';
  const target = chunk('note_olvido', 'Texto que ambos modelos han indexado.');

  await semanticContentManifest.resolveChunkHashes([target], modelA);
  await semanticContentManifest.resolveChunkHashes([target], modelB);

  await semanticContentManifest.clear(modelA, EMBEDDING_PIPELINE_VERSION);

  assert.strictEqual(
    (await storedKeys(modelA, EMBEDDING_PIPELINE_VERSION)).length,
    0,
    'olvidar A borra exactamente las claves de A'
  );
  assert.strictEqual(
    (await storedKeys(modelB, EMBEDDING_PIPELINE_VERSION)).length,
    1,
    'la identidad B sigue guardada'
  );

  const againB = await semanticContentManifest.resolveChunkHashes([target], modelB);
  assert.strictEqual(againB.reused, 1, 'olvidar A no obliga a recalcular B');
});
