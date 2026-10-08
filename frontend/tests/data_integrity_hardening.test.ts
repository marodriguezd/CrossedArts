import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  generateJsonBackup,
  importJsonBackup,
  validateJsonBackup,
  getDatabaseTables,
  JSON_BACKUP_FORMAT_VERSION
} from '../src/db/exportImport.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../src/lib/localEmbeddings/cache.ts';

async function countRows(table: string): Promise<number> {
  const db = dbBridge.getDatabase();
  const res = db.exec(`SELECT COUNT(*) FROM ${table}`);
  return Number(res[0].values[0][0]);
}

// ---------------------------------------------------------------------------
// F. Validación del respaldo JSON antes de mutar
// ---------------------------------------------------------------------------

test('17.1 A valid backup still roundtrips and carries a compatible format version', async () => {
  await dbBridge.init();
  const dump = generateJsonBackup();

  // Metadatos de versión, compatibles con respaldos antiguos sin `__meta`.
  const meta = (dump as any).__meta;
  assert.ok(meta, 'El respaldo incluye metadatos de formato');
  assert.equal(meta.format, 'crossedarts-json-backup');
  assert.equal(meta.version, JSON_BACKUP_FORMAT_VERSION);

  for (const table of getDatabaseTables()) {
    assert.ok(Array.isArray(dump[table]), `${table} debe seguir siendo un array`);
  }

  const validation = validateJsonBackup(dump);
  assert.ok(validation.valid, validation.error);
});

test('17.2 A backup without the version field is still accepted (backwards compatible)', async () => {
  await dbBridge.init();
  const dump = generateJsonBackup();
  // Respaldo antiguo: sin `__meta`.
  const legacy: Record<string, unknown> = {};
  for (const table of getDatabaseTables()) legacy[table] = dump[table];

  const validation = validateJsonBackup(legacy);
  assert.ok(validation.valid, 'Un respaldo sin metadatos de versión debe seguir siendo válido');
});

test('17.3 Malformed backups are rejected before any destructive mutation', async () => {
  await dbBridge.init();

  const before = {
    resources: await countRows('learning_resource'),
    courses: await countRows('course'),
    lessons: await countRows('lesson'),
    notes: await countRows('note')
  };

  const valid = generateJsonBackup();

  // 1. No es un objeto.
  assert.equal(validateJsonBackup(null).valid, false);
  assert.equal(validateJsonBackup([1, 2, 3]).valid, false);
  assert.equal(validateJsonBackup('un texto').valid, false);
  assert.equal(validateJsonBackup(42).valid, false);

  // 2. Tabla conocida que no es un array.
  assert.equal(validateJsonBackup({ ...valid, course: { id: 'x' } }).valid, false);

  // 3. Tabla de nivel superior desconocida.
  const unknownTable = validateJsonBackup({ ...valid, tabla_inventada: [] });
  assert.equal(unknownTable.valid, false);
  assert.ok(unknownTable.error!.includes('desconocidas'), 'El error nombra las tablas desconocidas');

  // 4. Columna que no existe en el esquema.
  const badColumn = validateJsonBackup({ ...valid, course: [{ id: 'x', columna_inventada: 1 }] });
  assert.equal(badColumn.valid, false);
  assert.ok(badColumn.error!.includes('columnas'), 'El error explica el problema de columnas');

  // 5. Fila que no es un objeto.
  assert.equal(validateJsonBackup({ ...valid, course: ['no soy un objeto'] }).valid, false);
  assert.equal(validateJsonBackup({ ...valid, course: [null] }).valid, false);

  // 6. Versión de formato futura (incompatible).
  const futureVersion = validateJsonBackup({ ...valid, __meta: { format: 'crossedarts-json-backup', version: JSON_BACKUP_FORMAT_VERSION + 1 } });
  assert.equal(futureVersion.valid, false, 'Una versión más moderna debe rechazarse con un mensaje claro');

  // CRÍTICO: los datos del usuario siguen intactos tras todas las validaciones.
  assert.equal(await countRows('learning_resource'), before.resources, 'Los recursos no deben tocarse');
  assert.equal(await countRows('course'), before.courses, 'Los cursos no deben tocarse');
  assert.equal(await countRows('lesson'), before.lessons, 'Las lecciones no deben tocarse');
  assert.equal(await countRows('note'), before.notes, 'Las notas no deben tocarse');
});

