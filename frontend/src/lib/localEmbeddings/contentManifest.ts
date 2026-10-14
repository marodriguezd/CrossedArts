import { EMBEDDING_PIPELINE_VERSION } from './cache.ts';
import { computeContentHash, computeSha256ContentHash, type SemanticChunk } from './chunking.ts';

/**
 * Local content-identity manifest.
 *
 * Problem it solves: semantic retrieval needs each fragment's CURRENT hash to
 * discard stale vectors. Recomputing SHA-256 for the whole corpus on every
 * query is correct but expensive; the manifest avoids that without losing
 * correctness:
 *
 *  - each fragment has a deterministic, cheap SIGNATURE (`length` + FNV-1a);
 *  - when the signature matches the stored one, the previous SHA-256 is REUSED;
 *  - when the signature changes (or the fragment is new), SHA-256 is recomputed
 *    and the manifest updated;
 *  - entries whose fragment no longer exists in the corpus are PURGED, so a
 *    deleted chunk can never count as current;
 *  - entry identity includes model and pipeline version: switching model or
 *    pipeline invalidates the whole manifest, and a hash from another pipeline
 *    is never served.
 *
 * Persistence: IndexedDB in a DEDICATED database (`CrossedArts_SemanticManifest`),
 * separate from the vector store so its schema and version stay untouched.
 * Without IndexedDB (tests, restricted envs) it degrades to memory under the
 * same contract.
 *
 * Determinism: signature and keys depend on neither time nor chance.
 */

const IDB_NAME = 'CrossedArts_SemanticManifest';
const IDB_VERSION = 1;
const STORE_NAME = 'chunk_hashes';

export interface ManifestEntry {
  /** Logical key: model::pipeline::chunkId. */
  key: string;
  chunkId: string;
  modelId: string;
  pipelineVersion: string;
  /** Deterministic, cheap signature of the fragment text. */
  signature: string;
  /** Real SHA-256 of the text (cryptographic identity for the vector cache). */
  contentHash: string;
}

export interface ResolveHashesResult {
  chunks: SemanticChunk[];
  /** Fragments whose SHA-256 was computed in this pass. */
  recomputed: number;
  /** Fragments whose SHA-256 was reused from the manifest. */
  reused: number;
  /** Entries purged because the material left the corpus. */
  purged: number;
}

/** Manifest logical key. Includes model and pipeline: both are part of the identity. */
export function buildManifestKey(modelId: string, pipelineVersion: string, chunkId: string): string {
  return `${modelId}::${pipelineVersion}::${chunkId}`;
}

/**
 * Deterministic, cheap signature of a text. NOT cryptographic: it only decides
 * whether SHA-256 must be recomputed. Any content change yields a different
 * signature with overwhelming probability.
 */
export function computeContentSignature(text: string): string {
  return `${text.length}:${computeContentHash(text)}`;
}

class SemanticContentManifest {
  private memory = new Map<string, ManifestEntry>();
  private idbPromise: Promise<IDBDatabase> | null = null;
  private loaded = false;

  private hasIndexedDB(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private openIDB(): Promise<IDBDatabase> {
    if (this.idbPromise) return this.idbPromise;
    this.idbPromise = this.openConnection().catch((err) => {
      this.idbPromise = null;
      throw err;
    });
    return this.idbPromise;
  }

  private openConnection(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('modelPipeline', ['modelId', 'pipelineVersion'], { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Loads the manifest once; afterwards it works off the in-memory cache. */
  private async ensureLoaded(modelId: string, pipelineVersion: string): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!this.hasIndexedDB()) return;
    try {
      const db = await this.openIDB();
      const entries = await new Promise<ManifestEntry[]>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const index = tx.objectStore(STORE_NAME).index('modelPipeline');
        const req = index.getAll(IDBKeyRange.only([modelId, pipelineVersion]));
        req.onsuccess = () => resolve((req.result as ManifestEntry[]) || []);
        req.onerror = () => resolve([]);
      });
      for (const entry of entries) this.memory.set(entry.key, entry);
    } catch {
      /* No usable IndexedDB: the in-memory manifest stays valid. */
    }
  }

