/**
 * Service worker update lifecycle.
 *
 * The shell worker must never take over a running tab on its own: a deploy can
 * delete the chunks the open page is about to request, so activating
 * immediately is what used to blank the app mid-session. Here the new worker is
 * kept in `waiting`, the UI offers the update, and the page reloads exactly once
 * after the person confirms.
 *
 * Dependencies are injected so the whole contract stays testable without a real
 * ServiceWorkerContainer.
 */

/** Cache prefix owned by the shell worker (see `public/sw.js`). */
export const SHELL_CACHE_PREFIX = 'crossedarts-shell-';

export type ServiceWorkerUpdateStatus =
  | 'unsupported'
  | 'registering'
  | 'idle'
  | 'waiting'
  | 'activating'
  | 'error';

export interface ServiceWorkerUpdateState {
  status: ServiceWorkerUpdateStatus;
  /** True while a new version sits in `waiting` until the person accepts it. */
  hasUpdate: boolean;
}

/** Minimal shape of the Worker object the watcher reads. */
export interface WorkerLike {
  state: string;
  postMessage(message: unknown): void;
  addEventListener(type: string, listener: () => void): void;
}

/** Minimal shape of a ServiceWorkerRegistration. */
export interface RegistrationLike {
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  addEventListener(type: string, listener: () => void): void;
}

export interface ServiceWorkerContainerLike {
  controller: unknown;
  register(scriptUrl: string): Promise<RegistrationLike>;
  addEventListener(type: string, listener: () => void): void;
}

export interface ServiceWorkerUpdaterDeps {
  container?: ServiceWorkerContainerLike | null;
  scriptUrl?: string;
  /** Called when the accepted update took control; must reload the page. */
  reload?: () => void;
  onChange?: (state: ServiceWorkerUpdateState) => void;
}

export interface ServiceWorkerUpdater {
  start(): Promise<void>;
  /** Sends `SKIP_WAITING` to the waiting worker (user gesture). */
  acceptUpdate(): void;
  getState(): ServiceWorkerUpdateState;
  subscribe(listener: (state: ServiceWorkerUpdateState) => void): () => void;
  dispose(): void;
}

/**
 * Detects a failed dynamic `import()`.
 *
 * These errors mean the running page outlived its own deploy: the chunk it
 * wanted is gone. They are the only case where clearing the shell cache and
 * reloading is the right recovery.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk \S+ failed|ChunkLoadError/i.test(
    message
  );
}

/**
 * Deletes every shell cache so the next load re-fetches the current deployment.
 * Never throws: a blocked/absent Cache Storage simply means nothing to clear.
 */
export async function clearShellCaches(
  storage: { keys(): Promise<string[]>; delete(name: string): Promise<boolean> } | undefined | null = typeof caches !== 'undefined' ? caches : null
): Promise<number> {
  if (!storage) return 0;
  try {
    const keys = await storage.keys();
    const targets = keys.filter((key) => key.startsWith(SHELL_CACHE_PREFIX));
    await Promise.all(targets.map((key) => storage.delete(key).catch(() => false)));
    return targets.length;
  } catch {
    return 0;
  }
}

export function createServiceWorkerUpdater(deps: ServiceWorkerUpdaterDeps): ServiceWorkerUpdater {
  const container = deps.container ?? null;
  const scriptUrl = deps.scriptUrl ?? './sw.js';
  const listeners = new Set<(state: ServiceWorkerUpdateState) => void>();

  let state: ServiceWorkerUpdateState = {
    status: container ? 'registering' : 'unsupported',
    hasUpdate: false
  };
  let waitingWorker: WorkerLike | null = null;
  let accepted = false;
  let reloaded = false;
  let disposed = false;
  let registration: RegistrationLike | null = null;
  const teardown: Array<() => void> = [];

  const emit = () => {
    for (const listener of listeners) {
      try {
        listener(state);
      } catch (err) {
        console.error('Service Worker update listener failed:', err);
      }
    }
    try {
      deps.onChange?.(state);
    } catch {
      /* el consumidor no puede romper el ciclo */
    }
  };

  const setState = (next: Partial<ServiceWorkerUpdateState>) => {
    state = { ...state, ...next };
    emit();
  };

  const markWaiting = (worker: WorkerLike | null) => {
    if (disposed || !worker) return;
    // A first install has no controller: there is nothing to update and no
    // reason to prompt.
    if (!container?.controller) return;
    if (accepted) return;
    waitingWorker = worker;
    setState({ status: 'waiting', hasUpdate: true });
  };

  const watchWorker = (worker: WorkerLike | null) => {
    if (!worker) return;
    const onStateChange = () => {
      if (disposed) return;
      if (worker.state === 'installed') markWaiting(worker);
    };
    try {
      worker.addEventListener('statechange', onStateChange);
    } catch {
      /* un fake sin addEventListener no rompe el flujo */
    }
    onStateChange();
  };

  const handleControllerChange = () => {
    if (disposed || reloaded) return;
    // Without an accepted update this is the FIRST activation (clients.claim):
    // reloading there would be an unrequested page reload.
    if (!accepted) return;
    reloaded = true;
    setState({ status: 'idle', hasUpdate: false });
    try {
      deps.reload?.();
    } catch {
      /* la recarga la decide el host */
    }
  };

  const start = async () => {
    if (!container) {
      setState({ status: 'unsupported', hasUpdate: false });
      return;
    }

    const onControllerChange = () => handleControllerChange();
    const containerWithRemoval = container as ServiceWorkerContainerLike & {
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    try {
      container.addEventListener('controllerchange', onControllerChange);
      teardown.push(() => containerWithRemoval.removeEventListener?.('controllerchange', onControllerChange));
    } catch {
      /* contenedor mínimo de test */
    }

    try {
      const reg = await container.register(scriptUrl);
      if (disposed) return;
      registration = reg;

      const onUpdateFound = () => watchWorker(reg.installing);
      try {
        reg.addEventListener('updatefound', onUpdateFound);
        teardown.push(() => (reg as any).removeEventListener?.('updatefound', onUpdateFound));
      } catch {
        /* registro mínimo de test */
      }

      // A version that was already waiting (page opened after the deploy).
      if (reg.waiting) {
        watchWorker(reg.waiting);
      }
      if (state.status !== 'waiting') setState({ status: 'idle' });
    } catch (err) {
      console.warn('Service Worker registration unavailable or failed:', err);
      if (!disposed) setState({ status: 'error', hasUpdate: false });
    }
  };

  const acceptUpdate = () => {
    if (disposed || !state.hasUpdate) return;
    const worker = waitingWorker ?? registration?.waiting ?? null;
    if (!worker) return;
    accepted = true;
    setState({ status: 'activating' });
    try {
      worker.postMessage({ type: 'SKIP_WAITING' });
    } catch (err) {
      console.warn('Failed to activate the new Service Worker version:', err);
      accepted = false;
      setState({ status: 'waiting', hasUpdate: true });
    }
  };

  return {
    start,
    acceptUpdate,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      listeners.clear();
      for (const off of teardown) {
        try {
          off();
        } catch {
          /* ignorado */
        }
      }
      teardown.length = 0;
    }
  };
}
