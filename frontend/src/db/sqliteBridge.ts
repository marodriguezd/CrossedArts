import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL, KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL } from './schema.ts';
import { SEED_SQL } from './seedDemo.ts';

const DB_STORE_NAME = 'crossedarts_sqlite_store';
const DB_KEY = 'current_database_bytes';

export type StorageState =
  | 'loading'
  | 'ready'
  | 'persisting'
  | 'persisted'
  | 'persistence-error'
  | 'corrupt-storage'
  | 'storage-unavailable';

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
   * Tamaño cacheado del último export. Evita llamar a `db.export()` (que cierra y
   * reabre la conexión SQLite y restablece PRAGMAs como `foreign_keys`) solo para
   * informar del tamaño en cada notificación de estado.
   */
  private databaseSizeBytes = 0;

  constructor() {
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        this.broadcastChannel = new BroadcastChannel('crossedarts_storage_coordination');
        this.broadcastChannel.onmessage = (event) => {
          if (event.data?.type === 'DATABASE_MUTATED_ANOTHER_TAB') {
            console.info('[CrossedArts Storage] Otra pestaña modificó la base de datos.');
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
      isPersistentGranted: false,
      lastPersistedTimestamp: this.lastPersistedAt,
      lastError: this.lastError,
      databaseSizeBytes: this.databaseSizeBytes
    };
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
    let initOptions: any = {
      locateFile: (file: string) => `./${file}`
    };

    // Soporte para entornos Node.js / CLI tests sin red (0 web access)
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

  public async init(): Promise<Database> {
    if (this.db && this.isInitialized) return this.db;

    this.setStorageState('loading');
    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);

    let savedBytes: Uint8Array | null = null;
    try {
      savedBytes = await this.loadFromStorage();
    } catch (err: any) {
      this.setStorageState('storage-unavailable', err?.message || 'IndexedDB no disponible');
    }

    if (savedBytes && savedBytes.length > 0) {
      if (!isValidSqliteBuffer(savedBytes)) {
        this.setStorageState('corrupt-storage', 'Los datos guardados en IndexedDB no son un SQLite válido.');
        // Crear base de datos de respaldo en memoria sin sobreescribir inmediatamente
        this.db = new SQL.Database();
        this.db.run('PRAGMA foreign_keys = ON;');
        this.db.run(SCHEMA_SQL);
        this.isInitialized = true;
        return this.db;
      }

      let migrated = false;
      try {
        this.db = new SQL.Database(savedBytes);
        this.db.run('PRAGMA foreign_keys = ON;');
        // Migraciones idempotentes para bases de datos existentes
        const migratedSession = this.migrateLearningSession(this.db);
        const migratedLesson = this.migrateLessonContent(this.db);
        const migratedGraph = this.migrateKnowledgeConnectionIndex(this.db);
        migrated = migratedSession || migratedLesson || migratedGraph;
      } catch (e: any) {
        console.warn('Error cargando SQLite previo, creando nueva BD:', e);
        this.setStorageState('corrupt-storage', e?.message || 'Corrupción en base de datos');
        this.db = new SQL.Database();
        this.db.run('PRAGMA foreign_keys = ON;');
        this.db.run(SCHEMA_SQL);
        this.db.run(SEED_SQL);
        await this.persist();
      }
      if (this.db) {
        this.setStorageState('ready');
        if (migrated) {
          // Persistir la migración fuera del bloque de recuperación: un fallo
          // transitorio de almacenamiento no debe descartar los datos del usuario.
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
      this.setStorageState('ready');
      await this.persist();
    }

    this.isInitialized = true;
    return this.db;
  }

  public getDatabase(): Database {
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  public async persist(): Promise<void> {
    if (!this.db) return;
    this.setStorageState('persisting');
    try {
      const bytes = this.db.export();
      this.databaseSizeBytes = bytes.byteLength;
      // sql.js `export()` cierra y reabre la conexión SQLite, lo que restablece los
      // PRAGMAs de conexión a sus valores por defecto. Volvemos a activar las
      // claves foráneas para que ON DELETE CASCADE / SET NULL sigan funcionando
      // después de cada persistencia.
      this.db.run('PRAGMA foreign_keys = ON;');
      await this.saveToStorage(bytes);
      this.setStorageState('persisted');
      
      // Notificar a otras pestañas
      if (this.broadcastChannel) {
        try {
          this.broadcastChannel.postMessage({ type: 'DATABASE_MUTATED_ANOTHER_TAB', timestamp: Date.now() });
        } catch {}
      }
    } catch (err: any) {
      this.setStorageState('persistence-error', err?.message || 'Error guardando en almacenamiento persistente');
      throw err;
    }
  }

  public async importDatabase(bytes: Uint8Array): Promise<void> {
    if (!isValidSqliteBuffer(bytes)) {
      throw new Error('El archivo suministrado no contiene una cabecera SQLite válida (SQLite format 3).');
    }

    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);
    
    // Instanciar temporalmente para validar que es legible y tiene el esquema esperado
    let tempDb: Database;
    try {
      tempDb = new SQL.Database(bytes);
    } catch (err: any) {
      throw new Error(`Archivo SQLite corrupto o ilegible: ${err.message}`);
    }

    const testRes = tempDb.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='learning_resource';");
    if (!testRes.length || !testRes[0].values.length) {
      tempDb.close();
      throw new Error('El archivo SQLite no contiene las tablas de CrossedArts (tabla learning_resource ausente).');
    }
    tempDb.close();

    // Reemplazo atómico
    if (this.db) {
      try {
        this.db.close();
      } catch {}
    }

    this.db = new SQL.Database(bytes);
    this.db.run('PRAGMA foreign_keys = ON;');
    this.migrateLearningSession(this.db);
    this.migrateLessonContent(this.db);
    this.migrateKnowledgeConnectionIndex(this.db);
    this.isInitialized = true;
    await this.persist();
  }

  /**
   * Migración idempotente de la tabla `lesson` (Iteración 15).
   * Añade la columna de contenido de lección (texto/Markdown como datos) sin
   * reconstruir la tabla ni perder datos existentes.
   * @returns true si la tabla fue migrada y debe persistirse.
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
   * Migración idempotente del índice único de conexiones del grafo.
   * Deduplica primero las tripletas exactas (conservando la fila más antigua por
   * id determinista) y después crea el índice único. Es seguro sobre datos
   * existentes y no impone claves foráneas (los extremos siguen siendo
   * polimórficos).
   * @returns true si se creó el índice o se deduplicó algo.
   */
  private migrateKnowledgeConnectionIndex(db: Database): boolean {
    const info = db.exec('PRAGMA table_info(knowledge_connection)');
    if (!info.length || !info[0].values.length) return false;

    // ¿Existe ya el índice único? Si existe, los tres índices ya se crearon antes.
    const existing = db.exec("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_knowledge_connection_triple'");
    if (existing.length && existing[0].values.length) return false;

    // Deduplicar tripletas exactas ANTES de crear el índice único, conservando
    // de forma determinista la fila con el `id` menor.
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

    // Índices de extremos (aceleran el podado) + índice único de tripleta.
    db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_connection_source ON knowledge_connection(source_id);');
    db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_connection_target ON knowledge_connection(target_id);');
    db.run(KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL);
    return true;
  }

  /**
   * Migración idempotente de la tabla `learning_session`.
   * Amplía la sesión de estudio con modo, contadores y estado sin crear un segundo
   * sistema de historial. Reconstruye la tabla solo si el esquema previo la define
   * con `resource_id NOT NULL` (incompatible con sesiones globales).
   * @returns true si la tabla fue migrada y debe persistirse.
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
    const resourceNotNull = columns.find(c => c.name === 'resource_id')?.notNull === true;

    // Esquema ya al día (Iteración 12/14): modo + resource_id opcional + lesson_id.
    if (hasMode && !resourceNotNull && hasLessonId) return false;

    // Ampliación incremental: bases ya migradas en la Iteración 12 que aún no
    // registran el ámbito de lección. Un ALTER TABLE es suficiente y no pierde datos.
    if (hasMode && !resourceNotNull && !hasLessonId) {
      db.run('ALTER TABLE learning_session ADD COLUMN lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL;');
      return true;
    }

    db.run('PRAGMA foreign_keys = OFF;');
    db.run(`
      CREATE TABLE learning_session_migrated (
        id TEXT PRIMARY KEY,
        resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
        lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
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
    db.run(`
      INSERT INTO learning_session_migrated
        (id, resource_id, lesson_id, started_at, ended_at, duration_minutes, inactive_seconds, mode, cards_reviewed, questions_answered, correct_answers, status)
      SELECT id, resource_id, NULL, started_at, ended_at, duration_minutes, inactive_seconds,
             'flashcards', 0, 0, 0, 'completed'
      FROM learning_session;
    `);
    db.run('DROP TABLE learning_session;');
    db.run('ALTER TABLE learning_session_migrated RENAME TO learning_session;');
    db.run('PRAGMA foreign_keys = ON;');
    return true;
  }

  public exportDatabase(): Uint8Array {
    if (!this.db) throw new Error('Database not initialized');
    const bytes = this.db.export();
    this.databaseSizeBytes = bytes.byteLength;
    // Reafirmar claves foráneas tras el cierre/reapertura implícita de export().
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
        return await navigator.storage.persist();
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
      req.onsuccess = () => resolve((req.result as Uint8Array) || null);
      req.onerror = () => reject(req.error);
    });
  }
}

export const dbBridge = new SQLiteBridge();
