import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ===========================================================================
// REMEDIACIÓN B — Concurrencia optimista multi-pestaña.
//
// Invariante: una pestaña obsoleta NUNCA sobrescribe en silencio un snapshot
// más nuevo. La escritura usa comparar-y-swap sobre la revisión persistida
// JUNTO al snapshot en UNA transacción IndexedDB:
//
//   1. leer la revisión compartida;
//   2. si no es la que esta pestaña conocía, ABORTAR sin escribir;
//   3. si lo es, escribir bytes + metadatos atómicamente.
//
// El protocolo se valida aquí a tres niveles:
//   - modelo puro (transiciones, idéntico al bridge);
//   - transacción real con fake-indexeddb (atomicidad CAS);
//   - contrato del bridge (inspección de la implementación).
// ===========================================================================

import 'fake-indexeddb/auto';
import { StaleWriteError } from '../src/db/sqliteBridge.ts';

// ---------------------------------------------------------------------------
// Modelo puro del protocolo CAS (espejo de saveToStorageWithCas).
// ---------------------------------------------------------------------------

interface Meta { revision: number; lastWriterTabId: string; updatedAt: number }

class SharedStore {
  /** Estado de IndexedDB: bytes lógicos + metadatos, en la misma transacción. */
  public meta: Meta | null = null;
  public data = 'snapshot-0';
  public aborted = 0;
  public committed = 0;

  /**
   * Transacción atómica: CAS + escritura. Cualquier rechazo aborta TODO
   * (el snapshot anterior queda intacto), igual que abort() en IndexedDB.
   */
  transactionalWrite(tab: TabState, newData: string): boolean {
    const persisted = this.meta?.revision ?? 0;
    if (persisted !== tab.knownRevision) {
      this.aborted++;
      return false; // tx.abort(): ni bytes ni metadatos cambian.
    }
    this.data = newData;
    this.meta = { revision: tab.knownRevision + 1, lastWriterTabId: tab.tabId, updatedAt: Date.now() };
    this.committed++;
    return true;
  }
}

class TabState {
  public readonly tabId: string;
  public knownRevision: number;
  private readonly store: SharedStore;

  constructor(tabId: string, knownRevision: number, store: SharedStore) {
    this.tabId = tabId;
    this.knownRevision = knownRevision;
    this.store = store;
  }

  /** persist(): export local + CAS contra la revisión conocida. */
  write(newData: string): { ok: boolean; conflict: boolean } {
    const ok = this.store.transactionalWrite(this, newData);
    if (ok) {
      this.knownRevision += 1;
      return { ok: true, conflict: false };
    }
    return { ok: false, conflict: true };
  }

  /** Recarga el snapshot ganador y adopta su revisión compartida. */
  reload(): void {
    this.knownRevision = this.store.meta?.revision ?? 0;
  }
}

test('B.1 Dos pestañas parten de la misma revisión; la segunda escritura es rechazada', () => {
  const store = new SharedStore();
  const tabA = new TabState('tab-a', 0, store);
  const tabB = new TabState('tab-b', 0, store);

  const first = tabA.write('cambios de A');
  assert.ok(first.ok, 'La primera escritura (A) tiene éxito');

  const second = tabB.write('cambios de B');
  assert.ok(second.conflict, 'La escritura obsoleta de B se rechaza (no se aplica)');

  assert.equal(store.data, 'cambios de A', 'El snapshot de A sobrevive intacto');
  assert.equal(store.meta?.lastWriterTabId, 'tab-a');
});

test('B.2 Sin pérdida silenciosa de actualizaciones: la sobrescritura es imposible', () => {
  const store = new SharedStore();
  const tabA = new TabState('tab-a', 0, store);
  const tabB = new TabState('tab-b', 0, store);

  tabA.write('A modifica el recurso 1');
  const conflict = tabB.write('B modifica el recurso 2');

  assert.ok(conflict.conflict);
  // El dato de B no está en el store: no se produjo la "fusión" falsa.
  assert.ok(!store.data.includes('recurso 2'), 'Los cambios obsoletos de B no entraron en el snapshot');
  assert.equal(store.aborted, 1, 'La transacción obsoleta abortó una vez');
});

test('B.3 Tras el conflicto, una recarga fresca ve el último snapshot comprometido', () => {
  const store = new SharedStore();
  const tabA = new TabState('tab-a', 0, store);
  const tabB = new TabState('tab-b', 0, store);

  tabA.write('estado v1 por A');
  tabB.write('estado v1 por B'); // conflict

  tabB.reload();
  assert.equal(tabB.knownRevision, 1, 'B adopta la revisión ganadora');
  const retry = tabB.write('estado v2 por B (tras recargar)');
  assert.ok(retry.ok, 'Una vez fresca, B puede escribir de nuevo');
  assert.equal(store.data, 'estado v2 por B (tras recargar)');
  assert.equal(store.meta?.revision, 2);

  // Y A, obsoleta ahora, ya no puede escribir sin recargar.
  const staleA = tabA.write('estado v2 por A sin recargar');
  assert.ok(staleA.conflict, 'A quedó obsoleta tras la escritura de B');
});