test('17.4 importJsonBackup() refuses a malformed payload without deleting existing rows', async () => {
  await dbBridge.init();
  const before = await countRows('course');
  assert.ok(before > 0, 'Hay cursos de demostración');

  // El payload es válido en la forma pero lleva una tabla desconocida: la
  // importación debe abortar ANTES de cualquier DELETE.
  const dump = generateJsonBackup();
  const poisoned: Record<string, unknown> = { ...dump, tabla_inventada: [{ id: 'x' }] };

  await assert.rejects(
    async () => importJsonBackup(poisoned as any),
    /desconocidas/i,
    'La importación debe fallar con un mensaje en español'
  );

  assert.equal(await countRows('course'), before, 'Ninguna fila existente debe eliminarse tras un rechazo');

  // Sigue habiendo un curso real: nada se ha vaciado a medias.
  const db = dbBridge.getDatabase();
  const check = db.exec("SELECT title FROM learning_resource WHERE type = 'course' LIMIT 1");
  assert.ok(check.length > 0, 'Los datos reales siguen disponibles');
});

test('17.5 A valid import still restores data correctly (no regression)', async () => {
  await dbBridge.init();
  const initial = generateJsonBackup();
  const initialCourses = initial['course'].length;

  const custom = JSON.parse(JSON.stringify(initial));
  custom['learning_resource'].push({
    id: 'course-validado-17',
    title: 'Curso Tras Validación',
    description: 'Importado con validación previa',
    cover_path: null,
    category: 'Test',
    status: 'NOT_STARTED',
    source_path: null,
    type: 'course',
    created_at: '2026-01-01 00:00:00',
    updated_at: '2026-01-01 00:00:00'
  });
  custom['course'].push({
    id: 'course-validado-17',
    instructor: 'Ada Lovelace',
    difficulty: 'ADVANCED',
    total_duration_minutes: 60,
    total_lessons: 0,
    completed_lessons: 0
  });

  await importJsonBackup(custom);
  const db = dbBridge.getDatabase();
  const found = db.exec("SELECT title FROM learning_resource WHERE id = 'course-validado-17'");
  assert.ok(found.length > 0, 'El curso importado existe');

  // Restaurar el estado original.
  await importJsonBackup(initial);
  const after = await countRows('course');
  assert.equal(after, initialCourses, 'La restauración devuelve el estado original');
});

// ---------------------------------------------------------------------------
// E. Versionado de caché del Service Worker
// ---------------------------------------------------------------------------

test('17.6 The service worker versions its app-shell cache and purges old ones on activation', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

  // Constante de versión explícita usada en el nombre de la caché.
  assert.ok(/const APP_SHELL_VERSION = 'v\d+'/.test(sw), 'Debe existir una versión explícita del shell');
  assert.ok(sw.includes('CACHE_PREFIX'), 'El nombre de caché debe llevar un prefijo propio');
  assert.ok(sw.includes('${CACHE_PREFIX}${APP_SHELL_VERSION}'), 'La caché incluye la versión');

  // Las cachés antiguas del propio servicio se borran al activar.
  assert.ok(/activate[\s\S]*?key\.startsWith\(CACHE_PREFIX\)[\s\S]*?caches\.delete/.test(sw),
    'Debe eliminar las cachés de shell antiguas en la activación');

  // Compatibilidad con rutas relativas de GitHub Pages.
  assert.ok(sw.includes("'./'") && sw.includes("'./index.html'"), 'Los assets deben ser relativos');
  assert.ok(!/https?:\/\//.test(sw), 'No debe haber dependencias externas en el service worker');

  // Offline-first preservado y WASM de SQLite precacheado.
  assert.ok(sw.includes('sql-wasm.wasm'), 'El WASM de SQLite debe precachearse');
  assert.ok(sw.includes("addEventListener('fetch'"), 'Debe interceptar peticiones para funcionar sin red');

  // No se cachean orígenes externos (Ollama / APIs de IA).
  assert.ok(sw.includes('url.origin !== self.location.origin'), 'Las peticiones de otros orígenes se ignoran');
});

// ---------------------------------------------------------------------------
// G. Caché de embeddings
// ---------------------------------------------------------------------------

