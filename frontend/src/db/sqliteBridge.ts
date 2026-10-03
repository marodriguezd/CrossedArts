import initSqlJs from 'sql.js';
import type { Database } from 'sql.js';
import { SCHEMA_SQL, KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL } from './schema.ts';
import { SEED_SQL } from './seedDemo.ts';
import { resolveSqliteWasmUrl, deployedSqliteWasmFilename } from './sqliteWasmUrl.ts';

const DB_STORE_NAME = 'crossedarts_sqlite_store';
const DB_KEY = 'current_database_bytes';

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
 * Ciclo de vida terminal de la inicialización de SQLite. `failed` es un estado
 * real y observable: la aplicación no debe montar sus vistas contra una base de
 * datos ausente (eso era lo que hacía el grafo de conocimiento mostrar
 * "Database not initialized" en la aplicación ya renderizada).
 */
export type InitState = 'idle' | 'initializing' | 'ready' | 'failed';

/** Clases de fallo de inicialización conocidas, con texto controlado en español. */
export type DbInitFailureCode =
  | 'wasm-unavailable'
  | 'storage-unavailable'
  | 'corrupt-storage'
  | 'schema-invalid'
  | 'stale-other-tab'
  | 'unknown';

export interface DbInitFailure {
  code: DbInitFailureCode;
  /** Mensaje en español apto para mostrar al usuario. Nunca texto interno en inglés. */
  message: string;
  /** Si es cierto, reintentar tiene sentido. Nunca implicar borrado de datos. */
  retryable: boolean;
  /** Detalle técnico solo para la consola del desarrollador. */
  detail?: string;
}

/**
 * Error de inicialización portador de un mensaje controlado en español. Evita que
 * las vistas hijas muestren nunca el texto crudo de una excepción interna.
 */
export class DatabaseInitializationError extends Error {
  public readonly failure: DbInitFailure;
  constructor(failure: DbInitFailure) {
    super(failure.message);
    this.name = 'DatabaseInitializationError';
    this.failure = failure;
  }
}

const INIT_FAILURE_MESSAGES: Record<DbInitFailureCode, { message: string; retryable: boolean }> = {
  'wasm-unavailable': {
    message: 'No se pudo cargar el motor SQLite en WebAssembly. Comprueba tu conexión y vuelve a cargar la aplicación.',
    retryable: true
  },
  'storage-unavailable': {
    message: 'No se pudo acceder al almacenamiento local del navegador, así que la base de datos no se ha podido abrir. Puede ocurrir en ventanas privadas o si el almacenamiento está bloqueado.',
    retryable: true
  },
  'corrupt-storage': {
    message: 'La base de datos local guardada no se puede abrir de forma segura. Tus datos persistidos se han conservado intactos; restaura una copia compatible antes de continuar.',
    retryable: false
  },
  'schema-invalid': {
    message: 'El esquema de la base de datos local no es válido, por lo que la aplicación no puede funcionar.',
    retryable: false
  },
  'stale-other-tab': {
    message: 'Otra pestaña de CrossedArts ha actualizado tus datos. Recarga esta pestaña antes de continuar.',
    retryable: true
  },
  unknown: {
    message: 'No se pudo inicializar la base de datos local. Vuelve a cargar la aplicación; si el problema continúa, revisa el espacio disponible en tu navegador.',
    retryable: true
  }
};

