import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import { resolveAppLanguage } from '../i18n/resolveAppLanguage.ts';
import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL, KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL, buildPracticeWorkTableSql, PRACTICE_WORK_INDEX_SQL } from './schema.ts';
import { SEED_SQL } from './seedDemo.ts';
import { resolveSqliteWasmUrl, deployedSqliteWasmFilename } from './sqliteWasmUrl.ts';

const DB_STORE_NAME = 'crossedarts_sqlite_store';
const DB_KEY = 'current_database_bytes';
/** Multi-tab coordination metadata record (persisted revision). */
const DB_META_KEY = 'coordinator_meta';

/**
 * Coordination metadata persisted ALONGSIDE the snapshot in IndexedDB.
 *
 * The revision is the shared source of truth across tabs: on write, each tab
 * confirms the persisted revision is still the one it knew (compare-and-swap).
 * When another tab advanced the revision meanwhile, the local write is rejected
 * instead of silently clobbering its snapshot.
 */
interface PersistedCoordinatorMeta {
  revision: number;
  lastWriterTabId: string;
  updatedAt: number;
}

let dbLang: LanguageCode = resolveAppLanguage();

/** Module-level UI language for DB failure messages (mirrors Settings). */
export function setDbLanguage(lang: LanguageCode): void {
  dbLang = lang;
}

/**
 * Stale-write error (concurrency conflict). Thrown by `persist()` when the
 * persisted revision is no longer the one this tab knew. `persistedRevision`
 * is the actually persisted (winning) revision.
 */
export class StaleWriteError extends Error {
  public readonly persistedRevision: number;
  constructor(persistedRevision: number) {
    super(translateKey(dbLang, 'db.otherTab'));
    this.name = 'StaleWriteError';
    this.persistedRevision = persistedRevision;
  }
}

export type StorageState =
  | 'loading'
  | 'ready'
  | 'persisting'
  | 'persisted'
  | 'persistence-error'
  | 'corrupt-storage'
  | 'storage-unavailable'
  | 'stale-other-tab';

/**
 * Terminal SQLite-init lifecycle. `failed` is a real, observable state: the app
 * must not mount its views against a missing database (that was what made the
 * knowledge graph show "Database not initialized" inside the rendered app).
 */
export type InitState = 'idle' | 'initializing' | 'ready' | 'failed';

/** Known init-failure classes, with controlled Spanish-language text. */
export type DbInitFailureCode =
  | 'wasm-unavailable'
  | 'storage-unavailable'
  | 'corrupt-storage'
  | 'schema-invalid'
  | 'stale-other-tab'
  | 'unknown';

export interface DbInitFailure {
  code: DbInitFailureCode;
  /** User-facing message in Spanish. Never internal English text. */
  message: string;
  /** When true, retrying is worthwhile. Never implies data loss. */
  retryable: boolean;
  /** Technical detail for the developer console only. */
  detail?: string;
}

/**
 * Init error carrying a controlled Spanish-language message. Keeps child views
 * from ever showing an inner exception's raw text.
 */
export class DatabaseInitializationError extends Error {
  public readonly failure: DbInitFailure;
  constructor(failure: DbInitFailure) {
    super(failure.message);
    this.name = 'DatabaseInitializationError';
    this.failure = failure;
  }
}

function initFailureMessages(lang: LanguageCode = dbLang): Record<DbInitFailureCode, { message: string; retryable: boolean }> {
  const tr = (key: string): string => translateKey(lang, key);
  return {
  'wasm-unavailable': {
    message: tr('db.wasmFail'),
    retryable: true
  },
  'storage-unavailable': {
    message: tr('db.storageBlocked'),
    retryable: true
  },
  'corrupt-storage': {
    message: tr('db.unsafeOpen'),
    retryable: false
  },
  'schema-invalid': {
    message: tr('db.badSchema'),
    retryable: false
  },
  'stale-other-tab': {
    message: tr('db.tabUpdated'),
    retryable: true
  },
  unknown: {
    message: tr('db.initFail'),
    retryable: true
  }
  };
}

function classifyInitError(err: unknown): DbInitFailure {
  const detail = err instanceof Error ? err.message : String(err);
  const lower = detail.toLowerCase();
  let code: DbInitFailureCode = 'unknown';
  if (lower.includes('wasm') || lower.includes('fetch') || lower.includes('network') || lower.includes('locatefile')) {
    code = 'wasm-unavailable';
  } else if (lower.includes('indexeddb') || lower.includes('idb') || lower.includes('transaction blocked')) {
    code = 'storage-unavailable';
  } else if (
    lower.includes('schema') ||
    lower.includes('no such column') ||
    lower.includes('no such table') ||
    lower.includes('syntax error') ||
    lower.includes('table ')
  ) {
    code = 'schema-invalid';
  } else if (
    lower.includes('sqlite') ||
    lower.includes('corrupt') ||
    lower.includes('malformed') ||
    lower.includes('not a database') ||
    lower.includes('integrity') ||
    lower.includes('quick_check')
  ) {
    code = 'corrupt-storage';
  }
  return { ...initFailureMessages()[code], code, detail };
}

export interface StorageStatusReport {
  state: StorageState;
  hasIndexedDB: boolean;
  isPersistentGranted: boolean;
  lastPersistedTimestamp: number | null;
  lastError: string | null;
  approximateStorageBytes?: number;
  databaseSizeBytes: number;
}

const SQLITE_HEADER_STRING = 'SQLite format 3\0';

export function isValidSqliteBuffer(buffer: ArrayBuffer | Uint8Array): boolean {
  if (!buffer || buffer.byteLength < 16) return false;
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const header = String.fromCharCode(...bytes.slice(0, 16));
  return header === SQLITE_HEADER_STRING;
}

/** Unique id for this tab, used to ignore its own broadcast messages. */
const TAB_ID = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

