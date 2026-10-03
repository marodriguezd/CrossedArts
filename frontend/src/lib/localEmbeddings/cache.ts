import type { SemanticChunk } from './chunking.ts';

export const EMBEDDING_PIPELINE_VERSION = 'v1.1-e5-sha256';

export interface CachedVectorEntry {
  chunkId: string;
  sourceType: string;
  sourceId: string;
  title: string;
  text: string;
  contentHash: string;
  modelId: string;
  pipelineVersion?: string;
  dimensions?: number;
  vector: number[];
  updatedAt: number;
}

const IDB_NAME = 'CrossedArts_Embeddings';
const STORE_NAME = 'vector_cache';

class LocalEmbeddingCache {
  private inMemoryCache: Map<string, CachedVectorEntry> = new Map();

  private hasIndexedDB(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      // La versión 2 asegura el índice `modelId` incluso en bases creadas por una
      // versión anterior de la aplicación que no lo declaraba. No cambia el
      // esquema de datos: solo añade el índice que ya se usaba para filtrar.
      const req = indexedDB.open(IDB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'chunkId' });
          store.createIndex('modelId', 'modelId', { unique: false });
          return;
        }
        const store = req.transaction!.objectStore(STORE_NAME);
        if (!store.indexNames.contains('modelId')) {
          store.createIndex('modelId', 'modelId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  public async getEntry(chunkId: string): Promise<CachedVectorEntry | null> {
    if (this.inMemoryCache.has(chunkId)) {
      return this.inMemoryCache.get(chunkId)!;
    }

    if (!this.hasIndexedDB()) return null;

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(chunkId);
        req.onsuccess = () => {
          const res = req.result as CachedVectorEntry || null;
          if (res) this.inMemoryCache.set(chunkId, res);
          resolve(res);
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async setEntry(entry: CachedVectorEntry): Promise<void> {
    this.inMemoryCache.set(entry.chunkId, entry);

    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(entry);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('Error guardando vector en IndexedDB:', err);
    }
  }

  /**
   * Devuelve los vectores cacheados de un modelo concreto.
   *
   * Usa el índice `modelId` que ya existe en el object store en lugar de traer
   * TODOS los registros y filtrar en memoria: con varios modelos y versiones de
   * pipeline, `getAll()` descargaba la caché entera para descartar la mayoría.
   *
   * La semántica NO cambia: se siguen validando modelId, versión de pipeline y
   * dimensión del vector (384) antes de devolver nada. Si el índice no estuviera
   * disponible (base creada por una versión anterior sin `onupgradeneeded`), se
   * recurre a la lectura completa como degradación segura.
   */
  public async getAllEntriesForModel(
    modelId: string,
    pipelineVersion: string = EMBEDDING_PIPELINE_VERSION
  ): Promise<CachedVectorEntry[]> {
    const isEntryValid = (e: CachedVectorEntry) =>
      e.modelId === modelId &&
      e.pipelineVersion === pipelineVersion &&
      Array.isArray(e.vector) &&
      e.vector.length === 384;

    if (!this.hasIndexedDB()) {
      return Array.from(this.inMemoryCache.values()).filter(isEntryValid);
    }

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);

        const settle = (rawList: CachedVectorEntry[]) => {
          const list = (rawList || []).filter(isEntryValid);
          // Actualizar in-memory
          for (const item of list) {
            this.inMemoryCache.set(item.chunkId, item);
          }
          resolve(list);
        };

        // El índice filtra por modelId en SQLite; el resto de criterios se
        // validan igual que antes.
        if (store.indexNames.contains('modelId')) {
          const indexReq = store.index('modelId').getAll(IDBKeyRange.only(modelId));
          indexReq.onsuccess = () => settle((indexReq.result as CachedVectorEntry[]) || []);
          indexReq.onerror = () => {
            // Índice inutilizable: se degrada a la lectura completa.
            const fallback = store.getAll();
            fallback.onsuccess = () => settle((fallback.result as CachedVectorEntry[]) || []);
            fallback.onerror = () => resolve([]);
          };
          return;
        }

        const req = store.getAll();
        req.onsuccess = () => settle((req.result as CachedVectorEntry[]) || []);
        req.onerror = () => resolve([]);
      });
    } catch {
      return Array.from(this.inMemoryCache.values()).filter(isEntryValid);
    }
  }

  public async deleteEntry(chunkId: string): Promise<void> {
    this.inMemoryCache.delete(chunkId);
    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(chunkId);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }

  public async clearCache(): Promise<void> {
    this.inMemoryCache.clear();
    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }
}

export const embeddingCache = new LocalEmbeddingCache();
