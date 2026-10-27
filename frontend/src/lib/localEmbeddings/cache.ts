import { getEmbeddingModelById } from './registry.ts';

/**
 * Cache-schema identity.
 *
 * Bumped whenever the STORED entry shape changes: v2.1 adds `substantive` and
 * the resource/lesson anchors, so entries written before it have no valid
 * provenance and must expire instead of being served.
 */
export const EMBEDDING_PIPELINE_VERSION = 'v2.1-substantive-anchors';

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
  /**
   * Mirrors `SemanticChunk.substantive`: the chunk carries body content.
   * Fusion reads it so a metadata-only hit never claims to be substantive.
   */
  substantive?: boolean;
  /** Provenance anchors, needed by scoped retrieval. */
  resourceId?: string;
  lessonId?: string;
}

const IDB_NAME = 'CrossedArts_Embeddings';
/** Version 3: schema with composite logical key (model::pipeline::chunk). */
const IDB_VERSION = 3;
/** Legacy store (v1/v2) with `chunkId` keyPath: one entry per chunk. */
const LEGACY_STORE_NAME: string = 'vector_cache';
/** v3 store with `cacheKey` keyPath: model and pipeline versions coexist. */
const STORE_NAME: string = 'vector_cache_v3';

/**
 * Logical cache key. The old store used `chunkId` as primary key, so one
 * model's vector OVERWROTE another's for the same chunk. An entry's real
 * identity is (chunkId, modelId, pipelineVersion).
 */
export function buildCacheKey(modelId: string, pipelineVersion: string, chunkId: string): string {
  return `${modelId}::${pipelineVersion}::${chunkId}`;
}

/**
 * EFFECTIVE dimension (stored and queried) for a model per the local
 * registry: the MRL-truncated output (`outputDimension`), else
 * `dimensions`/`dimension`.
 *
 * This is the cache contract: vectors are stored and fetched with this
 * dimension and cosine similarity runs on it. The model's NATIVE dimension
 * (`dimension`, 768d for EmbeddingGemma) stays declared in the registry to
 * validate raw pipeline output, but is never used here: validating against it
 * would hide every MRL (256d) vector.
 *
 * Returns `undefined` for unknown models: validation then falls back to the
 * entry's own declared `dimensions` field.
 */
export function expectedDimensionsForModel(modelId: string): number | undefined {
  const def = getEmbeddingModelById(modelId);
  return def?.outputDimension ?? def?.dimensions ?? def?.dimension;
}

/**
 * Normalizes a legacy record (no `pipelineVersion`) to the current identity.
 * Idempotent: an already migrated record passes through unchanged.
 */
export function migrateLegacyCacheRecord(record: CachedVectorEntry): CachedVectorEntry {
  const pipelineVersion = record.pipelineVersion || EMBEDDING_PIPELINE_VERSION;
  return { ...record, pipelineVersion };
}

/**
 * Upper bound for vectors retained in memory.
 *
 * A 256-d vector costs ~2 KB as a JS array; caching a 5k-chunk library kept
 * ~10 MB alive forever. The cache is an OPTIMIZATION, so it is bounded and
 * evicts least-recently-used entries: IndexedDB stays the source of truth.
 */
const MAX_IN_MEMORY_VECTORS = 512;

class LocalEmbeddingCache {
  /** In-memory cache keyed by the same logical key as IndexedDB (LRU order). */
  private inMemoryCache: Map<string, CachedVectorEntry> = new Map();