function classifyInitError(err: unknown): DbInitFailure {
  const detail = err instanceof Error ? err.message : String(err);
  const lower = detail.toLowerCase();
  let code: DbInitFailureCode = 'unknown';
  if (lower.includes('wasm') || lower.includes('fetch') || lower.includes('network') || lower.includes('locatefile')) {
    code = 'wasm-unavailable';
  } else if (lower.includes('indexeddb') || lower.includes('idb')) {
    code = 'storage-unavailable';
  } else if (lower.includes('sqlite') || lower.includes('corrupt') || lower.includes('malformed')) {
    code = 'corrupt-storage';
  } else if (lower.includes('schema') || lower.includes('table') || lower.includes('no such column')) {
    code = 'schema-invalid';
  }
  return { ...INIT_FAILURE_MESSAGES[code], code, detail };
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

/** Identificador único de esta pestaña, para ignorar nuestros propios mensajes. */
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
   * Promesa de inicialización compartida. Mientras exista, TODOS los llamantes
   * reciben exactamente la misma operación: sin secuencias `init()` paralelas que
   * compitan por escribir `this.db`.
   */
  private initPromise: Promise<Database> | null = null;
  private initState: InitState = 'idle';
  private initFailure: DbInitFailure | null = null;
  /**
   * Revisión monótona de la versión persistida. Se incrementa en cada `persist()`
   * y viaja en el mensaje de coordinación para que otra pestaña pueda detectar que
   * su estado en memoria puede estar obsoleto sin resolver conflictos.
   */
  private persistedRevision = 0;
  private lastSeenRevision = 0;
  /** Segunda revisión más alta observada en el canal: nuestra versión local es antigua. */
  private remoteRevision = 0;
  private reloadPromise: Promise<void> | null = null;
  /**
   * Tamaño cacheado del último export. Evita llamar a `db.export()` (que cierra y
   * reabre la conexión SQLite y restablece PRAGMAs como `foreign_keys`) solo para
   * informar del tamaño en cada notificación de estado.
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
            // Ignoramos nuestros propios mensajes y cualquier revisión que ya
            // tengamos incorporada: así no Entramos en un bucle de recarga.
            if (event.data.origin === TAB_ID) return;
            this.lastSeenRevision = Math.max(this.lastSeenRevision, revision);
            if (revision > this.persistedRevision) {
              // Otra pestaña persistió una versión más nueva que la nuestra: nuestro
              // estado en memoria puede estar obsoleto. No se resuelve ningún
              // conflicto aquí; solo se marca para recargar ANTES de la siguiente
              // operación de datos (ver `ensureFresh`).
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
    // En el navegador resolvemos el WASM contra la base REAL del documento
    // desplegado (`document.baseURI`), no contra una ruta relativa al bundle.
    // Así, en GitHub Pages bajo `/CrossedArts/`, la petición es
    // `https://.../CrossedArts/sql-wasm.wasm` sin codificar el nombre del
    // repositorio y sigue siendo portable a cualquier base estática.
    //
    // Además normalizamos el nombre al fichero que realmente desplegamos: Vite
    // resuelve `sql.js` por su condición `browser`, cuya build pide
    // `sql-wasm-browser.wasm` (inexistente en `public/`). Ambos binarios son
    // idénticos, así que apuntar a `sql-wasm.wasm` es correcto y determinista.
    let initOptions: any = {
      locateFile: (file: string) =>
        resolveSqliteWasmUrl(deployedSqliteWasmFilename(file), document.baseURI)
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

  /**
   * Inicializa SQLite de forma CONCURRENCY-SAFE.
   *
   * Antes, cada llamada ejecutaba su propia secuencia completa (`initSqlJs`,
   * `loadFromStorage`, migraciones, `persist`) porque la comprobación
   * `if (this.db && this.isInitialized)` solo es válida si no hay `await`
   * entre la comprobación y la asignación. Con varias llamadas solapadas
   * (React StrictMode monta-desmonta-monta el efecto de `useAppData`, y las
   * vistas perezosas como KnowledgeGraph piden datos por su cuenta), dos
   * secuencias competían por escribir `this.db`: una podía sobrescribir a la
   * otra y `getDatabase()` lanzaba "Database not initialized" aunque el resto
   * de la aplicación ya estuviera renderizada.
   *
   * Ahora la inicialización es una única promesa compartida: el primer llamante
   * la crea, el resto la espera. Además hay estados terminales explícitos
   * (`ready` / `failed`) para que la UI pueda distinguir "inicializando" de
   * "falló" y mostrar un error en español controlado en lugar del texto crudo
   * de una excepción interna.
   */
  public async init(): Promise<Database> {
    if (this.db && this.isInitialized) return this.db;

    // Un inicializador en curso se comparte; nunca se duplica.
    if (!this.initPromise) {
      this.initPromise = this.runInit().finally(() => {
        // Se libera el slot solo si esta sigue siendo la promesa actual: un
        // reintento explícito crea una promesa nueva y no debe ser pisada.
        this.initPromise = null;
      });
    }
    return this.initPromise;
  }

  /** Ejecuta la secuencia real de inicialización (una sola vez por intento). */
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
        // El WASM es un recurso crítico: si no carga, la inicialización falla de
        // forma terminal y controlada, no se renderiza la aplicación a medias.
        throw new DatabaseInitializationError(classifyInitError(err));
      }

      let savedBytes: Uint8Array | null = null;
      try {
        savedBytes = await this.loadFromStorage();
      } catch (err: any) {
        // Sin IndexedDB seguimos pudiendo trabajar en memoria: no es un fallo
        // terminal, se informa del estado y se continúa.
        this.setStorageState('storage-unavailable', err?.message || 'IndexedDB no disponible');
      }

      if (savedBytes && savedBytes.length > 0) {
        if (!isValidSqliteBuffer(savedBytes)) {
          this.setStorageState('corrupt-storage', 'Los datos guardados en IndexedDB no contienen una base de datos SQLite válida.');
          throw new DatabaseInitializationError({
            ...INIT_FAILURE_MESSAGES['corrupt-storage'],
            code: 'corrupt-storage',
            detail: 'Los bytes persistidos no tienen una cabecera SQLite válida.'
          });
        }

        let migrated = false;
        try {
          this.db = new SQL.Database(savedBytes);
          this.db.run('PRAGMA foreign_keys = ON;');
          this.validateDatabaseSchema(this.db, false);
          // Migraciones idempotentes para bases de datos existentes
          const migratedSession = this.migrateLearningSession(this.db);
          const migratedLesson = this.migrateLessonContent(this.db);
          const migratedGraph = this.migrateKnowledgeConnectionIndex(this.db);
          migrated = migratedSession || migratedLesson || migratedGraph;
          this.validateDatabaseSchema(this.db);
        } catch (e: any) {
          try { this.db?.close(); } catch { /* cierre defensivo */ }
          this.db = null;
          this.setStorageState('corrupt-storage', e?.message || 'La base de datos guardada no es compatible.');
          throw new DatabaseInitializationError({
            ...INIT_FAILURE_MESSAGES['corrupt-storage'],
            code: 'corrupt-storage',
            detail: e?.message || String(e)
          });
        }
        if (this.db) {
          this.isInitialized = true;
          this.initState = 'ready';
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
        this.isInitialized = true;
        this.initState = 'ready';
        this.setStorageState('ready');
        // Si no hay IndexedDB, `persist()` degrada a `inMemoryBytes` sin lanzar.
        await this.persist();
      }

      return this.db!;
    } catch (err) {
      // Estado terminal de fallo. La aplicación no debe montar sus vistas.
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

  /** Estado actual del ciclo de vida de inicialización. */
  public getInitState(): InitState {
    return this.initState;
  }

  /** Detalle del último fallo de inicialización, si lo hubo. */
  public getInitFailure(): DbInitFailure | null {
    return this.initFailure;
  }

  /**
   * Permite a un hijoLazy (KnowledgeGraph) esperar la inicialización en curso en
   * lugar de asumir que la base de datos ya existe. Es seguro con StrictMode y con
   * varias llamadas simultáneas porque devuelve la misma promesa compartida.
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
   * Detecta estado obsoleto multi-pestaña y recarga desde IndexedDB ANTES de la
   * siguiente operación de datos. No resuelve conflictos ni sobrescribe con
   * información antigua: si nuestra revisión es menor que la remota, la versión
   * de IndexedDB (escrita por la otra pestaña) es la ganadora por definición.
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
    try {
      bytes = await this.loadFromStorage();
    } catch (err) {
      console.warn('[CrossedArts Storage] No se pudo releer IndexedDB tras otra pestaña:', err);
      return;
    }
    // Si no hay nada legible, mantenemos el estado actual: es preferible servir
    // datos posiblemente antiguos que perder la sesión por un fallo transitorio.
    if (!bytes || !bytes.length || !isValidSqliteBuffer(bytes)) return;
    // Nunca sobrescribimos con una revisión más antigua que la que ya tenemos.
    if (this.remoteRevision !== target) return;

    const options = await this.getSqlJsOptions();
    const SQL = await initSqlJs(options);
    const reloaded = new SQL.Database(bytes);
    reloaded.run('PRAGMA foreign_keys = ON;');
    try { this.migrateLearningSession(reloaded); } catch { /* esquema legado: se acepta tal cual */ }
    try { this.migrateLessonContent(reloaded); } catch { /* idem */ }
    try { this.migrateKnowledgeConnectionIndex(reloaded); } catch { /* idem */ }

    if (this.db) {
      try { this.db.close(); } catch { /* ya cerrado */ }
    }
    this.db = reloaded;
    this.isInitialized = true;
    this.inMemoryBytes = bytes;
    this.persistedRevision = this.remoteRevision;
    this.remoteRevision = 0;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, this.persistedRevision);
    this.setStorageState('ready');
    console.info('[CrossedArts Storage] Estado en memoria actualizado tras la escritura de otra pestaña.');
  }

  /**
   * Acceso síncrono a la base de datos.
   *
   * Antes lanzaba el texto crudo en inglés "Database not initialized", que se
   * escapaba a la interfaz (el grafo de conocimiento lo pintaba tal cual).
   * Ahora distingue los dos casos reales y ambos mensajes son de clase conocida,
   * en español y con una vía de recuperación accionable.
   */
  public getDatabase(): Database {
    if (this.remoteRevision > this.persistedRevision) {
      throw new DatabaseInitializationError({
        ...INIT_FAILURE_MESSAGES['stale-other-tab'],
        code: 'stale-other-tab',
        detail: 'La pestaña actual está por detrás de una revisión persistida más reciente.'
      });
    }
    if (!this.db) {
      if (this.initState === 'failed' || this.initFailure) {
        throw new DatabaseInitializationError(
          this.initFailure || {
            ...INIT_FAILURE_MESSAGES.unknown,
            code: 'unknown'
          }
        );
      }
      throw new DatabaseInitializationError({
        ...INIT_FAILURE_MESSAGES['storage-unavailable'],
        code: 'storage-unavailable',
        detail: 'getDatabase() llamado antes de que la inicialización terminara.'
      });
    }
    return this.db;
  }

  private async commitPersistedBytes(bytes: Uint8Array): Promise<void> {
    const nextRevision = this.persistedRevision + 1;
    await this.saveToStorage(bytes);
    this.inMemoryBytes = bytes;
    this.databaseSizeBytes = bytes.byteLength;
    this.persistedRevision = nextRevision;
    this.lastSeenRevision = Math.max(this.lastSeenRevision, nextRevision);
    this.setStorageState('persisted');

    if (this.broadcastChannel) {
      try {
        this.broadcastChannel.postMessage({
          type: 'DATABASE_MUTATED_ANOTHER_TAB',
          revision: nextRevision,
          origin: TAB_ID,
          timestamp: Date.now()
        });
      } catch {}
    }
  }

  public async persist(): Promise<void> {
    if (!this.db) return;
    this.setStorageState('persisting');
    try {
      const bytes = this.db.export();
      // `export()` puede restablecer PRAGMAs de conexión.
      this.db.run('PRAGMA foreign_keys = ON;');
      await this.commitPersistedBytes(bytes);
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
    let tempDb: Database | null = null;
    try {
      tempDb = new SQL.Database(bytes);
      tempDb.run('PRAGMA foreign_keys = ON;');
      this.validateDatabaseSchema(tempDb, false);
      this.migrateLearningSession(tempDb);
      this.migrateLessonContent(tempDb);
      this.migrateKnowledgeConnectionIndex(tempDb);
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
  private validateDatabaseSchema(db: Database, strict = true): void {
    const requiredColumns: Record<string, string[]> = {
      learning_resource: ['id', 'title', 'description', 'cover_path', 'category', 'status', 'source_path', 'type', 'created_at', 'updated_at'],
      course: ['id', 'instructor', 'difficulty', 'total_duration_minutes', 'total_lessons', 'completed_lessons'],
      book: ['id', 'author', 'isbn', 'page_count', 'current_page', 'reading_percentage'],
      module: ['id', 'course_id', 'title', 'order_index'],
      lesson: ['id', 'module_id', 'title', 'content', 'order_index', 'duration_minutes', 'lesson_type', 'media_url', 'is_completed'],
      learning_session: ['id', 'resource_id', 'lesson_id', 'started_at', 'ended_at', 'duration_minutes', 'inactive_seconds', 'mode', 'cards_reviewed', 'questions_answered', 'correct_answers', 'status'],
      note: ['id', 'resource_id', 'lesson_id', 'title', 'content', 'tags', 'created_at', 'updated_at'],
      flashcard: ['id', 'resource_id', 'front', 'back', 'repetition_count', 'interval_days', 'ease_factor', 'due_date', 'last_reviewed'],
      concept: ['id', 'name', 'description'],
      knowledge_connection: ['id', 'source_id', 'target_id', 'connection_type', 'weight']
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
    if (!this.db) throw new DatabaseInitializationError(this.initFailure || { ...INIT_FAILURE_MESSAGES.unknown, code: 'unknown' });
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
