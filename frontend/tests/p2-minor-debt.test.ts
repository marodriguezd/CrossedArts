import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  EMBEDDINGS_SECTION_KEY,
  generateJsonBackup,
  importEmbeddingsSection,
  utf8ByteLength,
  validateJsonBackup
} from '../src/db/exportImport.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { EMBEDDING_PIPELINE_VERSION, embeddingCache } from '../src/lib/localEmbeddings/cache.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../src/lib/localEmbeddings/registry.ts';

/**
 * Deuda menor de la revisión: trabajo duplicado en la restauración y en el
 * respaldo, medido en transacciones reales de IndexedDB (fake-indexeddb).
 */

const DIMENSIONS = 256;

function vector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => Number(((seed + i) / 1000).toFixed(6)));
}

function section(chunkIds: string[]) {
  return {
    format: 'crossedarts-embeddings' as const,
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: DIMENSIONS,
    entries: chunkIds.map((chunkId, index) => ({
      chunkId,
      contentHash: `hash-${chunkId}`,
      vector: vector(index + 1),
      substantive: true
    }))
  };
}

/**
 * Cuenta transacciones de IndexedDB: es la unidad que de verdad se pagaba una
 * vez por vector (commit incluido).
 */
function countTransactions() {
  const original = IDBDatabase.prototype.transaction;
  let count = 0;
  IDBDatabase.prototype.transaction = function patched(this: IDBDatabase, ...args: any[]) {
    count += 1;
    return (original as any).apply(this, args);
  } as typeof IDBDatabase.prototype.transaction;

  return {
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
    restore() {
      IDBDatabase.prototype.transaction = original;
    }
  };
}

test('SP5: restaurar 200 vectores usa UNA transacción, no una por vector', async () => {
  await embeddingCache.clearCache();
  const counter = countTransactions();
  try {
    const result = await importEmbeddingsSection(
      section(Array.from({ length: 200 }, (_, i) => `bulk_${i}`)),
      { modelId: DEFAULT_EMBEDDING_MODEL_ID, pipelineVersion: EMBEDDING_PIPELINE_VERSION }
    );

    assert.equal(result.imported, 200);
    assert.equal(result.skipped, 0);
    assert.equal(counter.count, 1, `se abrieron ${counter.count} transacciones para 200 vectores`);
  } finally {
    counter.restore();
  }

  const stored = await embeddingCache.getAllEntriesForModel(
    DEFAULT_EMBEDDING_MODEL_ID,
    EMBEDDING_PIPELINE_VERSION
  );
  assert.equal(stored.length, 200, 'el lote completo queda en IndexedDB');
  assert.ok(
    stored.every((entry) => entry.vector.length === DIMENSIONS && entry.substantive === true),
    'cada entrada conserva dimensiones y procedencia'
  );
});

test('SP5: un lote vacío no abre ninguna transacción', async () => {
  const counter = countTransactions();
  try {
    assert.equal(await embeddingCache.setEntries([]), 0);
    assert.equal(counter.count, 0);
  } finally {
    counter.restore();
  }
});

test('S5: validateJsonBackup entrega la sección ya validada para no repetir el recorrido', async () => {
  await dbBridge.init();
  const dump = generateJsonBackup();
  (dump as any)[EMBEDDINGS_SECTION_KEY] = section(['s5_a', 's5_b']);

  const validation = validateJsonBackup(dump);
  assert.equal(validation.valid, true);
  assert.ok(validation.embeddings, 'la validación debe devolver la sección usable');
  assert.equal(validation.embeddings!.section!.entries.length, 2);
  assert.equal(validation.embeddings!.dropped, 0);
});

test('S5: sin sección de embeddings la validación no inventa trabajo', async () => {
  await dbBridge.init();
  const validation = validateJsonBackup(generateJsonBackup());
  assert.equal(validation.valid, true);
  assert.equal(validation.embeddings?.section, undefined);
});

test('S4: utf8ByteLength coincide con TextEncoder sin copiar el texto', () => {
  const encoder = new TextEncoder();
  const samples = [
    '',
    'hola',
    'ñandú, acción y corazón',
    '中文段落',
    'emoji 🎓 y bandera 🇪🇸',
    'control\u0000\u001f',
    'a'.repeat(1000)
  ];

  for (const sample of samples) {
    assert.equal(
      utf8ByteLength(sample),
      encoder.encode(sample).byteLength,
      `longitud UTF-8 incorrecta para ${JSON.stringify(sample.slice(0, 20))}`
    );
  }

  // Un surrogate suelto se cuenta como el reemplazo de 3 bytes que produciría
  // el codificador.
  assert.equal(utf8ByteLength('\ud800'), encoder.encode('\ud800').byteLength);
});
