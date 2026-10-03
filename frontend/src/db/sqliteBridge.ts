import initSqlJs, { Database } from 'sql.js';
import { SCHEMA_SQL } from './schema.ts';
import { SEED_SQL } from './seedDemo.ts';

const DB_STORE_NAME = 'domestik_sqlite_store';
const DB_KEY = 'current_database_bytes';

class SQLiteBridge {
  private db: Database | null = null;
  private isInitialized = false;

  public async init(): Promise<Database> {
    if (this.db && this.isInitialized) return this.db;

    const SQL = await initSqlJs({
      locateFile: (file) => `./${file}`
    });

    const savedBytes = await this.loadFromIndexedDB();
    if (savedBytes && savedBytes.length > 0) {
      try {
        this.db = new SQL.Database(savedBytes);
      } catch (e) {
        console.warn('Error cargando SQLite previo, creando nueva BD:', e);
        this.db = new SQL.Database();
        this.db.run(SCHEMA_SQL);
      }
    } else {
      this.db = new SQL.Database();
      this.db.run(SCHEMA_SQL);
      this.db.run(SEED_SQL);
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
    const bytes = this.db.export();
    await this.saveToIndexedDB(bytes);
  }

  public async importDatabase(bytes: Uint8Array): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => `./${file}`
    });
    this.db = new SQL.Database(bytes);
    this.isInitialized = true;
    await this.persist();
  }

  public exportDatabase(): Uint8Array {
    if (!this.db) throw new Error('Database not initialized');
    return this.db.export();
  }

  public async resetDemo(): Promise<void> {
    const SQL = await initSqlJs({
      locateFile: (file) => `./${file}`
    });
    this.db = new SQL.Database();
    this.db.run(SCHEMA_SQL);
    this.db.run(SEED_SQL);
    await this.persist();
  }

  private openIDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('DomestiK_IDB', 1);
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

  private async saveToIndexedDB(bytes: Uint8Array): Promise<void> {
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(DB_STORE_NAME, 'readwrite');
      tx.objectStore(DB_STORE_NAME).put(bytes, DB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  private async loadFromIndexedDB(): Promise<Uint8Array | null> {
    const idb = await this.openIDB();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(DB_STORE_NAME, 'readonly');
      const req = tx.objectStore(DB_STORE_NAME).get(DB_KEY);
      req.onsuccess = () => resolve(req.result as Uint8Array || null);
      req.onerror = () => reject(req.error);
    });
  }
}

export const dbBridge = new SQLiteBridge();
