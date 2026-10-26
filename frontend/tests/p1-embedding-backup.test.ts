import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import {
  EMBEDDINGS_SECTION_KEY,
  JSON_BACKUP_MAX_BYTES,
  buildEmbeddingsExport,
  generateJsonBackup,
  generateJsonBackupWithEmbeddings,
  importJsonBackup,
  parseJsonBackupText,
  validateEmbeddingsSection,
  validateJsonBackup
} from '../src/db/exportImport.ts';
import { EMBEDDING_PIPELINE_VERSION, embeddingCache } from '../src/lib/localEmbeddings/cache.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../src/lib/localEmbeddings/registry.ts';

/**
 * P1.7 — la caché de embeddings viaja en el respaldo JSON.
 *
 * Antes: el respaldo exportaba las 13 tablas y nada más, así que restaurar en
 * el mismo navegador costaba volver a ejecutar el modelo sobre toda la
 * biblioteca; y una sección desconocida abortaba la validación.
 */

const DIMENSIONS = 256;

function vector(seed: number): number[] {
  return Array.from({ length: DIMENSIONS }, (_, i) => Number(((seed + i) / 1000).toFixed(6)));
}

function section(entries: any[]) {
  return {
    format: 'crossedarts-embeddings',
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: DIMENSIONS,
    entries
  };
}

test('P1.7: el volcado SQLite puro no incluye la sección derivada', async () => {
  await dbBridge.init();
  const plain = generateJsonBackup();
  assert.equal(plain[EMBEDDINGS_SECTION_KEY], undefined);
  assert.equal(plain.__meta.version, 2);
});

test('P1.7: la exportación completa adjunta la caché del modelo activo', async () => {
  await dbBridge.init();
  await embeddingCache.clearCache();
  await embeddingCache.setEntry({
    chunkId: 'note_b1',
    sourceType: 'note',
    sourceId: 'note_b1',
    title: 'Nota respaldada',
    text: 'cuerpo',
    contentHash: 'hash-b1',
    modelId: DEFAULT_EMBEDDING_MODEL_ID,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: DIMENSIONS,
    vector: vector(1),
    updatedAt: Date.now(),
    substantive: true,
    resourceId: 'c1',
    lessonId: 'l1'
  });

  const dump = await generateJsonBackupWithEmbeddings();
  const exported = dump[EMBEDDINGS_SECTION_KEY];
  assert.ok(exported, 'la sección debe viajar en el respaldo');
  assert.equal(exported.format, 'crossedarts-embeddings');
  assert.equal(exported.modelId, DEFAULT_EMBEDDING_MODEL_ID);
  assert.equal(exported.pipelineVersion, EMBEDDING_PIPELINE_VERSION);
  assert.equal(exported.dimensions, DIMENSIONS);

  const entry = exported.entries.find((e: any) => e.chunkId === 'note_b1');
  assert.ok(entry, 'el vector exportado debe existir');
  assert.equal(entry.vector.length, DIMENSIONS);
  assert.equal(entry.contentHash, 'hash-b1');
  assert.equal(entry.substantive, true);
  assert.equal(entry.resourceId, 'c1');
  assert.equal(entry.lessonId, 'l1');
  assert.equal(entry.sourceType, 'note');
  assert.equal(entry.title, 'Nota respaldada');

  // La sección debe sobrevivir como parte de un respaldo válido.
  assert.equal(validateJsonBackup(dump).valid, true);
});

test('P1.7: un respaldo sin sección de embeddings sigue siendo válido', () => {
  const legacy = generateJsonBackup();
  assert.equal(validateJsonBackup(legacy).valid, true);

  const legacyV1 = { ...legacy, __meta: { format: 'crossedarts-json-backup', version: 1 } };
  assert.equal(validateJsonBackup(legacyV1).valid, true);
});

test('P1.7: una sección de embeddings malformada invalida el respaldo', () => {
  const base = generateJsonBackup();

  for (const bad of [
    { ...section([]), format: 'otra-cosa' },
    { ...section([]), modelId: '' },
    { ...section([]), pipelineVersion: 7 },
    { ...section([]), dimensions: 0 },
    { ...section([]), entries: 'no soy una lista' },
    'una cadena',
    []
  ]) {
    const result = validateJsonBackup({ ...base, [EMBEDDINGS_SECTION_KEY]: bad });
    assert.equal(result.valid, false, `debe rechazar ${JSON.stringify(bad).slice(0, 40)}`);
    assert.ok(result.error && result.error.length > 0, 'el error debe explicarse al usuario');
  }
});

