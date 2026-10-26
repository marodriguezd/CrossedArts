import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createServiceWorkerUpdater,
  type ServiceWorkerContainerLike,
  type ServiceWorkerUpdateState,
  type ServiceWorkerUpdater
} from '../services/serviceWorker.ts';

const UNSUPPORTED: ServiceWorkerUpdateState = { status: 'unsupported', hasUpdate: false };

/**
 * Registers the shell service worker and exposes the controlled-update state.
 *
 * Only in production builds: a development server must never keep serving a
 * previous build's chunks from Cache Storage.
 */
export function useServiceWorkerUpdate(): {
  state: ServiceWorkerUpdateState;
  acceptUpdate: () => void;
} {
  const [state, setState] = useState<ServiceWorkerUpdateState>(UNSUPPORTED);
  const updaterRef = useRef<ServiceWorkerUpdater | null>(null);

  useEffect(() => {
    if (!import.meta.env.PROD) return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const updater = createServiceWorkerUpdater({
      container: navigator.serviceWorker as unknown as ServiceWorkerContainerLike,
      reload: () => {
        if (typeof window !== 'undefined') window.location.reload();
      },
      onChange: setState
    });
    updaterRef.current = updater;
    const unsubscribe = updater.subscribe(setState);
    void updater.start();

    return () => {
      unsubscribe();
      updater.dispose();
      updaterRef.current = null;
    };
  }, []);

  const acceptUpdate = useCallback(() => {
    updaterRef.current?.acceptUpdate();
  }, []);

  return { state, acceptUpdate };
}