test('17.7 getAllEntriesForModel filters correctly by model, pipeline version and dimension', async () => {
  const vector = new Array(384).fill(0.1);

  await embeddingCache.setEntry({
    chunkId: 'chunk-modelo-a',
    sourceType: 'lesson',
    sourceId: 'l1',
    title: 'Lección A',
    text: 'contenido A',
    contentHash: 'hash-a',
    modelId: 'modelo-a',
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: 384,
    vector,
    updatedAt: 1
  });

  await embeddingCache.setEntry({
    chunkId: 'chunk-modelo-b',
    sourceType: 'lesson',
    sourceId: 'l2',
    title: 'Lección B',
    text: 'contenido B',
    contentHash: 'hash-b',
    modelId: 'modelo-b',
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: 384,
    vector,
    updatedAt: 2
  });

  // Vector con dimensión incorrecta: debe excluirse aunque el modelo coincida.
  await embeddingCache.setEntry({
    chunkId: 'chunk-dimension-mala',
    sourceType: 'lesson',
    sourceId: 'l3',
    title: 'Lección C',
    text: 'contenido C',
    contentHash: 'hash-c',
    modelId: 'modelo-a',
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: 384,
    vector: new Array(10).fill(0.5),
    updatedAt: 3
  });

  // Versión de pipeline antigua: debe excluirse.
  await embeddingCache.setEntry({
    chunkId: 'chunk-pipeline-viejo',
    sourceType: 'lesson',
    sourceId: 'l4',
    title: 'Lección D',
    text: 'contenido D',
    contentHash: 'hash-d',
    modelId: 'modelo-a',
    pipelineVersion: 'v0.0-obsoleto',
    dimensions: 384,
    vector,
    updatedAt: 4
  });

  const forA = await embeddingCache.getAllEntriesForModel('modelo-a');
  assert.equal(forA.length, 1, 'Solo el vector válido del modelo A debe devolverse');
  assert.equal(forA[0].chunkId, 'chunk-modelo-a');

  const forB = await embeddingCache.getAllEntriesForModel('modelo-b');
  assert.equal(forB.length, 1);
  assert.equal(forB[0].chunkId, 'chunk-modelo-b');

  const unknown = await embeddingCache.getAllEntriesForModel('modelo-inexistente');
  assert.equal(unknown.length, 0, 'Un modelo sin entradas devuelve una lista vacía');

  await embeddingCache.clearCache();
});

test('17.8 The embedding cache declares the model+pipeline indexes it relies on', () => {
  const cache = readFileSync(new URL('../src/lib/localEmbeddings/cache.ts', import.meta.url), 'utf8');
  // Esquema v3: clave lógica compuesta e índice (modelId, pipelineVersion).
  assert.ok(cache.includes("keyPath: 'cacheKey'"), 'El almacén v3 debe usar la clave lógica compuesta');
  assert.ok(cache.includes("['modelId', 'pipelineVersion']"), 'El índice compuesto modelo+pipeline debe existir en el esquema');
  assert.ok(cache.includes("indexNames.contains('modelPipeline')"), 'Debe comprobarse la disponibilidad del índice');
  assert.ok(cache.includes("index('modelPipeline').getAll("), 'Debe consultarse el índice compuesto en lugar de getAll()');
  // La degradación segura se mantiene si el índice no está disponible.
  assert.ok(cache.includes('store.getAll()'), 'Debe existir la degradación a lectura completa');
});

test('17.9 pruneOtherModels removes stale model/pipeline entries and keeps the active one', async () => {
  const vector = new Array(4).fill(0.1);
  const entry = (chunkId: string, modelId: string, pipelineVersion: string) => ({
    chunkId,
    sourceType: 'lesson',
    sourceId: 'l1',
    title: 'Lección',
    text: 'contenido',
    contentHash: `hash-${chunkId}`,
    modelId,
    pipelineVersion,
    dimensions: 4,
    vector,
    updatedAt: 1
  });

  await embeddingCache.setEntry(entry('keep', 'modelo-activo', EMBEDDING_PIPELINE_VERSION));
  await embeddingCache.setEntry(entry('old-model', 'modelo-antiguo', EMBEDDING_PIPELINE_VERSION));
  await embeddingCache.setEntry(entry('old-pipeline', 'modelo-activo', 'v0.0-obsoleto'));

  const removed = await embeddingCache.pruneOtherModels('modelo-activo', EMBEDDING_PIPELINE_VERSION);
  assert.ok(removed >= 2, `Debe purgar al menos las dos entradas obsoletas (purgadas: ${removed})`);

  const active = await embeddingCache.getAllEntriesForModel('modelo-activo', EMBEDDING_PIPELINE_VERSION);
  assert.deepEqual(active.map((e) => e.chunkId), ['keep'], 'La entrada del modelo activo se conserva');

  await embeddingCache.clearCache();
});

test('17.10 pruneStaleCache on the embedding engine never throws outside a browser', async () => {
  const { localEmbeddingEngine } = await import('../src/lib/localEmbeddings/engine.ts');
  const result = await localEmbeddingEngine.pruneStaleCache('modelo-activo');
  assert.equal(typeof result, 'number');
  assert.ok(result >= 0);
});

test('17.11 the semantic runtime prunes stale embeddings before indexing', () => {
  const source = readFileSync(new URL('../src/services/localAiRuntime.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('pruneStaleCache?.'), 'El runtime debe invocar la purga de forma best-effort');
  const cache = readFileSync(new URL('../src/lib/localEmbeddings/cache.ts', import.meta.url), 'utf8');
  assert.ok(cache.includes('pruneOtherModels'), 'La caché debe exponer la purga por modelo');
});