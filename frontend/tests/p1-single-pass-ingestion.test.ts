import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { LocalIngestionService } from '../src/lib/localIngestion/service.ts';
import type { IngestionSource } from '../src/lib/localIngestion/types.ts';

/**
 * P1.8 — importar un documento lee y hashea UNA vez, e indexa UNA vez.
 *
 * Antes: el servicio calculaba SHA-256 del archivo y el parser volvía a leer y
 * hashear; además, cada archivo reconstruía el corpus de TODA la biblioteca y lo
 * reindexaba, así que importar N documentos costaba N pasadas completas.
 */

function makeSource(name: string, content: string, counters: { reads: number }) {
  const bytes = new TextEncoder().encode(content);
  const source: IngestionSource = {
    name,
    size: bytes.byteLength,
    text: async () => content,
    arrayBuffer: async () => {
      counters.reads += 1;
      return bytes.buffer.slice(0) as ArrayBuffer;
    }
  };
  return source;
}

test('P1.8: un archivo se lee y hashea una sola vez de extremo a extremo', async () => {
  await dbBridge.init();

  const counters = { reads: 0 };
  const service = new LocalIngestionService({ requestIndexing: () => undefined });
  const source = makeSource('lectura-unica.txt', 'Contenido suficientemente largo para el parser.', counters);

  const result = await service.ingestFile(source, { category: 'Documentos' });

  assert.equal(result.success, true);
  assert.equal(result.isDuplicate, false);
  assert.equal(counters.reads, 1, 'el archivo debe leerse una única vez');
  assert.equal(result.fingerprint.length, 64, 'la huella SHA-256 se calculó del contenido');
  assert.ok(source.cachedFingerprint, 'la huella queda memorizada en la fuente');
});

test('P1.8: un lote de 3 archivos solicita UNA sola indexación semántica', async () => {
  await dbBridge.init();

  let indexRequests = 0;
  const service = new LocalIngestionService({ requestIndexing: () => { indexRequests += 1; } });
  const counters = { reads: 0 };

  const results = await service.ingestBatch(
    [
      makeSource('lote-a.txt', 'Alfa. Contenido de la primera fuente del lote.', counters),
      makeSource('lote-b.txt', 'Beta. Contenido de la segunda fuente del lote.', counters),
      makeSource('lote-c.txt', 'Gamma. Contenido de la tercera fuente del lote.', counters)
    ],
    { enableSemanticIndexing: true, category: 'Documentos' }
  );

  assert.equal(results.filter((r) => r.success && !r.isDuplicate).length, 3);
  assert.equal(indexRequests, 1, 'la indexación se pide una vez, no una por archivo');
  assert.equal(counters.reads, 3, 'una lectura por archivo, no dos');
});

test('P1.8: sin indexación pedida no se programa ninguna pasada', async () => {
  await dbBridge.init();

  let indexRequests = 0;
  const service = new LocalIngestionService({ requestIndexing: () => { indexRequests += 1; } });
  const counters = { reads: 0 };

  await service.ingestBatch([makeSource('sin-indexar.txt', 'Texto sin indexación semántica.', counters)]);
  assert.equal(indexRequests, 0);
});

test('P1.8: un solo archivo con indexación pedida programa exactamente una pasada', async () => {
  await dbBridge.init();

  let indexRequests = 0;
  const service = new LocalIngestionService({ requestIndexing: () => { indexRequests += 1; } });
  const counters = { reads: 0 };

  const result = await service.ingestFile(
    makeSource('individual.txt', 'Documento individual con indexación.', counters),
    { enableSemanticIndexing: true, category: 'Documentos' }
  );

  assert.equal(result.success, true);
  assert.equal(indexRequests, 1);
});

test('P1.8: un duplicado no reindexa ni vuelve a parsear', async () => {
  await dbBridge.init();

  let indexRequests = 0;
  const service = new LocalIngestionService({ requestIndexing: () => { indexRequests += 1; } });
  const counters = { reads: 0 };
  const content = 'Documento duplicado: mismo SHA-256, sin trabajo extra.';

  const first = await service.ingestFile(makeSource('duplicado.txt', content, counters), { category: 'Documentos' });
  assert.equal(first.isDuplicate, false);

  const second = await service.ingestFile(
    makeSource('duplicado.txt', content, counters),
    { enableSemanticIndexing: true, category: 'Documentos' }
  );

  assert.equal(second.isDuplicate, true);
  assert.equal(second.existingResourceId, first.resourceId);
  assert.equal(indexRequests, 0, 'un duplicado no programa indexación');
});

test('P1.8: una fuente ya hasheada por el llamador no se vuelve a hashear', async () => {
  await dbBridge.init();

  const service = new LocalIngestionService({ requestIndexing: () => undefined });
  let reads = 0;
  const bytes = new TextEncoder().encode('Texto con huella precalculada por el llamador.');
  const source: IngestionSource = {
    name: 'precalculada.txt',
    size: bytes.byteLength,
    text: async () => 'Texto con huella precalculada por el llamador.',
    arrayBuffer: async () => {
      reads += 1;
      return bytes.buffer.slice(0) as ArrayBuffer;
    },
    cachedFingerprint: 'a'.repeat(64)
  };

  const result = await service.ingestFile(source, { category: 'Documentos' });

  assert.equal(result.fingerprint, 'a'.repeat(64), 'se respeta la huella dada');
  assert.equal(reads, 0, 'con la huella y el texto ya disponibles no se leen los bytes otra vez');
});
