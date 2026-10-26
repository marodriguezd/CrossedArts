import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  clearShellCaches,
  createServiceWorkerUpdater,
  isChunkLoadError,
  type RegistrationLike,
  type ServiceWorkerContainerLike,
  type ServiceWorkerUpdateState,
  type WorkerLike
} from '../src/services/serviceWorker.ts';

const FRONTEND_ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC_SW = path.join(FRONTEND_ROOT, 'public', 'sw.js');
const DIST_ROOT = path.join(FRONTEND_ROOT, 'dist');

/**
 * The injected precache list only exists after `npm run build` (CI runs tests
 * before the build). The service-worker source contract above runs always; the
 * emitted artifact is checked wherever a build is actually present.
 */
const BUILT_SW_AVAILABLE = existsSync(path.join(DIST_ROOT, 'sw.js'));
const BUILD_SKIP_REASON =
  BUILT_SW_AVAILABLE === false ? 'requiere un build previo (`npm run build`)' : false;

class FakeWorker implements WorkerLike {
  state = 'installing';
  messages: unknown[] = [];
  private listeners = new Set<() => void>();

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.add(listener);
  }

  setState(state: string): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}

class FakeRegistration implements RegistrationLike {
  waiting: WorkerLike | null = null;
  installing: WorkerLike | null = null;
  private listeners = new Map<string, Set<() => void>>();

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

class FakeContainer implements ServiceWorkerContainerLike {
  controller: unknown = {};
  registration = new FakeRegistration();
  private listeners = new Map<string, Set<() => void>>();

  register(): Promise<RegistrationLike> {
    return Promise.resolve(this.registration);
  }