  /**
   * Resolves each fragment's real `contentHash` by reusing the manifest.
   *
   * Correctness contract:
   *  - the returned SHA-256 ALWAYS matches the fragment's current text;
   *  - a fragment with no prior entry is fully computed;
   *  - a fragment whose signature changed recomputes its SHA-256 (invalidating
   *    ONLY its vectors);
   *  - a manifest fragment absent from the corpus is purged, so deleted
   *    material can never count as current.
   */
  public async resolveChunkHashes(
    chunks: SemanticChunk[],
    modelId: string,
    pipelineVersion: string = EMBEDDING_PIPELINE_VERSION
  ): Promise<ResolveHashesResult> {
    await this.ensureLoaded(modelId, pipelineVersion);

    const resolved: SemanticChunk[] = [];
    const seenKeys = new Set<string>();
    let recomputed = 0;
    let reused = 0;

    for (const chunk of chunks) {
      const key = buildManifestKey(modelId, pipelineVersion, chunk.chunkId);
      seenKeys.add(key);
      const signature = computeContentSignature(chunk.text);
      const cached = this.memory.get(key);

      if (cached && cached.signature === signature) {
        resolved.push({ ...chunk, contentHash: cached.contentHash });
        reused++;
        continue;
      }

      const contentHash = await computeSha256ContentHash(chunk.text);
      this.memory.set(key, { key, chunkId: chunk.chunkId, modelId, pipelineVersion, signature, contentHash });
      resolved.push({ ...chunk, contentHash });
      recomputed++;
    }

    // Deterministic purge: any entry whose fragment is gone from the corpus
    // belongs to deleted material and must not stay available.
    let purged = 0;
    for (const [key, entry] of Array.from(this.memory.entries())) {
      if (entry.modelId !== modelId || entry.pipelineVersion !== pipelineVersion) continue;
      if (seenKeys.has(key)) continue;
      this.memory.delete(key);
      purged++;
    }

    await this.persist(modelId, pipelineVersion);

    return { chunks: resolved, recomputed, reused, purged };
  }

  private async persist(modelId: string, pipelineVersion: string): Promise<void> {
    if (!this.hasIndexedDB()) return;
    try {
      const db = await this.openIDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        for (const entry of this.memory.values()) {
          if (entry.modelId === modelId && entry.pipelineVersion === pipelineVersion) {
            store.put(entry);
          }
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* The manifest is an optimization: if it is not persisted, it recomputes. */
    }
  }

  /** Deletes the manifest for one specific model/pipeline. */
  public async clear(modelId?: string, pipelineVersion?: string): Promise<void> {
    for (const [key, entry] of Array.from(this.memory.entries())) {
      if (modelId && entry.modelId !== modelId) continue;
      if (pipelineVersion && entry.pipelineVersion !== pipelineVersion) continue;
      this.memory.delete(key);
    }
    this.loaded = false;
    if (!this.hasIndexedDB()) return;
    try {
      const db = await this.openIDB();
      await new Promise<void>((resolve) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        if (modelId && pipelineVersion) {
          const index = store.index('modelPipeline');
          const req = index.openKeyCursor(IDBKeyRange.only([modelId, pipelineVersion]));
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) return;
            store.delete(cursor.primaryKey);
            cursor.continue();
          };
        } else {
          store.clear();
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      /* idempotent */
    }
  }

  public close(): void {
    if (this.idbPromise) {
      this.idbPromise.then(db => { try { db.close(); } catch { /* already closed */ } })
        .catch(() => { /* never opened */ });
      this.idbPromise = null;
    }
  }

  /** Tests only: in-memory manifest state. */
  public snapshot(): ManifestEntry[] {
    return Array.from(this.memory.values());
  }
}

export const semanticContentManifest = new SemanticContentManifest();