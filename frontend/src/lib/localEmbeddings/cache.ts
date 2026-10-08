import { getEmbeddingModelById } from './registry.ts';

export const EMBEDDING_PIPELINE_VERSION = 'v2.0-embeddinggemma-mrl256-sha256';

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
/** Versión 3: esquema con clave lógica compuesta (modelo::pipeline::chunk). */
const IDB_VERSION = 3;
/** Almacén legacy (v1/v2) con keyPath `chunkId`: una sola entrada por chunk. */
const LEGACY_STORE_NAME: string = 'vector_cache';
/** Almacén v3 con keyPath `cacheKey`: coexisten modelo y versiones de pipeline. */
const STORE_NAME: string = 'vector_cache_v3';

/**
 * Clave lógica de caché. El almacén antiguo usaba `chunkId` como clave primaria,
 * de modo que el vector de un modelo PISABA al del otro para el mismo chunk.
 * La identidad real de una entrada es (chunkId, modelId, pipelineVersion).
 */
export function buildCacheKey(modelId: string, pipelineVersion: string, chunkId: string): string {
  return `${modelId}::${pipelineVersion}::${chunkId}`;
}

/**
 * Dimensión EFEECTIVA (almacenada y consultada) para un modelo según el
 * registro local: la salida ya truncada por MRL (`outputDimension`), o en su
 * ausencia `dimensions`/`dimension`.
 *
 * Este es el contrato de la caché: los vectores se guardan y se recuperan con
 * esta dimensión y sobre ella se calcula la similitud coseno. La dimensión
 * NATIVA del modelo (`dimension`, 768d para EmbeddingGemma) sigue declarada en
 * el registro para validar la salida cruda del pipeline, pero nunca se usa
 * aquí: validar contra ella haría invisible todo vector MRL (256d).
 *
 * Devuelve `undefined` para modelos desconocidos: la validación se apoya então
 * en el campo `dimensions` declarado por la propia entrada.
 */
export function expectedDimensionsForModel(modelId: string): number | undefined {
  const def = getEmbeddingModelById(modelId);
  return def?.outputDimension ?? def?.dimensions ?? def?.dimension;
}

/**
 * Normaliza un registro legacy (sin `pipelineVersion`) a la identidad actual.
 * Idempotente: un registro ya migrado pasa por aquí sin cambios.
 */
export function migrateLegacyCacheRecord(record: CachedVectorEntry): CachedVectorEntry {
  const pipelineVersion = record.pipelineVersion || EMBEDDING_PIPELINE_VERSION;
  return { ...record, pipelineVersion };
}

class LocalEmbeddingCache {
  /** Caché en memoria indexada por la misma clave lógica que IndexedDB. */
  private inMemoryCache: Map<string, CachedVectorEntry> = new Map();
  /**
   * Handle de IndexedDB reutilizado entre operaciones.
   *
   * Abrir una conexión por operación y nunca cerrarla crece sin límite (cada
   * conexión retiene memoria y bloquea `deleteDatabase` de otras pestañas).
   * El handle se memoiza tras el primer uso y se reabre solo si algo lo cerró.
   */
  private idbPromise: Promise<IDBDatabase> | null = null;

  private hasIndexedDB(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private resolveStore(db: IDBDatabase): string {
    return db.objectStoreNames.contains(STORE_NAME) ? STORE_NAME : LEGACY_STORE_NAME;
  }

  private openIDB(): Promise<IDBDatabase> {
    if (this.idbPromise) return this.idbPromise;
    this.idbPromise = this.openIDBConnection().catch((err) => {
      // Un fallo transitorio no debe memoizarse: el siguiente reintento reabre.
      this.idbPromise = null;
      throw err;
    });
    return this.idbPromise;
  }

  private openIDBConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tx = req.transaction!;

        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
          store.createIndex('modelId', 'modelId', { unique: false });
          store.createIndex('modelPipeline', ['modelId', 'pipelineVersion'], { unique: false });
        }

