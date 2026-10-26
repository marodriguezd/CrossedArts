import test from 'node:test';
import assert from 'node:assert/strict';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import {
  assessImportCapacity,
  formatBytes,
  IMPORT_HEADROOM_FACTOR
} from '../src/services/storageGuards.ts';

/**
 * P0.4 — La app no puede afirmar que protege datos que el navegador no protege.
 *
 * `requestPersistentStorage` y `getStorageEstimate` existían pero ningún
 * componente los usaba; el estado expuesto era siempre el de arranque.
 */

const originalNavigator = (globalThis as any).navigator;

function stubStorage(storage: Record<string, unknown> | undefined): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: storage ? { ...originalNavigator, storage } : { ...originalNavigator, storage: undefined },
    configurable: true,
    writable: true
  });
}

test.afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', {
    value: originalNavigator,
    configurable: true,
    writable: true
  });
});

test('P0.4: sin StorageManager no se afirma protección', async () => {
  stubStorage(undefined);
  const granted = await dbBridge.requestPersistentStorage();
  assert.equal(granted, false);
  assert.equal(dbBridge.getStorageReport().isPersistentGranted, false);
  assert.equal(await dbBridge.getStorageEstimate(), null);
});

test('P0.4: la protección refleja la respuesta real del navegador', async () => {
  let persistedAnswer = false;
  stubStorage({
    persist: async () => {
      persistedAnswer = true;
      return true;
    },
    persisted: async () => persistedAnswer,
    estimate: async () => ({ usage: 1024, quota: 2048 })
  });

  const granted = await dbBridge.requestPersistentStorage();
  assert.equal(granted, true);
  assert.equal(dbBridge.getStorageReport().isPersistentGranted, true);

  assert.deepEqual(await dbBridge.getStorageEstimate(), { usage: 1024, quota: 2048 });
});

test('P0.4: una negativa del navegador no se reporta como protección', async () => {
  stubStorage({
    persist: async () => false,
    persisted: async () => false
  });

  const granted = await dbBridge.requestPersistentStorage();
  assert.equal(granted, false);
  assert.equal(dbBridge.getStorageReport().isPersistentGranted, false);
});

test('P0.4: assessImportCapacity compara con el espacio libre real', () => {
  const roomy = assessImportCapacity(10 * 1024 * 1024, { usage: 100, quota: 1000 * 1024 * 1024 });
  assert.equal(roomy.sufficient, true);
  assert.equal(roomy.unknown, false);

  const tight = assessImportCapacity(800 * 1024 * 1024, { usage: 100, quota: 1000 * 1024 * 1024 });
  assert.equal(tight.sufficient, false);
  assert.ok(tight.requiredBytes > tight.availableBytes);

  // El margen cubre la copia en memoria del snapshot y del archivo importado.
  const exact = assessImportCapacity(100, { usage: 0, quota: 100 });
  assert.equal(exact.requiredBytes, Math.ceil(100 * IMPORT_HEADROOM_FACTOR));
  assert.equal(exact.sufficient, false);
});

test('P0.4: una cuota desconocida no bloquea una importación válida', () => {
  assert.equal(assessImportCapacity(1024, null).sufficient, true);
  assert.equal(assessImportCapacity(1024, null).unknown, true);
  assert.equal(assessImportCapacity(1024, { usage: 10 }).unknown, true);
  // Tamaño de archivo desconocido: tampoco se inventa un veredicto.
  assert.equal(assessImportCapacity(0, { usage: 0, quota: 10 }).sufficient, true);
});

test('P0.4: formatBytes usa separador decimal español', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1536), '1,5 KB');
  assert.equal(formatBytes(1024 * 1024), '1,0 MB');
  assert.equal(formatBytes(undefined), '—');
  assert.equal(formatBytes(Number.NaN), '—');
});