  /** Inserts/refreshes an entry and evicts the least recently used ones. */
  private rememberInMemory(key: string, entry: CachedVectorEntry): void {
    this.inMemoryCache.delete(key);
    this.inMemoryCache.set(key, entry);
    while (this.inMemoryCache.size > MAX_IN_MEMORY_VECTORS) {
      const oldest = this.inMemoryCache.keys().next();
      if (oldest.done) break;
      this.inMemoryCache.delete(oldest.value);
    }
  }
  /**
   * IndexedDB handle reused across operations.
   *
   * Opening one connection per operation and never closing it grows without
   * bound (each connection holds memory and blocks other tabs'
   * `deleteDatabase`). The handle is memoized after first use and reopened
   * only if something closed it.
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
    let promise: Promise<IDBDatabase>;
    /** Drops the memoized handle so the next operation reopens it lazily. */
    const forget = () => {
      if (this.idbPromise === promise) this.idbPromise = null;
    };
    promise = this.openIDBConnection(forget).catch((err) => {
      // A transient failure must not be memoized: the next retry reopens.
      forget();
      throw err;
    });
    this.idbPromise = promise;
    return promise;
  }

  private openIDBConnection(onVersionChange: () => void): Promise<IDBDatabase> {
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

        // Migration from the legacy store (`chunkId` keyPath): each record is
        // copied to the new store under its logical key and the old one is
        // dropped. Runs inside `onupgradeneeded` (version transaction); it is
        // idempotent and keeps every still-representable vector.
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
      req.onsuccess = () => {
        const db = req.result;
        // A version change (another tab deleting the database or bumping
        // IDB_VERSION) stays BLOCKED while any handle is open: ours never
        // yielded, so that tab's `open`/`deleteDatabase` never completed and its
        // cache operations queued forever. Releasing here is what makes the
        // memoized handle compatible with other tabs; the next operation
        // reopens it.
        db.onversionchange = () => {
          try {
            db.close();
          } catch {
            /* already closed */
          }
          onVersionChange();
        };
        resolve(db);
      };
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

    // In-memory cache and IndexedDB share ONE validity condition
    // (isEntryValid): coherent model, pipeline version, and dimension.
    // Without it, memory would return entries the IndexedDB path rejects (or
    // vice versa) and semantic retrieval would behave differently from one
    // session to the next.
    const inMemory = this.inMemoryCache.get(cacheKey);
    if (inMemory !== undefined) {
      if (this.isEntryValid(inMemory, modelId, pipelineVersion)) {
        this.rememberInMemory(cacheKey, inMemory);
        return inMemory;
      }
      // Invalid in-memory entry: dropped, then IndexedDB is tried.
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
            this.rememberInMemory(cacheKey, res);
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
    this.rememberInMemory(cacheKey, normalized);

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
   * Writes MANY vectors in a single IndexedDB transaction.
   *
   * Restoring a backup used to call `setEntry` per vector: 5.000 vectors meant
   * 5.000 transactions, each with its own commit. The whole batch now shares one
   * readwrite transaction, which is atomic (all or nothing) and orders of
   * magnitude cheaper.
   *
   * Returns how many entries were written: the full batch on commit, `0` when
   * IndexedDB is unavailable or the transaction failed. Memory is updated in
   * either case, since it is only a cache in front of the store.
   */
  public async setEntries(entries: CachedVectorEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const normalized = entries.map((entry) => {
      const withVersion: CachedVectorEntry = {
        ...entry,
        pipelineVersion: entry.pipelineVersion || EMBEDDING_PIPELINE_VERSION
      };
      return { entry: withVersion, cacheKey: this.entryKey(withVersion) };
    });

    for (const { entry, cacheKey } of normalized) this.rememberInMemory(cacheKey, entry);

    if (!this.hasIndexedDB()) return normalized.length;

    try {
      const db = await this.openIDB();
      const storeName = this.resolveStore(db);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        for (const { entry, cacheKey } of normalized) {
          store.put({ ...entry, cacheKey });
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return normalized.length;
    } catch (err) {
      console.warn('Error guardando vectores en IndexedDB:', err);
      return 0;
    }
  }

  /**
   * Returns cached vectors for EXACTLY one model and pipeline version.
   *
   * Uses the composite `modelPipeline` index when available; otherwise falls
   * back to the `modelId` index and finally to a full scan. Every path ends
   * with the same check: coherent model, pipeline version, and dimensions.
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
          // Only the tail is retained: loading a large library must not pin
          // every vector in memory at once.
          for (const item of list) {
            this.rememberInMemory(this.entryKey(item), item);
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
   * Deletes one logical cache entry.
   *
   * With `modelId` it deletes EXACTLY that entry (chunk + model + pipeline)
   * and keeps the same chunk under other models or versions. Without
   * `modelId` it deletes every version of the chunk (the material left the
   * corpus, so no version stays valid).
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

        // Without a model: scan and delete every version of the chunk.
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
   * Proactively purges vectors from non-active models/pipelines.
   *
   * The cache is already versioned by (modelId, pipelineVersion), so stale
   * entries are NEVER served; but until now they were only freed by manual
   * cache clears. After switching embedding models they lingered forever.
   * Returns how many entries were removed (useful for diagnostics and tests).
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
      // IndexedDB is the source of truth: report entries actually deleted
      // from persistent storage. `removed` is only the result when IndexedDB
      // is unavailable.
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
   * Closes the reused IndexedDB connection.
   *
   * The connection reopens lazily on the next operation, so closing is always
   * safe. It releases the handle on page unload and keeps tests and other
   * tabs from blocking on open connections.
   */
  public close(): void {
    if (this.idbPromise) {
      this.idbPromise.then(db => { try { db.close(); } catch { /* already closed */ } })
        .catch(() => { /* never opened */ });
      this.idbPromise = null;
    }
  }
}

export const embeddingCache = new LocalEmbeddingCache();