  addEventListener(type: string, listener: () => void): void {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(listener);
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener();
  }
}

function waitForUpdate(updater: ReturnType<typeof createServiceWorkerUpdater>, container: FakeContainer, reg: FakeRegistration) {
  const worker = new FakeWorker();
  reg.installing = worker;
  reg.fire('updatefound');
  worker.setState('installed');
  assert.equal(updater.getState().hasUpdate, true, 'la nueva versión debe quedar en espera');
  assert.equal(updater.getState().status, 'waiting');
  assert.notEqual(container.controller, undefined);
  return worker;
}

test('P0.2 SW: el worker nunca activa por su cuenta y sí responde a SKIP_WAITING', () => {
  const sw = readFileSync(PUBLIC_SW, 'utf8');

  assert.ok(!/skipWaiting\(\)\s*\)/.test(sw), 'install no debe llamar a skipWaiting');
  assert.match(sw, /type === 'SKIP_WAITING'/, 'debe existir un mensaje explícito de activación');
  assert.match(sw, /const BUILD_ID = \/\*__BUILD_ID__\*\//, 'el build debe inyectar un identificador de versión');
  assert.match(sw, /const PRECACHE_ASSETS = \/\*__PRECACHE_ASSETS__\*\//, 'el build debe inyectar los chunks');
});

test('P0.2 SW: el precache del build incluye todos los chunks emitidos', { skip: BUILD_SKIP_REASON }, () => {
  const sw = readFileSync(path.join(DIST_ROOT, 'sw.js'), 'utf8');
  const match = sw.match(/const PRECACHE_ASSETS = (\[[^\]]*\]);/);
  assert.ok(match, 'dist/sw.js no contiene la lista de precache inyectada');
  const precached = new Set<string>(JSON.parse(match![1]).map((entry: string) => entry.replace('./', '')));

  const assetsDir = path.join(DIST_ROOT, 'assets');
  const emitted = readdirSync(assetsDir)
    .filter((name) => /\.(?:js|mjs|css)$/.test(name))
    .map((name) => `assets/${name}`);

  const missing = emitted.filter((file) => !precached.has(file));
  assert.deepEqual(missing, [], `chunks fuera del precache: ${missing.join(', ')}`);

  // El worker de inferencia no está en el manifest de Vite; aun así debe entrar.
  assert.ok(
    Array.from(precached).some((file) => file.includes('wasmWorker')),
    'el worker de inferencia debe precachearse'
  );

  // La versión inyectada cambia con cada build: es lo que dispara la actualización.
  assert.match(sw, /const BUILD_ID = "[0-9a-f]{12}";/);
});

test('P0.2 SW: una primera instalación no pide actualizar y el cambio de control no recarga', async () => {
  const container = new FakeContainer();
  container.controller = null; // primera visita
  let reloads = 0;
  const updater = createServiceWorkerUpdater({ container, reload: () => { reloads += 1; } });

  const states: ServiceWorkerUpdateState[] = [];
  updater.subscribe((state) => states.push(state));
  await updater.start();

  const worker = new FakeWorker();
  container.registration.installing = worker;
  container.registration.fire('updatefound');
  worker.setState('installed');

  assert.equal(updater.getState().hasUpdate, false, 'sin controlador previo no hay actualización que ofrecer');

  container.fire('controllerchange');
  assert.equal(reloads, 0, 'clients.claim de la primera instalación no debe recargar la página');
});

test('P0.2 SW: aceptar la actualización envía SKIP_WAITING y recarga una sola vez', async () => {
  const container = new FakeContainer();
  let reloads = 0;
  const updater = createServiceWorkerUpdater({ container, reload: () => { reloads += 1; } });
  await updater.start();

  const worker = waitForUpdate(updater, container, container.registration);

  updater.acceptUpdate();
  assert.deepEqual(worker.messages, [{ type: 'SKIP_WAITING' }]);
  assert.equal(updater.getState().status, 'activating');
  assert.equal(reloads, 0, 'no se recarga hasta que el nuevo worker toma el control');

  container.fire('controllerchange');
  container.fire('controllerchange');
  assert.equal(reloads, 1, 'controllerchange debe recargar exactamente una vez');
  assert.equal(updater.getState().hasUpdate, false);
});

test('P0.2 SW: aceptar sin actualización pendiente no hace nada', async () => {
  const container = new FakeContainer();
  let reloads = 0;
  const updater = createServiceWorkerUpdater({ container, reload: () => { reloads += 1; } });
  await updater.start();

  updater.acceptUpdate();
  container.fire('controllerchange');
  assert.equal(reloads, 0);
});

test('P0.2 SW: registra y tolera la ausencia de Service Worker', async () => {
  const unsupported = createServiceWorkerUpdater({ container: null });
  await unsupported.start();
  assert.equal(unsupported.getState().status, 'unsupported');
  unsupported.acceptUpdate(); // no lanza

  const failing = createServiceWorkerUpdater({
    container: {
      controller: null,
      register: () => Promise.reject(new Error('bloqueado')),
      addEventListener: () => undefined
    }
  });
  await failing.start();
  assert.equal(failing.getState().status, 'error');
});

test('P0.2: isChunkLoadError distingue un fallo de chunk de un error de render', () => {
  assert.equal(isChunkLoadError(new Error('Failed to fetch dynamically imported module: https://x/assets/A.js')), true);
  assert.equal(isChunkLoadError(new Error('Importing a module script failed.')), true);
  assert.equal(isChunkLoadError('error loading dynamically imported module'), true);
  assert.equal(isChunkLoadError(new TypeError('Cannot read properties of undefined')), false);
  assert.equal(isChunkLoadError(null), false);
});

test('P0.2: clearShellCaches borra solo las cachés del shell', async () => {
  const deleted: string[] = [];
  const removed = await clearShellCaches({
    keys: async () => ['crossedarts-shell-v6-abc', 'crossedarts-shell-v5', 'otra-app'],
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    }
  });

  assert.equal(removed, 2);
  assert.deepEqual(deleted.sort(), ['crossedarts-shell-v5', 'crossedarts-shell-v6-abc']);
});