class SQLiteBridge {
  private db: Database | null = null;
  private isInitialized = false;
  private inMemoryBytes: Uint8Array | null = null;
  private storageState: StorageState = 'loading';
  private lastPersistedAt: number | null = null;
  private lastError: string | null = null;
  private broadcastChannel: BroadcastChannel | null = null;
  private stateListeners: Set<(report: StorageStatusReport) => void> = new Set();
  /**
   * Shared init promise. While present, EVERY caller gets exactly the same
   * operation: no parallel `init()` sequences racing to write `this.db`.
   */
  private initPromise: Promise<Database> | null = null;
  private initState: InitState = 'idle';
  private initFailure: DbInitFailure | null = null;
  /**
   * Monotone persisted-version revision. Bumped on every `persist()` and carried
   * in the coordination message so another tab can tell its in-memory state may
   * be stale, without resolving conflicts.
   */
  private persistedRevision = 0;
  private lastSeenRevision = 0;
  /** Second-highest revision seen on the channel: our local version is old. */
  private remoteRevision = 0;
  private reloadPromise: Promise<void> | null = null;
  /**
   * Cached last-export size. Avoids calling `db.export()` (which closes and
   * reopens the SQLite connection and resets PRAGMAs like `foreign_keys`) just
   * to report the size on every status notice.
   */
  private databaseSizeBytes = 0;
  private persistentStorageGranted = false;

