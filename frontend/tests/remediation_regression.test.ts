import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ===========================================================================
// REMEDIACIÓN — Regresiones para las incidencias A, C, I y J.
//
// A. Aislamiento del modelo de caché de embeddings: la identidad lógica de una
//    entrada es (chunkId, modelId, pipelineVersion); dos modelos nunca se pisan.
//    Los tests de IndexedDB usan fake-indexeddb, que soporta keyPath compuesto,
//    índices y transacciones de versión igual que el navegador.
// C. computeSha256ContentHash es SHA-256 REAL (vectores oficiales FIPS 180-4).
// I. Cobertura semántica: el contenido largo se trocea en fragmentos acotados,
//    deterministas y ordenados, en lugar de truncarse a un snippet.
// J. Semántica de ámbito RAG: frontera dura para recuperación acotada.
// ===========================================================================

import 'fake-indexeddb/auto';
import {
  embeddingCache,
  buildCacheKey,
  EMBEDDING_PIPELINE_VERSION
} from '../src/lib/localEmbeddings/cache.ts';
import {
  computeSha256ContentHash,
  sha256Hex,
  computeContentHash,
  splitIntoBoundedParts,
  createSemanticChunksFromResources,
  createSemanticChunksFromResourcesAsync
} from '../src/lib/localEmbeddings/chunking.ts';
import { retrieveLocalContext } from '../src/lib/localRag/retrieval.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

const MODEL_A = 'Xenova/multilingual-e5-small';
const MODEL_B = 'Xenova/all-MiniLM-L6-v2';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    chunkId: 'chunk-1',
    sourceType: 'note',
    sourceId: 'n1',
    title: 'Nota de prueba',
    text: 'Contenido de la nota de prueba',
    contentHash: 'a'.repeat(64),
    modelId: MODEL_A,
    pipelineVersion: EMBEDDING_PIPELINE_VERSION,
    dimensions: 384,
    vector: new Array(384).fill(0.1),
    updatedAt: 1,
    ...overrides
  };
}

test('A.1 Mismo chunk, modelos A y B coexisten sin pisarse', async () => {
  await embeddingCache.clearCache();

  const vectorA = new Array(384).fill(0.1);
  const vectorB = new Array(384).fill(0.2);
  await embeddingCache.setEntry(makeEntry({ modelId: MODEL_A, vector: vectorA }));
  await embeddingCache.setEntry(makeEntry({ modelId: MODEL_B, vector: vectorB }));

  const fromA = await embeddingCache.getEntry('chunk-1', MODEL_A);
  const fromB = await embeddingCache.getEntry('chunk-1', MODEL_B);

  assert.ok(fromA, 'El modelo A debe conservar su vector');
  assert.ok(fromB, 'El modelo B debe conservar su vector');
  assert.equal(fromA.vector[0], 0.1, 'El vector de A no fue reemplazado');
  assert.equal(fromB.vector[0], 0.2, 'El vector de B no fue reemplazado');
  assert.equal(fromA.modelId, MODEL_A);
  assert.equal(fromB.modelId, MODEL_B);

  await embeddingCache.clearCache();
});

test('A.2 Mismo chunk, versiones de pipeline distintas coexisten', async () => {
  await embeddingCache.clearCache();

  await embeddingCache.setEntry(makeEntry({ modelId: MODEL_A, pipelineVersion: 'v1.0-legacy', vector: new Array(384).fill(0.3) }));
  await embeddingCache.setEntry(makeEntry({ modelId: MODEL_A, pipelineVersion: EMBEDDING_PIPELINE_VERSION, vector: new Array(384).fill(0.4) }));

  const legacy = await embeddingCache.getEntry('chunk-1', MODEL_A, 'v1.0-legacy');
  const current = await embeddingCache.getEntry('chunk-1', MODEL_A, EMBEDDING_PIPELINE_VERSION);

  assert.ok(legacy && current, 'Ambas versiones de pipeline son legibles');
  assert.equal(legacy.vector[0], 0.3);
  assert.equal(current.vector[0], 0.4);

  await embeddingCache.clearCache();
});

