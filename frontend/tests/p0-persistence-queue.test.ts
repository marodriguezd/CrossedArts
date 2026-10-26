import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';

/**
 * P0.3 — La conexión IndexedDB se reutiliza y las escrituras se serializan.
 *
 * La regresión original: cada `persist()` abría una conexión nueva y dos
 * persist() concurrentes leían la misma revisión coordinada, de modo que la
 * segunda abortaba con un `StaleWriteError` falso.
 */

// Contador de aperturas: envuelve el `open` real de fake-indexeddb.
const realOpen = indexedDB.open.bind(indexedDB);
let openCalls = 0;
(indexedDB as any).open = (...args: any[]) => {
  openCalls += 1;
  return (realOpen as any)(...args);
};

test('P0.3: la conexión IndexedDB se abre una vez y se reutiliza', async () => {
  await dbBridge.init();

  const before = openCalls;
  await dbBridge.persist();
  await dbBridge.persist();
  await dbBridge.persist();
  const afterPersists = openCalls;

  // Un único `open` para las tres escrituras (y ninguna si ya estaba abierta).
  assert.ok(afterPersists - before <= 1, `se abrieron ${afterPersists - before} conexiones en tres writes`);

  const base = openCalls;
  // Otra ruta de lectura del snapshot: debe reutilizar la misma conexión.
  await dbBridge.exportPersistedRecovery();
  assert.ok(openCalls - base <= 1, 'la lectura reutiliza la conexión ya abierta');
});

test('P0.3: dos persist() concurrentes no producen StaleWriteError y avanzan la revisión', async () => {
  await dbBridge.init();

  const first = dbBridge.getStorageReport();
  assert.equal(first.state !== 'stale-other-tab', true);

  await assert.doesNotReject(async () => {
    await Promise.all([dbBridge.persist(), dbBridge.persist(), dbBridge.persist()]);
  }, 'las escrituras de la misma pestaña deben serializarse');

  const report = dbBridge.getStorageReport();
  assert.notEqual(report.state, 'stale-other-tab');
  assert.notEqual(report.state, 'persistence-error');
});

test('P0.3: calificar una tarjeta escribe el snapshot una sola vez y actualiza el contador', async () => {
  await dbBridge.init();

  const cards = await dao.getFlashcards();
  assert.ok(cards.length > 0, 'la demo debe tener tarjetas');
  const card = cards[0];

  const sessionId = await dao.startStudySession({ mode: 'flashcards' });
  assert.ok(sessionId, 'debe existir una sesión activa');

  const before = dbBridge.getStorageReport().lastPersistedTimestamp;
  // Una sola escritura: el timestamp de persistencia solo puede avanzar una vez
  // dentro de la operación compuesta, así que medimos las escrituras del bridge.
  const writes = countPersists();

  const { result, sessionUpdated } = await dao.reviewFlashcardInSession(card.id, 4, sessionId);
  assert.ok(result, 'la tarjeta debe actualizarse');
  assert.equal(sessionUpdated, true, 'el contador de la sesión debe avanzar');
  assert.equal(writes(), 1, 'la operación compuesta debe persistir exactamente una vez');

  const reloaded = await dao.getStudySessionById(sessionId);
  assert.equal(Number(reloaded?.cards_reviewed), 1);
  assert.ok(dbBridge.getStorageReport().lastPersistedTimestamp !== before);
});

test('P0.3: una sesión inactiva no impide guardar el repaso', async () => {
  await dbBridge.init();

  const cards = await dao.getFlashcards();
  const card = cards[0];

  const { result, sessionUpdated } = await dao.reviewFlashcardInSession(card.id, 5, 'sesion-inexistente');
  assert.ok(result, 'el repaso debe aplicarse igualmente');
  assert.equal(sessionUpdated, false, 'sin sesión activa no hay contador que actualizar');
});

/**
 * Cuenta llamadas a `dbBridge.persist` durante un bloque, sin tocar la
 * implementación real: envuelve el método y lo restaura al terminar.
 */
function countPersists(): () => number {
  const original = dbBridge.persist.bind(dbBridge);
  let calls = 0;
  (dbBridge as any).persist = (...args: any[]) => {
    calls += 1;
    return (original as any)(...args);
  };
  return () => {
    (dbBridge as any).persist = original;
    return calls;
  };
}