test('P1.7: las entradas corruptas se descartan sin tumbar el resto', () => {
  const check = validateEmbeddingsSection(
    section([
      { chunkId: 'ok_1', contentHash: 'h1', vector: vector(2) },
      { chunkId: '', contentHash: 'h2', vector: vector(3) },
      { chunkId: 'corto', contentHash: 'h3', vector: [1, 2, 3] },
      { chunkId: 'nan', contentHash: 'h4', vector: Array.from({ length: DIMENSIONS }, () => NaN) },
      { chunkId: 'sin_hash', vector: vector(5) },
      null,
      { chunkId: 'ok_2', contentHash: 'h5', vector: vector(6), substantive: true, lessonId: 'l9' }
    ])
  );

  assert.equal(check.valid, true);
  assert.equal(check.dropped, 5);
  assert.deepEqual(check.section!.entries.map((e) => e.chunkId), ['ok_1', 'ok_2']);
  assert.equal(check.section!.entries[1].substantive, true);
  assert.equal(check.section!.entries[1].lessonId, 'l9');
});

test('P1.7: round-trip — restaurar un respaldo conserva los vectores y omite el corrupto', async () => {
  await dbBridge.init();
  await embeddingCache.clearCache();

  const dump = generateJsonBackup();
  dump[EMBEDDINGS_SECTION_KEY] = section([
    { chunkId: 'note_rt1', contentHash: 'hash-rt1', vector: vector(10), substantive: true, lessonId: 'l1' },
    { chunkId: 'note_rt2', contentHash: 'hash-rt2', vector: vector(11) },
    { chunkId: 'note_roto', contentHash: 'hash-rt3', vector: [0.1, 0.2] }
  ]);

  assert.equal(validateJsonBackup(dump).valid, true);
  await importJsonBackup(dump as any);

  const restored = await embeddingCache.getAllEntriesForModel(
    DEFAULT_EMBEDDING_MODEL_ID,
    EMBEDDING_PIPELINE_VERSION
  );
  const ids = restored.map((e) => e.chunkId).sort();
  assert.deepEqual(ids, ['note_rt1', 'note_rt2'], 'el vector de dimensión incorrecta no debe importarse');

  const first = restored.find((e) => e.chunkId === 'note_rt1')!;
  assert.equal(first.vector.length, DIMENSIONS);
  assert.equal(first.contentHash, 'hash-rt1');
  assert.equal(first.substantive, true);
  assert.equal(first.lessonId, 'l1');
});

test('P1.7: un vector de otro modelo no se sirve como si fuera del activo', async () => {
  await dbBridge.init();
  await embeddingCache.clearCache();

  const dump = generateJsonBackup();
  dump[EMBEDDINGS_SECTION_KEY] = {
    ...section([{ chunkId: 'note_ajena', contentHash: 'h', vector: vector(20) }]),
    modelId: 'Xenova/all-MiniLM-L6-v2'
  };

  assert.equal(validateJsonBackup(dump).valid, true);
  await importJsonBackup(dump as any);

  const active = await embeddingCache.getAllEntriesForModel(
    DEFAULT_EMBEDDING_MODEL_ID,
    EMBEDDING_PIPELINE_VERSION
  );
  assert.equal(active.length, 0, 'un vector ajeno no debe quedar bajo el modelo activo');
});

test('P1.7: el límite de tamaño se aplica antes de parsear', () => {
  assert.equal(JSON_BACKUP_MAX_BYTES, 50 * 1024 * 1024);

  const parsed = parseJsonBackupText(JSON.stringify({ course: [] }));
  assert.deepEqual(parsed, { course: [] });

  assert.throws(() => parseJsonBackupText('{ esto no es json'), /formato|válido/i);
});

test('P1.7: la exportación parcial de vectores omite los modelos sin caché', async () => {
  await dbBridge.init();
  await embeddingCache.clearCache();
  const sectionWithoutData = await buildEmbeddingsExport(DEFAULT_EMBEDDING_MODEL_ID, EMBEDDING_PIPELINE_VERSION);
  assert.equal(sectionWithoutData, null, 'sin vectores no debe inventarse una sección vacía');
});