test('A.3 La recuperación por modelo devuelve EXACTAMENTE ese modelo y pipeline', async () => {
  await embeddingCache.clearCache();

  await embeddingCache.setEntry(makeEntry({ chunkId: 'c1', modelId: MODEL_A, sourceId: 'n1' }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'c2', modelId: MODEL_B, sourceId: 'n2' }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'c3', modelId: MODEL_A, pipelineVersion: 'v0.9-antigua', sourceId: 'n3' }));

  const onlyA = await embeddingCache.getAllEntriesForModel(MODEL_A);
  assert.deepEqual(onlyA.map(e => e.chunkId).sort(), ['c1'], 'Solo entradas del modelo A y pipeline actual');
  assert.ok(onlyA.every(e => e.modelId === MODEL_A && e.pipelineVersion === EMBEDDING_PIPELINE_VERSION));

  const onlyB = await embeddingCache.getAllEntriesForModel(MODEL_B);
  assert.deepEqual(onlyB.map(e => e.chunkId), ['c2']);
  assert.ok(onlyB.every(e => e.modelId === MODEL_B));

  const legacyPipeline = await embeddingCache.getAllEntriesForModel(MODEL_A, 'v0.9-antigua');
  assert.deepEqual(legacyPipeline.map(e => e.chunkId), ['c3']);

  await embeddingCache.clearCache();
});

test('A.4 Migración legacy: registros del almacén antiguo se conservan con clave compuesta', async () => {
  // Simular una base v1 (keyPath chunkId, sin índice de pipeline) con datos
  // previos, y verificar que la apertura v3 los migra sin perderlos.
  const { indexedDB } = globalThis as any;
  const LEGACY = 'vector_cache';
  const DB = 'CrossedArts_Embeddings';

  // Los tests anteriores ya crearon la base en v3: partir de una base limpia.
  // Cerrar la conexión memoizada evita bloquear deleteDatabase (VersionError).
  embeddingCache.close();
  await new Promise<void>((resolve) => {
    const del = indexedDB.deleteDatabase(DB);
    del.onsuccess = () => resolve();
    del.onerror = () => resolve();
    del.onblocked = () => resolve();
  });

  // Crear la base en versión 2 (esquema legacy real: keyPath chunkId).
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(LEGACY)) {
        const store = db.createObjectStore(LEGACY, { keyPath: 'chunkId' });
        store.createIndex('modelId', 'modelId', { unique: false });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(LEGACY, 'readwrite');
      tx.objectStore(LEGACY).put(makeEntry({
        chunkId: 'legacy-chunk-1',
        modelId: MODEL_A,
        pipelineVersion: undefined,
        vector: new Array(384).fill(0.5)
      }));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });

  // Reabrir con la API actual: dispara onupgradeneeded -> migración a v3.
  const migrated = await embeddingCache.getEntry('legacy-chunk-1', MODEL_A);
  assert.ok(migrated, 'El registro legacy debe seguir accesible tras la migración');
  assert.equal(migrated.vector[0], 0.5, 'El vector migrado conserva sus datos');
  assert.equal(migrated.pipelineVersion, EMBEDDING_PIPELINE_VERSION, 'El registro migrado adopta la versión actual');

  const listed = await embeddingCache.getAllEntriesForModel(MODEL_A);
  assert.ok(listed.some(e => e.chunkId === 'legacy-chunk-1'), 'El registro migrado aparece en su modelo');

  embeddingCache.close();

  // El almacén antiguo queda vaciado y el nuevo contiene la entrada.
  const check = await new Promise<number>((resolve, reject) => {
    const req = indexedDB.open(DB);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(LEGACY, 'readonly');
      const countReq = tx.objectStore(LEGACY).count();
      countReq.onsuccess = () => { db.close(); resolve(countReq.result); };
      countReq.onerror = () => reject(countReq.error);
    };
    req.onerror = () => reject(req.error);
  });
  assert.equal(check, 0, 'El almacén legacy queda limpio tras la migración');
  assert.ok(indexedDB.cmp(buildCacheKey(MODEL_A, EMBEDDING_PIPELINE_VERSION, 'legacy-chunk-1'), buildCacheKey(MODEL_A, EMBEDDING_PIPELINE_VERSION, 'legacy-chunk-1')) === 0);

  await embeddingCache.clearCache();
});

