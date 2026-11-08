/**
 * Vectores huérfanos: el material que se borra libera sus vectores.
 *
 * El caché no tiene integridad referencial. `indexChunks` sólo visita los
 * fragmentos que EXISTEN, así que los vectores de una nota, lección o recurso
 * borrado se quedaban en IndexedDB para siempre, y no había forma de liberarlos:
 * `deleteEntry` no tenía ni un llamador.
 *
 * La reconciliación es UN punto (`pruneChunksNotIn`) contra el corpus vivo, no
 * un gancho en cada ruta de borrado: una ruta nueva no puede olvidarse de
 * liberar. Se comprueba también que respeta otros modelos y que es idempotente.
 */
import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';

const MODEL = 'modelo-reconcile';
const OTHER_MODEL = 'modelo-ajeno';

function entry(chunkId: string, modelId: string, text: string) {
  return {
    chunkId,
    sourceType: 'note' as const,
    sourceId: 'n1',
    title: 'Nota',
    text,
    contentHash: `hash-${text}`,
    modelId,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: 3,
    vector: [1, 0, 0],
    updatedAt: Date.now()
  };
}

test('el corpus vivo decide: los vectores del material borrado se eliminan', async () => {
  await embeddingCache.clearCache();
  await embeddingCache.setEntry(entry('note_viva', MODEL, 'contenido vivo'));
  await embeddingCache.setEntry(entry('note_borrada', MODEL, 'contenido borrado'));
  await embeddingCache.setEntry(entry('note_ajena', OTHER_MODEL, 'contenido ajeno'));

  const removed = await embeddingCache.pruneChunksNotIn(new Set(['note_viva']), MODEL);

  assert.strictEqual(removed, 1, 'se libera exactamente el fragmento que ya no existe');
  assert.ok(await embeddingCache.getEntry('note_viva', MODEL), 'el fragmento vivo sigue cacheado');
  assert.strictEqual(
    await embeddingCache.getEntry('note_borrada', MODEL),
    null,
    'el fragmento borrado no puede seguir ocupando IndexedDB'
  );
  assert.ok(
    await embeddingCache.getEntry('note_ajena', OTHER_MODEL),
    'los vectores de OTRO modelo no se tocan'
  );
});

test('es idempotente: una segunda pasada no encuentra nada que liberar', async () => {
  await embeddingCache.clearCache();
  await embeddingCache.setEntry(entry('note_a', MODEL, 'a'));
  await embeddingCache.setEntry(entry('note_b', MODEL, 'b'));

  assert.strictEqual(await embeddingCache.pruneChunksNotIn(new Set(['note_a']), MODEL), 1);
  assert.strictEqual(await embeddingCache.pruneChunksNotIn(new Set(['note_a']), MODEL), 0);
  assert.strictEqual(
    (await embeddingCache.getAllEntriesForModel(MODEL)).length,
    1,
    'queda sólo el fragmento vivo'
  );
});

test('sin corpus no se borra nada por accidente si el conjunto está vacío', async () => {
  await embeddingCache.clearCache();
  await embeddingCache.setEntry(entry('note_c', MODEL, 'c'));

  assert.strictEqual(await embeddingCache.pruneChunksNotIn(new Set(), MODEL), 1);
  assert.strictEqual((await embeddingCache.getAllEntriesForModel(MODEL)).length, 0);
});