  constructor() {
    void this.refreshPersistentStorageState();
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('crossedarts_storage_coordination');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'DATABASE_MUTATED_ANOTHER_TAB') {
            const revision = Number(event.data.revision) || 0;
            // Ignore our own messages and any already-absorbed revision: never
            // enter a reload loop.
            if (event.data.origin === TAB_ID) return;
            this.lastSeenRevision = Math.max(this.lastSeenRevision, revision);
            if (revision > this.persistedRevision) {
              // Another tab persisted a newer version than ours: our in-memory
              // state may be stale. No conflict is resolved here; it is only
              // flagged for reload BEFORE the next data operation (see
              // `ensureFresh`).
              this.remoteRevision = Math.max(this.remoteRevision, revision);
              this.setStorageState('stale-other-tab');
              console.info('[CrossedArts Storage] Otra pestaña guardó una versión más nueva; se recargará antes de la siguiente lectura.');
            }
          }
        };
      } catch (e) {
        console.warn('BroadcastChannel no disponible:', e);
      }
    }
  }

  public getStorageReport(): StorageStatusReport {
    return {
      state: this.storageState,
      hasIndexedDB: this.hasIndexedDB(),
      isPersistentGranted: this.persistentStorageGranted,
      lastPersistedTimestamp: this.lastPersistedAt,
      lastError: this.lastError,
      databaseSizeBytes: this.databaseSizeBytes
    };
  }

  private async refreshPersistentStorageState(): Promise<void> {
    if (typeof navigator === 'undefined' || !('storage' in navigator) || typeof navigator.storage.persisted !== 'function') return;
    try {
      this.persistentStorageGranted = await navigator.storage.persisted();
      const report = this.getStorageReport();
      for (const listener of this.stateListeners) {
        try { listener(report); } catch { /* listener aislado */ }
      }
    } catch {
      this.persistentStorageGranted = false;
    }
  }

  public subscribeStorage(listener: (report: StorageStatusReport) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.getStorageReport());
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  private setStorageState(state: StorageState, error: string | null = null) {
    this.storageState = state;
    this.lastError = error;
    if (state === 'persisted') {
      this.lastPersistedAt = Date.now();
    }
    const report = this.getStorageReport();
    for (const listener of this.stateListeners) {
      try {
        listener(report);
      } catch (err) {
        console.error('Error in storage state listener:', err);
      }
    }
  }

  private async getSqlJsOptions(): Promise<any> {
    // In the browser, resolve the WASM against the deployed document's REAL base
    // (`document.baseURI`), not a bundle-relative path. On GitHub Pages under
    // `/CrossedArts/` the request becomes `https://.../CrossedArts/sql-wasm.wasm`
    // without hardcoding the repo name, staying portable to any static base.
    //
    // Also normalize to the file actually deployed: Vite resolves `sql.js` via
    // its `browser` condition, whose build asks for `sql-wasm-browser.wasm`
    // (absent from `public/`). Both binaries are identical, so pointing at
    // `sql-wasm.wasm` is correct and deterministic.
    let initOptions: any = {
      locateFile: (file: string) =>
        resolveSqliteWasmUrl(deployedSqliteWasmFilename(file), document.baseURI)
    };

    // Node.js / CLI test support without network (0 web access)
    if (typeof window === 'undefined') {
      try {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const wasmPath = path.resolve('public/sql-wasm.wasm');
        if (fs.existsSync(wasmPath)) {
          initOptions = { wasmBinary: fs.readFileSync(wasmPath) };
        }
      } catch (err) {
        console.warn('Fallback sql.js options en Node:', err);
      }
    }
    return initOptions;
  }

  /**
   * Initialize SQLite CONCURRENCY-SAFELY.
   *
   * Every call used to run its own full sequence (`initSqlJs`, `loadFromStorage`,
   * migrations, `persist`) because the `if (this.db && this.isInitialized)` check
   * is only valid with no `await` between check and assignment. Under overlapping
   * calls (React StrictMode mount-unmount-mounts the `useAppData` effect, and
   * lazy views like KnowledgeGraph fetch on their own), two sequences raced to
   * write `this.db`: one could clobber the other and `getDatabase()` threw
   * "Database not initialized" while the rest of the app was already rendered.
   *
   * Init is now one shared promise: the first caller creates it, the rest await
   * it. Explicit terminal states (`ready` / `failed`) let the UI tell
   * "initializing" from "failed" and show a controlled Spanish-language error
   * instead of an inner exception's raw text.
   */
  public async init(): Promise<Database> {
    if (this.db && this.isInitialized) return this.db;

    // An in-flight initializer is shared, never duplicated.
    if (!this.initPromise) {
      this.initPromise = this.runInit().finally(() => {
        // Release the slot only while still the current promise: an explicit
        // retry creates a new promise that must not be clobbered.
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  /** Run the real init sequence (once per attempt). */
  private async runInit(): Promise<Database> {
    this.initState = 'initializing';
    this.initFailure = null;
    this.setStorageState('loading');

    try {
      const options = await this.getSqlJsOptions();
      let SQL;
      try {
        SQL = await initSqlJs(options);
      } catch (err) {
        // The WASM is a critical resource: when it fails to load, init fails
        // terminally and in a controlled way; the app never half-renders.
        throw new DatabaseInitializationError(classifyInitError(err));
      }

      let savedBytes: Uint8Array | null = null;
      try {
        savedBytes = await this.loadFromStorage();
        const startupMeta = await this.loadPersistedMeta();
        const startupRevision = startupMeta?.revision ?? 0;
        this.persistedRevision = startupRevision;
        this.lastSeenRevision = Math.max(this.lastSeenRevision, startupRevision);
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.toLowerCase().includes('snapshot') || msg.includes('instantánea') || msg.includes('快照')) {
          this.setStorageState('corrupt-storage', msg);
          throw new DatabaseInitializationError({
            ...initFailureMessages()['corrupt-storage'],
            code: 'corrupt-storage',
            detail: msg
          });
        }
        // Without IndexedDB we can still work in memory: not a terminal
        // failure, report the state and carry on.
        this.setStorageState('storage-unavailable', msg || 'IndexedDB no disponible');
        if (this.loadFromStorage !== SQLiteBridge.prototype['loadFromStorage']) {
          // When the method is stubbed in a test to exercise storage failures.
          throw new DatabaseInitializationError(classifyInitError(err));
        }
      }

      if (savedBytes && savedBytes.byteLength > 0) {
        if (!isValidSqliteBuffer(savedBytes)) {
          this.setStorageState('corrupt-storage', translateKey(dbLang, 'db.corruptStore'));
          throw new DatabaseInitializationError({
            ...initFailureMessages()['corrupt-storage'],
            code: 'corrupt-storage',
            detail: translateKey(dbLang, 'db.badHeader')
          });
        }

        let migrated = false;
        try {
          this.db = new SQL.Database(savedBytes);
          this.db.run('PRAGMA foreign_keys = ON;');
          const check = this.db.exec('PRAGMA quick_check;');
          if (check.length && check[0].values.length && check[0].values[0][0] !== 'ok') {
            throw new Error(`Integridad SQLite comprometida: ${String(check[0].values[0][0])}`);
          }
          migrated = this.applyMigrationsAndCompleteSchema(this.db);
          this.validateDatabaseSchema(this.db);
        } catch (e: any) {
          try { this.db?.close(); } catch { /* cierre defensivo */ }
          this.db = null;
          const failure = classifyInitError(e);
          this.setStorageState(
            failure.code === 'corrupt-storage' ? 'corrupt-storage' : 'storage-unavailable',
            failure.detail || failure.message
          );
          throw new DatabaseInitializationError(failure);
        }
        if (this.db) {
          this.isInitialized = true;
          this.initState = 'ready';
          this.setStorageState('ready');
          if (migrated) {
            // Persist the migration outside the recovery block: a transient
            // storage failure must not discard user data.
            try {
              await this.persist();
            } catch (err) {
              console.warn('No se pudo persistir la migración de esquema:', err);
            }
          }
        }
      } else {
        this.db = new SQL.Database();
        this.db.run('PRAGMA foreign_keys = ON;');
        this.db.run(SCHEMA_SQL);
        this.db.run(SEED_SQL);
        this.db.run(KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL);
        this.db.run('CREATE INDEX IF NOT EXISTS idx_flashcard_lesson ON flashcard(lesson_id);');
        this.isInitialized = true;
        this.initState = 'ready';
        this.setStorageState('ready');
        // Without IndexedDB, `persist()` degrades to `inMemoryBytes` without throwing.
        await this.persist();
      }

      return this.db!;
    } catch (err) {
      // Terminal failure state. The app must not mount its views.
      this.db = null;
      this.isInitialized = false;
      this.initState = 'failed';
      this.initFailure =
        err instanceof DatabaseInitializationError ? err.failure : classifyInitError(err);
      this.setStorageState(
        this.initFailure.code === 'corrupt-storage' ? 'corrupt-storage' : 'storage-unavailable',
        this.initFailure.detail || this.initFailure.message
      );
      console.error('[CrossedArts DB] Fallo de inicialización:', this.initFailure.detail || this.initFailure.message);
      throw err instanceof DatabaseInitializationError
        ? err
        : new DatabaseInitializationError(this.initFailure);
    }
  }

  /** Current initialization lifecycle state. */
  public getInitState(): InitState {
    return this.initState;
  }

  /** Detail of the last initialization failure, if any. */
  public getInitFailure(): DbInitFailure | null {
    return this.initFailure;
  }

  /**
   * Lets a lazy child (KnowledgeGraph) await the in-flight init instead of
   * assuming the database exists. Safe under StrictMode and concurrent calls
   * because it returns the same shared promise.
   */
  public async ensureInitialized(): Promise<Database> {
    if (this.db && this.isInitialized) {
      await this.ensureFresh();
      return this.db;
    }
    const db = await this.init();
    await this.ensureFresh();
    return db;
  }

  /**
   * Detect multi-tab staleness and reload from IndexedDB BEFORE the next data
   * operation. Resolves no conflicts and never overwrites with old data: when
   * our revision trails the remote one, the IndexedDB version (written by the
   * other tab) wins by definition.
   */
  public async ensureFresh(): Promise<void> {
    if (this.remoteRevision <= this.persistedRevision) return;
    if (!this.reloadPromise) {
      this.reloadPromise = this.reloadFromPeerRevision().finally(() => {
        this.reloadPromise = null;
      });
    }
    return this.reloadPromise;
  }

  private async reloadFromPeerRevision(): Promise<void> {
    const target = this.remoteRevision;
    let bytes: Uint8Array | null = null;
    let effectiveTargetRevision = target;
    try {
      bytes = await this.loadFromStorage();
      // Adopt the real shared revision alongside the snapshot: channel messages
      // are a hint, the persisted record is the source of truth.
      const meta = await this.loadPersistedMeta();
      if (meta && meta.revision > this.persistedRevision) {
        effectiveTargetRevision = meta.revision;
      }
    } catch (err) {
      console.warn('[CrossedArts Storage] No se pudo releer IndexedDB tras otra pestaña:', err);
      return;
    }
    // Nothing readable: keep the current state. Serving possibly-stale data
    // beats losing the session over a transient failure.
    if (!bytes || !bytes.length || !isValidSqliteBuffer(bytes)) return;
    // Never overwrite with a revision older than the one already held.
    if (effectiveTargetRevision !== target && effectiveTargetRevision <= this.persistedRevision) return;

    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);
    const reloaded = new SQL.Database(bytes);
    reloaded.run('PRAGMA foreign_keys = ON;');
    try {
      this.applyMigrationsAndCompleteSchema(reloaded);
    } catch (err) {
      console.warn('[CrossedArts Storage] Advertencia durante migración de recarga:', err);
    }

    if (this.db) {
      try { this.db.close(); } catch { /* ya cerrado */ }
    }
    this.db = reloaded;
    this.isInitialized = true;
    this.inMemoryBytes = bytes;
    this.persistedRevision = effectiveTargetRevision;
    this.remoteRevision = 0;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, this.persistedRevision);
    this.setStorageState('ready');
    console.info('[CrossedArts Storage] Estado en memoria actualizado tras la escritura de otra pestaña.');
  }

  /**
   * Synchronous database access.
   *
   * It used to throw the raw English "Database not initialized", which leaked
   * into the UI (the knowledge graph painted it verbatim). It now tells the two
   * real cases apart, and both messages are known-class, Spanish-language, with
   * an actionable recovery path.
   */
  public getDatabase(): Database {
    if (this.remoteRevision > this.persistedRevision) {
      throw new DatabaseInitializationError({
        ...initFailureMessages()['stale-other-tab'],
        code: 'stale-other-tab',
        detail: translateKey(dbLang, 'db.staleTab')
      });
    }
    if (!this.db) {
      if (this.initState === 'failed' || this.initFailure) {
        throw new DatabaseInitializationError(
          this.initFailure || {
            ...initFailureMessages().unknown,
            code: 'unknown'
          }
        );
      }
      throw new DatabaseInitializationError({
        ...initFailureMessages()['storage-unavailable'],
        code: 'storage-unavailable',
        detail: translateKey(dbLang, 'db.earlyAccess')
      });
    }
    return this.db;
  }

  /**
   * Read the persisted coordination metadata (shared revision). Returns revision
   * 0 when still absent: matches any tab's boot and databases created by older
   * versions without this record.
   */
  private async loadPersistedMeta(): Promise<PersistedCoordinatorMeta | null> {
    if (!this.hasIndexedDB()) return null;
    try {
      const idb = await this.openIDB();
      return await new Promise((resolve, reject) => {
        const tx = idb.transaction(DB_STORE_NAME, 'readonly');
        const req = tx.objectStore(DB_STORE_NAME).get(DB_META_KEY);
        req.onsuccess = () => resolve((req.result as PersistedCoordinatorMeta) || null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  /**
   * Write snapshot + metadata in ONE IndexedDB transaction with revision
   * compare-and-swap.
   *
   * Lost-update guard: when the persisted revision is no longer
   * `expectedRevision`, another tab wrote after this tab loaded its state. The
   * transaction aborts WITHOUT touching the persisted bytes and throws
   * `StaleWriteError`: the other tab's snapshot stays intact and the user
   * reloads before re-applying the change.
   */
  private async commitPersistedBytes(bytes: Uint8Array): Promise<void> {
    const nextRevision = this.persistedRevision + 1;
    await this.saveToStorageWithCas(bytes, nextRevision);
    this.inMemoryBytes = bytes;
    this.databaseSizeBytes = bytes.byteLength;
    this.persistedRevision = nextRevision;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, nextRevision);
    this.remoteRevision = 0;
    this.setStorageState('persisted');

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'DATABASE_MUTATED_ANOTHER_TAB',
          revision: this.persistedRevision,
          origin: TAB_ID,
          timestamp: Date.now()
        });
      } catch {}
    }
  }

  private async saveToStorageWithCas(bytes: Uint8Array, nextRevision: number): Promise<boolean> {
    // Without IndexedDB there is no cross-tab sharing: persisting is safe and
    // delegates to the plain write (same seam for tests).
    if (!this.hasIndexedDB()) {
      await this.saveToStorage(bytes);
      return true;
    }
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(DB_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DB_STORE_NAME);
      let committed = false;
      let observedPersistedRevision = 0;

      const casReq = store.get(DB_META_KEY);
      casReq.onsuccess = () => {
        const persistedMeta = (casReq.result as PersistedCoordinatorMeta | undefined) || null;
        const persistedRevision = persistedMeta ? persistedMeta.revision : 0;
        if (persistedRevision !== this.persistedRevision) {
          // Another tab advanced the shared revision: abort without writing.
          observedPersistedRevision = persistedRevision;
          committed = false;
          try { tx.abort(); } catch { /* already aborted */ }
          return;
        }
        committed = true;
        store.put(bytes, DB_KEY);
        store.put(
          { revision: nextRevision, lastWriterTabId: TAB_ID, updatedAt: Date.now() } as PersistedCoordinatorMeta,
          DB_META_KEY
        );
      };

      tx.oncomplete = () => resolve(true);
      tx.onabort = () => {
        if (committed) {
          reject(new Error(translateKey(dbLang, 'db.txnAbort')));
        } else {
          // CAS conflict: the persisted revision moved under our feet.
          reject(new StaleWriteError(observedPersistedRevision));
        }
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  public async persist(): Promise<void> {
    if (!this.db) return;
    this.setStorageState('persisting');
    try {
      const bytes = this.db.export();
      // `export()` may reset connection PRAGMAs.
      this.db.run('PRAGMA foreign_keys = ON;');
      await this.commitPersistedBytes(bytes);
    } catch (err: any) {
      if (err instanceof StaleWriteError) {
        // Real multi-tab conflict: mark stale with the REAL revision observed
        // in the store so `ensureFresh()` reloads the winning snapshot before
        // the next operation.
        this.remoteRevision = Math.max(this.remoteRevision, err.persistedRevision);
        this.setStorageState('stale-other-tab', err.message);
      } else {
        this.setStorageState('persistence-error', err?.message || 'Error guardando en almacenamiento persistente');
      }
      throw err;
    }
  }
  public async exportPersistedRecovery(): Promise<string | null> {
    const bytes = await this.loadFromStorage();
    if (!bytes || bytes.byteLength === 0 || typeof document === 'undefined') return null;
    const filename = `crossedarts-recovery-${new Date().toISOString().slice(0, 10)}.sqlite`;
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return filename;
  }

  public async importDatabase(bytes: Uint8Array): Promise<void> {
    if (!isValidSqliteBuffer(bytes)) {
      throw new Error(translateKey(dbLang, 'db.badFileHeader'));
    }

    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);
    let tempDb: Database | null = null;
    try {
      tempDb = new SQL.Database(bytes);
      tempDb.run('PRAGMA foreign_keys = ON;');
      const markers = tempDb.exec(`SELECT name FROM sqlite_master WHERE type='table' AND name IN ('learning_resource', 'learning_session', 'note', 'course', 'book', 'lesson')`);
      if (!markers.length || markers[0].values.length === 0) {
        throw new Error('El archivo SQLite no contiene las tablas de CrossedArts (learning_resource ausente).');
      }
      this.applyMigrationsAndCompleteSchema(tempDb);
      this.validateDatabaseSchema(tempDb);

      const persistedBytes = tempDb.export();
      tempDb.run('PRAGMA foreign_keys = ON;');

      this.setStorageState('persisting');
      await this.commitPersistedBytes(persistedBytes);

      if (this.db) {
        try { this.db.close(); } catch {}
      }
      this.db = tempDb;
      tempDb = null;
      this.isInitialized = true;
      this.initState = 'ready';
      this.setStorageState('persisted');
    } catch (err: any) {
      if (tempDb) { try { tempDb.close(); } catch {} }
      throw new Error(err?.message || 'No se pudo importar la base de datos SQLite.');
    }
  }
  /**
   * Idempotent practice-work workspace migration. Adds `content` (Markdown) and
   * `checklist` (item JSON) columns to databases from older versions, without
   * rebuilding the table or touching existing rows. No-op on current databases.
   * @returns true when the table was migrated and must persist.
   */
  private migratePracticeWorkspace(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(practice_work)');
    if (!info.length || !info[0].values.length) return false;
    const present = new Set(info[0].values.map((row) => String(row[1])));
    let migrated = false;
    if (!present.has('content')) {
      db.run('ALTER TABLE practice_work ADD COLUMN content TEXT;');
      migrated = true;
    }
    if (!present.has('checklist')) {
      db.run('ALTER TABLE practice_work ADD COLUMN checklist TEXT;');
      migrated = true;
    }
    return migrated;
  }

  /**
   * Idempotent practice-work link migration.
   *
   * Databases from older versions declared `resource_id` and `lesson_id` with
   * `ON DELETE CASCADE`: deleting a lesson or resource destroyed user work.
   * SQLite cannot alter a foreign key in place, so the table is rebuilt keeping
   * EVERY row (only when truly needed) and its indexes are recreated.
   *
   * @returns true when the table was rebuilt and must persist.
   */
  private migratePracticeWorkParentCascade(db: Database): boolean {
    const fkInfo = db.exec('PRAGMA foreign_key_list(practice_work)');
    if (!fkInfo.length || !fkInfo[0].values.length) return false;

    const hasCascadeParent = fkInfo[0].values.some((row) => {
      const referencedTable = String(row[2]);
      const onDelete = String(row[6]).toUpperCase();
      return (referencedTable === 'learning_resource' || referencedTable === 'lesson') && onDelete === 'CASCADE';
    });
    if (!hasCascadeParent) return false;

    const info = db.exec('PRAGMA table_info(practice_work)');
    const existingColumns = new Set(info[0].values.map((row) => String(row[1])));
    const targetColumns = [
      'id', 'title', 'description', 'resource_id', 'lesson_id', 'concept_id', 'kind', 'status',
      'artifact_url', 'notes', 'self_rating', 'completed_at', 'created_at', 'updated_at', 'content', 'checklist'
    ];
    const sharedColumns = targetColumns.filter((column) => existingColumns.has(column));

    // `PRAGMA foreign_keys` cannot change inside a transaction.
    db.run('PRAGMA foreign_keys = OFF;');
    try {
      db.run('BEGIN TRANSACTION;');
      db.run(buildPracticeWorkTableSql('practice_work_migrated'));
      if (sharedColumns.length) {
        const list = sharedColumns.join(', ');
        db.run(`INSERT INTO practice_work_migrated (${list}) SELECT ${list} FROM practice_work;`);
      }
      db.run('DROP TABLE practice_work;');
      db.run('ALTER TABLE practice_work_migrated RENAME TO practice_work;');
      db.run(PRACTICE_WORK_INDEX_SQL);
      db.run('COMMIT;');
    } catch (err) {
      try { db.run('ROLLBACK;'); } catch { /* already rolled back */ }
      throw err;
    } finally {
      db.run('PRAGMA foreign_keys = ON;');
    }
    return true;
  }

  private applyMigrationsAndCompleteSchema(db: Database): boolean {
    const migratedSession = this.migrateLearningSession(db);
    const migratedLesson = this.migrateLessonContent(db);
    const migratedFlashcard = this.migrateFlashcardLessonId(db);
    const migratedOcclusion = this.migrateFlashcardOcclusion(db);
    const migratedNote = this.migrateNoteLessonId(db);
    const migratedGraph = this.migrateKnowledgeConnectionIndex(db);
    const migratedPractice = this.migratePracticeWorkspace(db);
    const migratedPracticeCascade = this.migratePracticeWorkParentCascade(db);

    db.run(SCHEMA_SQL);
    db.run('CREATE INDEX IF NOT EXISTS idx_flashcard_lesson ON flashcard(lesson_id);');
    db.run(KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL);

    return (
      migratedSession ||
      migratedLesson ||
      migratedFlashcard ||
      migratedOcclusion ||
      migratedNote ||
      migratedGraph ||
      migratedPractice ||
      migratedPracticeCascade
    );
  }

  private validateDatabaseSchema(db: Database, strict = true): void {
    const requiredColumns: Record<string, string[]> = {
      learning_resource: ['id', 'title', 'description', 'cover_path', 'category', 'status', 'source_path', 'type', 'created_at', 'updated_at'],
      course: ['id', 'instructor', 'difficulty', 'total_duration_minutes', 'total_lessons', 'completed_lessons'],
      book: ['id', 'author', 'isbn', 'page_count', 'current_page', 'reading_percentage'],
      module: ['id', 'course_id', 'title', 'order_index'],
      lesson: ['id', 'module_id', 'title', 'content', 'order_index', 'duration_minutes', 'lesson_type', 'media_url', 'is_completed'],
      learning_session: ['id', 'resource_id', 'lesson_id', 'scope', 'started_at', 'ended_at', 'duration_minutes', 'inactive_seconds', 'mode', 'cards_reviewed', 'questions_answered', 'correct_answers', 'status'],
      note: ['id', 'resource_id', 'lesson_id', 'title', 'content', 'tags', 'created_at', 'updated_at'],
      flashcard: ['id', 'resource_id', 'lesson_id', 'front', 'back', 'card_type', 'extra_data', 'repetition_count', 'interval_days', 'ease_factor', 'due_date', 'last_reviewed'],
      concept: ['id', 'name', 'description'],
      knowledge_connection: ['id', 'source_id', 'target_id', 'connection_type', 'weight'],
      practice_work: ['id', 'title', 'description', 'resource_id', 'lesson_id', 'concept_id', 'kind', 'status', 'artifact_url', 'notes', 'self_rating', 'completed_at', 'created_at', 'updated_at', 'content', 'checklist'],
      learning_goal: ['id', 'title', 'description', 'kind', 'resource_id', 'target_value', 'target_date', 'status', 'completed_at', 'created_at', 'updated_at'],
      media_asset: ['id', 'mime_type', 'data', 'created_at']
    };
    for (const [table, columns] of Object.entries(requiredColumns)) {
      const info = db.exec(`PRAGMA table_info(${table})`);
      if (!info.length || !info[0].values.length) throw new Error(`Falta la tabla requerida: ${table}`);
      if (!strict) continue;
      const present = new Set(info[0].values.map(row => String(row[1])));
      const missing = columns.filter(column => !present.has(column));
      if (missing.length) throw new Error(`La tabla ${table} no contiene las columnas requeridas: ${missing.join(', ')}`);
    }
  }

  /**
   * Idempotent `lesson` table migration (Iteration 15). Adds the lesson-content
   * column (text/Markdown as data) without rebuilding the table or losing data.
   * @returns true when the table was migrated and must persist.
   */
  private migrateLessonContent(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(lesson)');
    if (!info.length || !info[0].values.length) return false;
    const hasContent = info[0].values.some((row) => String(row[1]) === 'content');
    if (hasContent) return false;
    db.run('ALTER TABLE lesson ADD COLUMN content TEXT;');
    return true;
  }

  /**
   * Idempotent flashcard lesson_id column migration. Allows optionally linking
   * study cards straight to lessons.
   * @returns true when the table was migrated and must persist.
   */
  private migrateFlashcardLessonId(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(flashcard)');
    if (!info.length || !info[0].values.length) return false;
    const hasLessonId = info[0].values.some((row) => String(row[1]) === 'lesson_id');
    let migrated = false;
    if (!hasLessonId) {
      db.run('ALTER TABLE flashcard ADD COLUMN lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL;');
      migrated = true;
    }
    db.run('CREATE INDEX IF NOT EXISTS idx_flashcard_lesson ON flashcard(lesson_id);');
    return migrated;
  }

  /**
   * Idempotent Image-Occlusion support migration on flashcard (card_type, extra_data).
   * @returns true when the table was migrated and must persist.
   */
  private migrateFlashcardOcclusion(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(flashcard)');
    if (!info.length || !info[0].values.length) return false;
    const columns = new Set(info[0].values.map((row) => String(row[1])));
    let migrated = false;
    if (!columns.has('card_type')) {
      db.run("ALTER TABLE flashcard ADD COLUMN card_type TEXT DEFAULT 'standard';");
      migrated = true;
    }
    if (!columns.has('extra_data')) {
      db.run('ALTER TABLE flashcard ADD COLUMN extra_data TEXT;');
      migrated = true;
    }
    return migrated;
  }

  /**
   * Idempotent note lesson_id column migration. Allows optionally linking notes
   * straight to lessons.
   * @returns true when the table was migrated and must persist.
   */
  private migrateNoteLessonId(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(note)');
    if (!info.length || !info[0].values.length) return false;
    const hasLessonId = info[0].values.some((row) => String(row[1]) === 'lesson_id');
    if (hasLessonId) return false;
    db.run('ALTER TABLE note ADD COLUMN lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL;');
    return true;
  }

  /**
   * Idempotent graph-connection unique-index migration. Dedupes exact triplets
   * first (keeping the oldest row by deterministic id), then creates the unique
   * index. Safe on existing data; imposes no foreign keys (endpoints stay
   * polymorphic).
   * @returns true when the index was created or something deduped.
   */
  private migrateKnowledgeConnectionIndex(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(knowledge_connection)');
    if (!info.length || !info[0].values.length) return false;

    const columns = new Set(info[0].values.map((row) => String(row[1])));
    let migrated = false;
    if (!columns.has('connection_type')) {
      db.run("ALTER TABLE knowledge_connection ADD COLUMN connection_type TEXT DEFAULT 'related_to';");
      migrated = true;
    }
    if (!columns.has('weight')) {
      db.run("ALTER TABLE knowledge_connection ADD COLUMN weight REAL DEFAULT 1.0;");
      migrated = true;
    }

    // Unique index already there? Then all three indexes predate this run.
    const existing = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_knowledge_connection_triple'");
    if (existing.length && existing[0].values.length) return migrated;

    // Deduplicate exact triplets BEFORE creating the unique index, keeping
    // deterministically the row with the smallest `id`.
    const dupes = db.exec(`
      SELECT source_id, target_id, connection_type, COUNT(*) AS c
      FROM knowledge_connection
      GROUP BY source_id, target_id, connection_type
      HAVING c > 1
    `);
    if (dupes.length) {
      for (const row of dupes[0].values) {
        const [sourceId, targetId, connectionType] = row;
        const rows = db.exec(
          'SELECT id FROM knowledge_connection WHERE source_id = ? AND target_id = ? AND connection_type = ? ORDER BY id ASC',
          [sourceId, targetId, connectionType]
        );
        if (rows.length) {
          for (let i = 1; i < rows[0].values.length; i++) {
            db.run('DELETE FROM knowledge_connection WHERE id = ?', [rows[0].values[i][0]]);
          }
        }
      }
    }

    // Endpoint indexes (speed up pruning) + unique triplet index.
    db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_connection_source ON knowledge_connection(source_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_connection_target ON knowledge_connection(target_id);');
    db.run(KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL);
    return true;
  }

  /**
   * Idempotent `learning_session` table migration.
   *
   * Extends the study session with mode, counters, status, and `scope` without
   * creating a second history system. Rebuilds the table only when the prior
   * schema is incompatible (e.g. `resource_id NOT NULL`, which blocked the
   * global scope).
   *
   * `scope` makes the three-scope domain explicit (global / resource / lesson;
   * see `services/sessionScope.ts`). Legacy rows that never declared it are
   * normalized DETERMINISTICALLY from their anchors: lesson with `lesson_id`,
   * resource with only `resource_id`, global otherwise. No existing row changes
   * meaning.
   *
   * @returns true when the table was migrated and must be persisted.
   */
  private migrateLearningSession(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(learning_session)');
    if (!info.length || !info[0].values.length) return false;

    const columns = info[0].values.map((row) => ({
      name: String(row[1]),
      notNull: Number(row[3]) === 1
    }));

    const hasMode = columns.some(c => c.name === 'mode');
    const hasLessonId = columns.some(c => c.name === 'lesson_id');
    const hasScope = columns.some(c => c.name === 'scope');
    const resourceNotNull = columns.find(c => c.name === 'resource_id')?.notNull === true;

    // Schema already current: mode + optional resource_id + lesson_id + scope.
    if (hasMode && !resourceNotNull && hasLessonId && hasScope) return false;

    // Incremental upgrade: only the explicit scope is missing. One ALTER TABLE
    // suffices (no data loss) with a deterministic backfill.
    if (hasMode && !resourceNotNull && hasLessonId && !hasScope) {
      db.run("ALTER TABLE learning_session ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';");
      this.backfillSessionScope(db);
      return true;
    }

    // Lesson column missing but the rest is compatible: add the explicit scope
    // in the same pass.
    if (hasMode && !resourceNotNull && !hasLessonId) {
      db.run('ALTER TABLE learning_session ADD COLUMN lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL;');
      db.run("ALTER TABLE learning_session ADD COLUMN scope TEXT NOT NULL DEFAULT 'global';");
      this.backfillSessionScope(db);
      return true;
    }

    db.run('PRAGMA foreign_keys = OFF;');
    db.run(`
      CREATE TABLE learning_session_migrated (
        id TEXT PRIMARY KEY,
        resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
        lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
        scope TEXT NOT NULL DEFAULT 'global'
          CHECK (scope IN ('global', 'resource', 'lesson'))
          CHECK (scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL))
          CHECK (scope <> 'resource' OR resource_id IS NOT NULL),
        started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        ended_at DATETIME,
        duration_minutes INTEGER DEFAULT 0,
        inactive_seconds INTEGER DEFAULT 0,
        mode TEXT DEFAULT 'flashcards',
        cards_reviewed INTEGER DEFAULT 0,
        questions_answered INTEGER DEFAULT 0,
        correct_answers INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed'
      );
    `);
    // Preserve the actually persisted state: when the legacy DB already recorded
    // mode, counters, or status, copy them verbatim (COALESCE only covers NULL).
    // A cancelled session is thus never rebuilt as completed. Only for a missing
    // column does the historic default apply: 'completed' keeps compatibility
    // with old databases, whose rows were finalized study records (no
    // cancellation concept).
    const legacyColumns = new Set(columns.map(c => c.name));
    const legacyExpr = (name: string, fallbackSql: string): string =>
      legacyColumns.has(name) ? `COALESCE(${name}, ${fallbackSql})` : fallbackSql;
    const modeExpr = legacyExpr('mode', "'flashcards'");
    const cardsExpr = legacyExpr('cards_reviewed', '0');
    const questionsExpr = legacyExpr('questions_answered', '0');
    const correctExpr = legacyExpr('correct_answers', '0');
    const statusExpr = legacyExpr('status', "'completed'");
    const lessonExpr = legacyColumns.has('lesson_id') ? 'lesson_id' : 'NULL';
    const startedExpr = legacyExpr('started_at', 'CURRENT_TIMESTAMP');
    const endedExpr = legacyExpr('ended_at', 'NULL');
    const durationExpr = legacyExpr('duration_minutes', '0');
    const inactiveExpr = legacyExpr('inactive_seconds', '0');
    // Scope derives from anchors: lesson beats resource, and anchorless IS the
    // global scope (explicit cross-cutting review).
    const scopeExpr = legacyColumns.has('scope')
      ? "COALESCE(scope, CASE WHEN lesson_id IS NOT NULL THEN 'lesson' WHEN resource_id IS NOT NULL THEN 'resource' ELSE 'global' END)"
      : `CASE WHEN ${lessonExpr} IS NOT NULL THEN 'lesson' WHEN resource_id IS NOT NULL THEN 'resource' ELSE 'global' END`;
    db.run(`
      INSERT INTO learning_session_migrated
        (id, resource_id, lesson_id, scope, started_at, ended_at, duration_minutes, inactive_seconds, mode, cards_reviewed, questions_answered, correct_answers, status)
      SELECT id, resource_id, ${lessonExpr}, ${scopeExpr}, ${startedExpr}, ${endedExpr}, ${durationExpr}, ${inactiveExpr},
             ${modeExpr}, ${cardsExpr}, ${questionsExpr}, ${correctExpr}, ${statusExpr}
      FROM learning_session;
    `);
    db.run('DROP TABLE learning_session;');
    db.run('ALTER TABLE learning_session_migrated RENAME TO learning_session;');
    db.run('PRAGMA foreign_keys = ON;');
    return true;
  }

  /**
   * Backfill `learning_session.scope` deterministically from present anchors.
   * Idempotent: only rewrites missing or invalid values.
   */
  private backfillSessionScope(db: Database): void {
    db.run(`
      UPDATE learning_session
      SET scope = CASE
        WHEN lesson_id IS NOT NULL THEN 'lesson'
        WHEN resource_id IS NOT NULL THEN 'resource'
        ELSE 'global'
      END
      WHERE scope IS NULL
         OR scope NOT IN ('global', 'resource', 'lesson')
         OR (scope = 'global' AND (resource_id IS NOT NULL OR lesson_id IS NOT NULL))
         OR (scope = 'resource' AND resource_id IS NULL);
    `);
  }

  public exportDatabase(): Uint8Array {
    if (!this.db) throw new DatabaseInitializationError(this.initFailure || { ...initFailureMessages().unknown, code: 'unknown' });
    const bytes = this.db.export();
    this.databaseSizeBytes = bytes.byteLength;
    // Re-assert foreign keys after export()'s implicit close/reopen.
    this.db.run('PRAGMA foreign_keys = ON;');
    return bytes;
  }

  public async resetDemo(): Promise<void> {
    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);
    if (this.db) {
      try { this.db.close(); } catch {}
    }
    this.db = new SQL.Database();
    this.db.run('PRAGMA foreign_keys = ON;');
    this.db.run(SCHEMA_SQL);
    this.db.run(SEED_SQL);
    this.db.run(KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL);
    this.isInitialized = true;
    await this.persist();
  }

  public hasIndexedDB(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  public async requestPersistentStorage(): Promise<boolean> {
    if (typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.persist === 'function') {
      try {
        const granted = await navigator.storage.persist();
        this.persistentStorageGranted = granted || await navigator.storage.persisted();
        this.setStorageState(this.storageState);
        return granted;
      } catch {
        return false;
      }
    }
    return false;
  }

  public async getStorageEstimate(): Promise<{ usage?: number; quota?: number } | null> {
    if (typeof navigator !== 'undefined' && 'storage' in navigator && typeof navigator.storage.estimate === 'function') {
      try {
        const est = await navigator.storage.estimate();
        return { usage: est.usage, quota: est.quota };
      } catch {
        return null;
      }
    }
    return null;
  }

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('CrossedArts_IDB', 1);
      req.onupgradeneeded = () => {
        const idb = req.result;
        if (!idb.objectStoreNames.contains(DB_STORE_NAME)) {
          idb.createObjectStore(DB_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async saveToStorage(bytes: Uint8Array): Promise<void> {
    // Plain write without CAS: only for boot migrations and imports, where the
    // local snapshot is already the working base.
    if (!this.hasIndexedDB()) {
      this.inMemoryBytes = bytes;
      return;
    }
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(DB_STORE_NAME, 'readwrite');
      tx.objectStore(DB_STORE_NAME).put(bytes, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async loadFromStorage(): Promise<Uint8Array | null> {
    if (!this.hasIndexedDB()) {
      return this.inMemoryBytes;
    }
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(DB_STORE_NAME, 'readonly');
      const req = tx.objectStore(DB_STORE_NAME).get(DB_KEY);
      req.onsuccess = () => {
        const res = req.result;
        if (!res) {
          resolve(null);
          return;
        }
        if (res instanceof Uint8Array) {
          resolve(res);
        } else if (res instanceof ArrayBuffer) {
          resolve(new Uint8Array(res));
        } else if (ArrayBuffer.isView(res)) {
          resolve(new Uint8Array(res.buffer, res.byteOffset, res.byteLength));
        } else {
          reject(new Error(translateKey(dbLang, 'db.badSnapshot')));
        }
      };
      req.onerror = () => reject(req.error);
    });
  }
}

export const dbBridge = new SQLiteBridge();