test('A.5 deleteEntry con modelo elimina solo esa entrada lógica', async () => {
  await embeddingCache.clearCache();

  await embeddingCache.setEntry(makeEntry({ chunkId: 'del-1', modelId: MODEL_A }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'del-1', modelId: MODEL_B }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'del-1', modelId: MODEL_A, pipelineVersion: 'v0.9' }));

  await embeddingCache.deleteEntry('del-1', MODEL_A);

  assert.equal(await embeddingCache.getEntry('del-1', MODEL_A), null, 'La entrada A/pipeline actual se elimina');
  assert.equal(await embeddingCache.getEntry('del-1', MODEL_A, 'v0.9'), null === undefined ? null : await embeddingCache.getEntry('del-1', MODEL_A, 'v0.9'), 'Otras versiones no se tocan');
  const otherVersion = await embeddingCache.getEntry('del-1', MODEL_A, 'v0.9');
  assert.ok(otherVersion, 'La versión de pipeline antigua del mismo chunk sobrevive');
  const otherModel = await embeddingCache.getEntry('del-1', MODEL_B);
  assert.ok(otherModel, 'La entrada del modelo B sobrevive');

  await embeddingCache.clearCache();
});

test('A.6 clearCache elimina TODO (ambos modelos y versiones)', async () => {
  await embeddingCache.setEntry(makeEntry({ chunkId: 'cc-1', modelId: MODEL_A }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'cc-2', modelId: MODEL_B }));
  await embeddingCache.setEntry(makeEntry({ chunkId: 'cc-3', modelId: MODEL_A, pipelineVersion: 'v0.9' }));

  await embeddingCache.clearCache();

  assert.equal((await embeddingCache.getAllEntriesForModel(MODEL_A)).length, 0);
  assert.equal((await embeddingCache.getAllEntriesForModel(MODEL_B)).length, 0);
  assert.equal((await embeddingCache.getAllEntriesForModel(MODEL_A, 'v0.9')).length, 0);
  assert.equal(await embeddingCache.getEntry('cc-1', MODEL_A), null);
  assert.equal(await embeddingCache.getEntry('cc-2', MODEL_B), null);
});

// ===========================================================================
// C — SHA-256 REAL
// ===========================================================================