        // Migración desde el almacén legacy (keyPath `chunkId`): se copia cada
        // registro al nuevo almacén con su clave lógica y se elimina el viejo.
        // Se ejecuta dentro de `onupgradeneeded` (transacción de versión), es
        // idempotente y conserva los vectores todavía representables.
        if (db.objectStoreNames.contains(LEGACY_STORE_NAME) && STORE_NAME !== LEGACY_STORE_NAME) {
          const legacy = tx.objectStore(LEGACY_STORE_NAME);
          const target = tx.objectStore(STORE_NAME);
          const cursorReq = legacy.openCursor();
          cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (!cursor) {
              tx.objectStore(LEGACY_STORE_NAME).clear();
              return;
            }
            const migrated = migrateLegacyCacheRecord(cursor.value as CachedVectorEntry);
            target.put({
              ...migrated,
              cacheKey: buildCacheKey(migrated.modelId, migrated.pipelineVersion!, migrated.chunkId)
            });
            cursor.continue();
          };
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private entryKey(entry: Pick<CachedVectorEntry, 'chunkId' | 'modelId' | 'pipelineVersion'>): string {
    return buildCacheKey(entry.modelId, entry.pipelineVersion || EMBEDDING_PIPELINE_VERSION, entry.chunkId);
  }

  private isEntryValid(
    e: CachedVectorEntry,
    modelId: string,
    pipelineVersion: string
  ): boolean {
    if (!e || e.modelId !== modelId || (e.pipelineVersion || EMBEDDING_PIPELINE_VERSION) !== pipelineVersion) {
      return false;
    }
    if (!Array.isArray(e.vector) || e.vector.length === 0) return false;
    const expected = expectedDimensionsForModel(modelId);
    const declared = typeof e.dimensions === 'number' && Number.isFinite(e.dimensions) && e.dimensions > 0
      ? e.dimensions
      : undefined;
    const dims = expected ?? declared;
    return dims === undefined ? true : e.vector.length === dims;
  }

