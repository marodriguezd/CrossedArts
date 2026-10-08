import { EMBEDDING_PIPELINE_VERSION } from './cache.ts';
import { computeContentHash, computeSha256ContentHash, type SemanticChunk } from './chunking.ts';

/**
 * Manifiesto local de identidad de contenido.
 *
 * Problema que resuelve: la recuperación semántica necesita conocer el hash
 * ACTUAL de cada fragmento para descartar vectores obsoletos. Recalcular el
 * SHA-256 del corpus entero en cada consulta es correcto pero caro; el
 * manifiesto permite evitarlo sin perder corrección:
 *
 *  - cada fragmento tiene una FIRMA determinista y barata (`longitud` + FNV-1a);
 *  - si la firma coincide con la guardada, se REUTILIZA el SHA-256 anterior;
 *  - si la firma cambia (o el fragmento es nuevo), se recalcula SHA-256 y se
 *    actualiza el manifiesto;
 *  - las entradas cuyo fragmento ya no existe en el corpus se PURGAN, de modo
 *    que un chunk eliminado no puede considerarse vigente;
 *  - la identidad de la entrada incluye modelo y versión de pipeline: cambiar de
 *    modelo o de pipeline invalida el manifiesto completo, nunca se sirve un
 *    hash de otro pipeline.
 *
 * Persistencia: IndexedDB en una base DEDICADA (`CrossedArts_SemanticManifest`),
 * separada del almacén de vectores para no alterar su esquema ni su versión. Sin
 * IndexedDB (tests, entornos restringidos) degrada a memoria con el mismo
 * contrato.
 *
 * Determinismo: la firma y las claves no dependen del tiempo ni del azar.
 */

const IDB_NAME = 'CrossedArts_SemanticManifest';
const IDB_VERSION = 1;
const STORE_NAME = 'chunk_hashes';

export interface ManifestEntry {
  /** Clave lógica: modelo::pipeline::chunkId. */
  key: string;
  chunkId: string;
  modelId: string;
  pipelineVersion: string;
  /** Firma determinista y barata del texto del fragmento. */
  signature: string;
  /** SHA-256 real del texto (identidad criptográfica de la caché de vectores). */
  contentHash: string;
}

export interface ResolveHashesResult {
  chunks: SemanticChunk[];
  /** Fragmentos cuyo SHA-256 se calcularon en esta pasada. */
  recomputed: number;
  /** Fragmentos cuyo SHA-256 se reutilizó del manifiesto. */
  reused: number;
  /** Entradas purgadas por material eliminado del corpus. */
  purged: number;
}

/** Clave lógica del manifiesto. Incluye modelo y pipeline: son parte de la identidad. */
export function buildManifestKey(modelId: string, pipelineVersion: string, chunkId: string): string {
  return `${modelId}::${pipelineVersion}::${chunkId}`;
}

/**
 * Firma determinista y barata de un texto. NO es criptográfica: solo decide si
 * hay que volver a calcular el SHA-256. Cualquier cambio de contenido produce
 * una firma distinta con probabilidad overwhelming.
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

  /** Carga el manifiesto una sola vez; después opera sobre la caché en memoria. */
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
      /* Sin IndexedDB utilizable: el manifiesto en memoria sigue siendo válido. */
    }
  }

  /**
   * Resuelve el `contentHash` real de cada fragmento reutilizando el manifiesto.
   *
   * Contrato de corrección:
   *  - el SHA-256 devuelto SIEMPRE corresponde al texto actual del fragmento;
   *  - un fragmento sin entrada previa se calcula íntegramente;
   *  - un fragmento cuya firma cambió recalcula su SHA-256 (invalida SOLO sus
   *    vectores);
   *  - un fragmento del manifiesto que ya no está en el corpus se purga, de modo
   *    que el material eliminado no pueda considerarse vigente.
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

    // Purga determinista: cualquier entrada cuyo fragmento ya no está en el
    // corpus corresponde a material eliminado y no debe quedar disponible.
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
      /* El manifiesto es una optimización: si no se persiste, se recalcula. */
    }
  }

  /** Elimina el manifiesto de un modelo/pipeline concreto. */
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
      /* idempotente */
    }
  }

  public close(): void {
    if (this.idbPromise) {
      this.idbPromise.then(db => { try { db.close(); } catch { /* ya cerrada */ } })
        .catch(() => { /* nunca se abrió */ });
      this.idbPromise = null;
    }
  }

  /** Solo para pruebas: estado en memoria del manifiesto. */
  public snapshot(): ManifestEntry[] {
    return Array.from(this.memory.values());
  }
}

export const semanticContentManifest = new SemanticContentManifest();