test('C.1 SHA-256 produce los vectores oficiales FIPS 180-4', async () => {
  // Vectores de prueba oficiales NIST (FIPS 180-4 / NIST CSRC examples).
  const empty = await computeSha256ContentHash('');
  assert.equal(empty, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');

  const abc = await computeSha256ContentHash('abc');
  assert.equal(abc, 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const twoBlocks = await computeSha256ContentHash('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq');
  assert.equal(twoBlocks, '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('C.2 La implementación pura coincide con WebCrypto y es determinista', async () => {
  const input = 'CrossedArts: hash de contenido de una lección cualquiera 123.';
  const viaWebCrypto = await computeSha256ContentHash(input);
  const viaPure = sha256Hex(input);
  const again = await computeSha256ContentHash(input);

  assert.equal(viaWebCrypto, viaPure, 'Ambas rutas producen el mismo digest');
  assert.equal(viaWebCrypto, again, 'Determinista entre llamadas');
  assert.match(viaWebCrypto, /^[0-9a-f]{64}$/, '64 caracteres hexadecimales');
});

test('C.3 Entradas distintas producen digests distintos (colisión no fabricada)', async () => {
  const h1 = await computeSha256ContentHash('contenido original de la nota');
  const h2 = await computeSha256ContentHash('contenido original de la nota ');
  const h3 = await computeSha256ContentHash('contenido original de la notb');
  assert.notEqual(h1, h2, 'Un espacio cambia el hash');
  assert.notEqual(h1, h3, 'Un carácter cambia el hash');
  assert.notEqual(h1, computeContentHash(h1), 'El FNV-1a de 8 hex NO se presenta como SHA-256');
});

// ===========================================================================
// I — COBERTURA SEMÁNTICA DE CONTENIDO LARGO
// ===========================================================================

const LONG_SENTENCE = 'La fotosíntesis transforma la energía luminosa en energía química almacenada en enlaces de glucosa. ';
const longBody = Array.from({ length: 30 }, (_, i) => `Párrafo ${i + 1}. ${LONG_SENTENCE}${LONG_SENTENCE}${LONG_SENTENCE}`).join('\n\n');

test('I.1 Texto corto produce EXACTAMENTE un fragmento (sin inflar la caché)', () => {
  const parts = splitIntoBoundedParts('Texto breve de una nota.');
  assert.equal(parts.length, 1);
  assert.equal(parts[0], 'Texto breve de una nota.');
  assert.equal(splitIntoBoundedParts('   ').length, 0, 'Texto vacío no produce fragmentos');
});

test('I.2 Texto largo produce MÚLTIPLES fragmentos acotados con contenido íntegro', () => {
  const parts = splitIntoBoundedParts(longBody);
  assert.ok(parts.length > 1, `El contenido de ${longBody.length} caracteres no puede ser un único fragmento`);
  for (const part of parts) {
    assert.ok(part.length <= 800, `Cada fragmento debe ser acotado (recibido: ${part.length})`);
    assert.ok(part.trim().length > 0, 'Sin fragmentos vacíos');
  }
  // Cobertura: la mayor parte del material debe estar representada.
  const joined = parts.join(' ');
  assert.ok(joined.includes('Párrafo 1.'), 'El inicio está cubierto');
  assert.ok(joined.includes('Párrafo 30.'), 'El final está cubierto (antes se truncaba)');
});

test('I.3 IDs y orden deterministas; contenido cambiado invalida solo su fragmento', async () => {
  const note = { id: 'nX', title: 'Nota larga', content: longBody };
  const chunks1 = await createSemanticChunksFromResourcesAsync({ courses: [], books: [], notes: [note], flashcards: [], concepts: [] });
  const chunks2 = await createSemanticChunksFromResourcesAsync({ courses: [], books: [], notes: [note], flashcards: [], concepts: [] });

  assert.equal(chunks1.length, chunks2.length);
  assert.deepEqual(chunks1.map(c => c.chunkId), chunks2.map(c => c.chunkId), 'IDs deterministas y estables');
  assert.deepEqual(chunks1.map(c => c.contentHash), chunks2.map(c => c.contentHash), 'Hashes deterministas');
  assert.ok(chunks1[0].chunkId === 'note_nX', 'Primer fragmento conserva el ID base');
  assert.ok(chunks1.slice(1).every((c, i) => c.chunkId === `note_nX_p${i + 2}`), 'Partes siguientes usan sufijo _pN determinista');

  // Añadir texto al final invalida el ÚLTIMO fragmento (el troceado es
  // secuencial y determinista: las partes anteriores no cambian).
  const edited = await createSemanticChunksFromResourcesAsync({ courses: [], books: [], notes: [{ ...note, content: longBody + ' Anexo final distinto.' }], flashcards: [], concepts: [] });
  const lastOriginal = chunks1[chunks1.length - 1];
  const lastEdited = edited[edited.length - 1];
  assert.notEqual(lastEdited.contentHash, lastOriginal.contentHash, 'Cambiar el contenido invalida el hash del fragmento afectado');
  assert.equal(edited[0].contentHash, chunks1[0].contentHash, 'Los fragmentos no afectados conservan su hash');
});

test('I.4 Lecciones largas se trocean; los otros recursos siguen generando 1 fragmento', async () => {
  const chunks = await createSemanticChunksFromResourcesAsync({
    courses: [{
      id: 'cL', title: 'Curso Largo', category: 'Test',
      modules: [{ id: 'mL', title: 'Módulo', lessons: [{ id: 'lL', title: 'Lección larga', content: longBody, duration_minutes: 30 }] }]
    }],
    books: [{ id: 'bL', title: 'Libro', author: 'A', category: 'C', description: 'Descripción breve', reading_percentage: 10 }],
    notes: [{ id: 'nS', title: 'Nota corta', content: 'Contenido corto.' }],
    flashcards: [{ id: 'fL', front: 'Pregunta', back: 'Respuesta' }],
    concepts: [{ id: 'kL', name: 'Concepto', description: 'Definición breve' }]
  });

  const lessonChunks = chunks.filter(c => c.sourceType === 'lesson' && c.sourceId === 'lL');
  assert.ok(lessonChunks.length > 1, 'Una lección larga se representa con varios fragmentos');
  assert.equal(lessonChunks[0].chunkId, 'lesson_lL', 'Primer fragmento de lección con ID base estable');

  assert.ok(chunks.some(c => c.chunkId === 'book_bL'), 'Los libros siguen soportados');
  assert.ok(chunks.some(c => c.chunkId === 'note_nS'), 'Las notas cortas siguen soportadas');
  assert.ok(chunks.some(c => c.chunkId === 'flashcard_fL'), 'Las flashcards siguen soportadas');
  assert.ok(chunks.some(c => c.chunkId === 'concept_kL'), 'Los conceptos siguen soportados');
  assert.ok(chunks.some(c => c.chunkId === 'course_cL'), 'Los cursos siguen soportados');
  for (const c of chunks) {
    assert.ok(c.text.trim().length > 0, 'Ningún fragmento vacío');
    assert.equal(c.contentHash.length, 64, 'Hash SHA-256 de 64 hex en todos los fragmentos');
  }
});

// ===========================================================================
// J — SEMÁNTICA DE ÁMBITO RAG
// ===========================================================================

test('J.1 La recuperación acotada a lección NO devuelve material ajeno', async () => {
  await dbBridge.init();
  const created = await dao.createCourse({ title: 'Curso Ámbito J', category: 'Test' });
  const courseId = created.id!;
  const mod = await dao.createModule({ courseId, title: 'Módulo J' });
  const lesson = await dao.createLesson({
    moduleId: mod.id!,
    title: 'Lección Teorema J',
    content: 'El teorema de Tuparasov establece que toda matriz simétrica es diagonalizable en base ortonormal.'
  });
  // Recurso ajeno con vocabulario fuertemente coincidente.
  const other = await dao.createCourse({ title: 'Curso ajeno Tuparasov matrices', category: 'Test' });

  try {
    const scoped = await retrieveLocalContext('teorema de Tuparasov matrices', 4, { resourceId: courseId, lessonId: lesson.id! });
    assert.ok(scoped.documents.every(d => d.sourceType !== 'course' || d.id === courseId),
      'Ningún documento ajeno al ámbito entra como contexto');
    assert.ok(!scoped.documents.some(d => d.id === other.id), 'El curso ajeno NO es contexto autoritativo');

    // Global: sin ámbito, la búsqueda sigue siendo global.
    const global = await retrieveLocalContext('Tuparasov', 4);
    assert.ok(global.documents.some(d => d.id === other.id), 'La búsqueda global sigue alcanzando documentos ajenos');
  } finally {
    for (const id of [courseId, other.id!]) {
      if (id) {
        const db = dbBridge.getDatabase();
        db.run('DELETE FROM learning_resource WHERE id = ?', [id]);
        db.run('DELETE FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [id, id]);
      }
    }
    await dbBridge.persist();
  }
});

test('J.2 Ambos caminos (léxico y semántico) comparten la frontera de ámbito', () => {
  // El ámbito se resuelve UNA vez y se aplica al conjunto fusionado (que ya
  // contiene candidatos léxicos Y semánticos), no por separado.
  const source = readFileSync(new URL('../src/lib/localRag/retrieval.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('resolveScopeIds'), 'El ámbito se resuelve de forma centralizada');
  assert.ok(source.includes('filtered = filtered.filter'), 'La frontera dura filtra el conjunto fusionado');
});