  public async getEntry(
    chunkId: string,
    modelId: string,
    pipelineVersion: string = EMBEDDING_PIPELINE_VERSION
  ): Promise<CachedVectorEntry | null> {
    const cacheKey = buildCacheKey(modelId, pipelineVersion, chunkId);

    // La caché en memoria y IndexedDB comparten UNA sola condición de
    // validez (isEntryValid): modelo, versión de pipeline y dimensión
    // coherentes. Sin esta validación, la memoria devolvería entradas que la
    // ruta IndexedDB rechazaría (o al revés) y la retriección semántica
    // cambiaría de comportamiento entre sesión y sesión.
    const inMemory = this.inMemoryCache.get(cacheKey);
    if (inMemory !== undefined) {
      if (this.isEntryValid(inMemory, modelId, pipelineVersion)) return inMemory;
      // Entrada inválida en memoria: se descarta y se continúa en IndexedDB.
      this.inMemoryCache.delete(cacheKey);
    }

    if (!this.hasIndexedDB()) return null;

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const tx = db.transaction(this.resolveStore(db), 'readonly');
        const req = tx.objectStore(this.resolveStore(db)).get(cacheKey);
        req.onsuccess = () => {
          const res = (req.result as CachedVectorEntry) || null;
          if (res && this.isEntryValid(res, modelId, pipelineVersion)) {
            this.inMemoryCache.set(cacheKey, res);
            resolve(res);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  public async setEntry(entry: CachedVectorEntry): Promise<void> {
    const pipelineVersion = entry.pipelineVersion || EMBEDDING_PIPELINE_VERSION;
    const normalized: CachedVectorEntry = { ...entry, pipelineVersion };
    const cacheKey = this.entryKey(normalized);
    this.inMemoryCache.set(cacheKey, normalized);

    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      return new Promise((resolve, reject) => {
        const storeName = this.resolveStore(db);
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).put({ ...normalized, cacheKey });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('Error guardando vector en IndexedDB:', err);
    }
  }

  /**
   * Devuelve los vectores cacheados de EXACTAMENTE un modelo y versión de pipeline.
   *
   * Usa el índice compuesto `modelPipeline` cuando existe; si no está disponible
   * (base creada por una versión anterior), degrada al índice `modelId` y en
   * último término a una lectura completa. En todos los caminos la validación
   * final es la misma: modelo, versión de pipeline y dimensiones coherentes.
   */
  public async getAllEntriesForModel(
    modelId: string,
    pipelineVersion: string = EMBEDDING_PIPELINE_VERSION
  ): Promise<CachedVectorEntry[]> {
    const isEntryValid = (e: CachedVectorEntry) => this.isEntryValid(e, modelId, pipelineVersion);

    if (!this.hasIndexedDB()) {
      return Array.from(this.inMemoryCache.values()).filter(isEntryValid);
    }

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const storeName = this.resolveStore(db);
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);

        const settle = (rawList: CachedVectorEntry[]) => {
          const list = (rawList || []).filter(isEntryValid);
          for (const item of list) {
            this.inMemoryCache.set(this.entryKey(item), item);
          }
          resolve(list);
        };

        if (store.indexNames.contains('modelPipeline')) {
          const indexReq = store.index('modelPipeline').getAll(IDBKeyRange.only([modelId, pipelineVersion]));
          indexReq.onsuccess = () => settle((indexReq.result as CachedVectorEntry[]) || []);
          indexReq.onerror = () => {
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

  /**
   * Elimina una entrada lógica de la caché.
   *
   * Con `modelId` borra EXACTAMENTE esa entrada (chunk + modelo + pipeline) y
   * deja intactas las del mismo chunk bajo otros modelos o versiones. Sin
   * `modelId` borra todas las versiones del chunk (el material desapareció del
   * corpus, ninguna versión sigue siendo válida).
   */
  public async deleteEntry(chunkId: string, modelId?: string, pipelineVersion: string = EMBEDDING_PIPELINE_VERSION): Promise<void> {
    if (modelId) {
      this.inMemoryCache.delete(buildCacheKey(modelId, pipelineVersion, chunkId));
    } else {
      for (const key of Array.from(this.inMemoryCache.keys())) {
        if (key.endsWith(`::${chunkId}`)) this.inMemoryCache.delete(key);
      }
    }

    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      await new Promise<void>((resolve) => {
        const storeName = this.resolveStore(db);
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);

        if (modelId) {
          store.delete(buildCacheKey(modelId, pipelineVersion, chunkId));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          return;
        }

        // Sin modelo: recorrer y borrar cada versión del chunk.
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value as CachedVectorEntry;
          if (value?.chunkId === chunkId) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }

  /**
   * Purga proactiva de vectores de modelos/pipelines distintos del activo.
   *
   * La caché ya está versionada por (modelId, pipelineVersion), así que las
   * entradas antiguas NUNCA se sirven; pero hasta ahora solo se liberaban al
   * limpiar la caché a mano. Tras cambiar de modelo de embeddings quedaban
   * ocupando espacio indefinidamente. Devuelve cuántas entradas se eliminaron
   * (útil para diagnóstico y pruebas).
   */
  public async pruneOtherModels(
    activeModelId: string,
    activePipelineVersion: string = EMBEDDING_PIPELINE_VERSION
  ): Promise<number> {
    const isActive = (entry: CachedVectorEntry): boolean =>
      entry.modelId === activeModelId &&
      (entry.pipelineVersion || EMBEDDING_PIPELINE_VERSION) === activePipelineVersion;

    let removed = 0;
    for (const [key, entry] of Array.from(this.inMemoryCache.entries())) {
      if (!isActive(entry)) {
        this.inMemoryCache.delete(key);
        removed += 1;
      }
    }

    if (!this.hasIndexedDB()) return removed;

    try {
      const db = await this.openIDB();
      const fromIdb = await new Promise<number>((resolve) => {
        const storeName = this.resolveStore(db);
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        let count = 0;
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const value = cursor.value as CachedVectorEntry;
          if (value && !isActive(value)) {
            cursor.delete();
            count += 1;
          }
          cursor.continue();
        };
        tx.oncomplete = () => resolve(count);
        tx.onerror = () => resolve(count);
      });
      // IndexedDB es la fuente de verdad: se informa de las entradas realmente
      // borradas del almacén persistente. `removed` solo se usa como resultado
      // cuando IndexedDB no está disponible.
      return fromIdb;
    } catch {
      return removed;
    }
  }

  public async clearCache(): Promise<void> {
    this.inMemoryCache.clear();
    if (!this.hasIndexedDB()) return;

    try {
      const db = await this.openIDB();
      return new Promise((resolve) => {
        const storeName = this.resolveStore(db);
        const tx = db.transaction(storeName, 'readwrite');
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }

  /**
   * Cierra la conexión IndexedDB reutilizada.
   *
   * La conexión se reabre perezosamente en la siguiente operación, así que
   * cerrar es siempre seguro. Sirve para liberar el handle al descargar la
   * página y para que pruebas y otras pestañas no queden bloqueadas por
   * conexiones abiertas.
   */
  public close(): void {
    if (this.idbPromise) {
      this.idbPromise.then(db => { try { db.close(); } catch { /* ya cerrada */ } })
        .catch(() => { /* nunca se abrió */ });
      this.idbPromise = null;
    }
  }
}

export const embeddingCache = new LocalEmbeddingCache();