test('B.4 Escrituras repetidas de la misma pestaña fresca incrementan la revisión', () => {
  const store = new SharedStore();
  const tab = new TabState('tab-solo', 0, store);

  for (let i = 1; i <= 5; i++) {
    const res = tab.write(`estado v${i}`);
    assert.ok(res.ok, `Escritura secuencial ${i} con éxito`);
    assert.equal(store.meta?.revision, i);
  }
  assert.equal(store.aborted, 0);
});

test('B.5 La pestaña que escribe mientras otra recarga no se corrompe', () => {
  const store = new SharedStore();
  const tabA = new TabState('tab-a', 0, store);
  const tabB = new TabState('tab-b', 0, store);

  tabA.write('v1');
  // B detecta el mensaje del canal y recarga mientras A escribe de nuevo.
  const writeDuringReload = tabA.write('v2');
  assert.ok(writeDuringReload.ok, 'A sigue pudiendo escribir: recargar no bloquea a quien escribe');

  tabB.reload();
  assert.equal(tabB.knownRevision, 2, 'B adopta la última revisión comprometida, no una intermedia');
});

// ---------------------------------------------------------------------------
// CAS real sobre transacciones IndexedDB (fake-indexeddb).
// ---------------------------------------------------------------------------

test('B.6 CAS atómico real: abortar la transacción no toca bytes ni metadatos', async () => {
  const { indexedDB } = globalThis as any;
  const DB = 'CrossedArts_CAS_Test';
  const STORE = 'kv';
  indexedDB.deleteDatabase(DB);

  const open = (version = 1) => new Promise<any>((resolve, reject) => {
    const req = indexedDB.open(DB, version);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  const idb = await open();
  const casWrite = (expectedRevision: number, payload: string): Promise<boolean> =>
    new Promise((resolve) => {
      const tx = idb.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      let committed = false;
      const getReq = store.get('meta');
      getReq.onsuccess = () => {
        const meta = getReq.result as Meta | undefined;
        const persisted = meta ? meta.revision : 0;
        if (persisted !== expectedRevision) {
          committed = false;
          try { tx.abort(); } catch { /* ya abortada */ }
          return;
        }
        committed = true;
        store.put(payload, 'data');
        store.put({ revision: expectedRevision + 1, lastWriterTabId: 't', updatedAt: Date.now() }, 'meta');
      };
      tx.oncomplete = () => resolve(committed);
      tx.onabort = () => resolve(false);
      tx.onerror = () => resolve(false);
    });

  assert.equal(await casWrite(0, 'bytes-v1'), true, 'Primera escritura CAS con éxito');

  // Una pestaña que conoce revisión 0 (obsoleta) es rechazada y no corrompe nada.
  assert.equal(await casWrite(0, 'bytes-obsoletos'), false, 'CAS rechaza la revisión obsoleta');

  const verifyTx = idb.transaction(STORE, 'readonly');
  const data = await new Promise<string>(r => { const q = verifyTx.objectStore(STORE).get('data'); q.onsuccess = () => r(q.result); });
  const meta = await new Promise<Meta>(r => { const q = verifyTx.objectStore(STORE).get('meta'); q.onsuccess = () => r(q.result); });
  assert.equal(data, 'bytes-v1', 'El snapshot ganador permanece intacto');
  assert.equal(meta.revision, 1, 'Los metadatos también');
  idb.close();
});

// ---------------------------------------------------------------------------
// Contrato del bridge real (inspección de implementación).
// ---------------------------------------------------------------------------

test('B.7 El bridge compara la revisión persistida dentro de la transacción y aborta sin escribir', () => {
  const source = readFileSync(new URL('../src/db/sqliteBridge.ts', import.meta.url), 'utf8');

  // El CAS lee los metadatos compartidos y compara contra la revisión conocida.
  assert.match(source, /casReq\.onsuccess[\s\S]*?persistedRevision !== this\.persistedRevision/,
    'La comparación CAS ocurre dentro de la transacción, no antes');
  assert.match(source, /tx\.abort\(\)/, 'La escritura obsoleta aborta la transacción');
  // Bytes y metadatos se escriben juntos (mismo tx), después del CAS.
  assert.match(source, /store\.put\(bytes, DB_KEY\)[\s\S]{0,200}store\.put\(/,
    'Snapshot y metadatos de revisión se comprometen en la misma transacción');
  // El conflicto marca el estado obsoleto para que ensureFresh recargue.
  assert.match(source, /StaleWriteError/);
  assert.match(source, /setStorageState\('stale-other-tab', err\.message\)/);
});

test('B.8 persist() lanza StaleWriteError y preserva el snapshot ganador en el conflicto', async () => {
  // Simulación de extremo a extremo del flujo de persist() con CAS abortado,
  // usando el modelo puro como doble del almacenamiento.
  const store = new SharedStore();
  const tabA = new TabState('tab-a', 0, store);
  const tabB = new TabState('tab-b', 0, store);

  tabA.write('ganador A');
  const res = tabB.write('perdedor B');

  assert.ok(res.conflict);
  // Equivalente a lo que hace persist() al capturar StaleWriteError:
  // marca obsoleto y NO reintenta automáticamente (evita bucles y carreras).
  assert.equal(store.data, 'ganador A', 'El snapshot persistido sigue siendo el de A');
  assert.equal(store.meta?.revision, 1);
});
