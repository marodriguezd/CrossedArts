import { dbBridge } from './sqliteBridge.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import {
  resolveStudySessionScope,
  STUDY_SESSION_SCOPES,
  type StudySessionScope
} from '../services/sessionScope.ts';

/**
 * JSON backup format version.
 *
 * Introduced COMPATIBLY: the key lives under a reserved-name metadata object
 * (`__meta`), accepted present or absent. Old backups (no `__meta`) still import
 * unchanged.
 */
export const JSON_BACKUP_FORMAT_VERSION = 1;
const META_KEY = '__meta';

export function getDatabaseTables(): string[] {
  return [
    'learning_resource', 
    'course', 
    'book', 
    'module', 
    'lesson', 
    'learning_session', 
    'note', 
    'flashcard', 
    'concept', 
    'knowledge_connection',
    'practice_work',
    'learning_goal',
    'media_asset'
  ];
}

/**
 * A table's real columns, read from the live schema. Uses `PRAGMA table_info`
 * instead of a hardcoded list so validation never drifts from the schema or
 * accepts invented columns.
 */
function getTableColumns(db: any, table: string): Set<string> {
  const res = db.exec(`PRAGMA table_info(${table})`);
  if (!res.length || !res[0].values.length) return new Set();
  return new Set(res[0].values.map((row: any[]) => String(row[1])));
}

export function generateJsonBackup(): Record<string, any> {
  const db = dbBridge.getDatabase();
  const tables = getDatabaseTables();
  const dump: Record<string, any> = {
    [META_KEY]: {
      format: 'crossedarts-json-backup',
      version: JSON_BACKUP_FORMAT_VERSION,
      exportedAt: new Date().toISOString()
    }
  };

  for (const table of tables) {
    const res = db.exec(`SELECT * FROM ${table}`);
    if (res.length) {
      const columns = res[0].columns;
      dump[table] = res[0].values.map(vals => {
        const row: Record<string, any> = {};
        columns.forEach((col, idx) => { row[col] = vals[idx]; });
        return row;
      });
    } else {
      dump[table] = [];
    }
  }
  return dump;
}

export interface BackupValidationResult {
  valid: boolean;
  /** User-facing message in Spanish. Only set when `valid` is false. */
  error?: string;
}

/**
 * Validate a FULL JSON backup before touching the database.
 *
 * Runs as one upfront total pass: on any failure the existing database stays
 * intact. This fixes the defect where import started deleting/inserting rows and
 * only then found the payload invalid, leaving user data half-written.
 *
 * Rules:
 *  1. The root must be a plain object (no array, null, or primitive).
 *  2. Known tables must be arrays when present.
 *  3. Unknown top-level tables are rejected.
 *  4. Every row must be a plain object whose columns exist in the real schema.
 */
export function validateJsonBackup(data: unknown, lang: LanguageCode = 'es'): BackupValidationResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: translateKey(lang, 'backup.err.badFormat') };
  }

  const payload = data as Record<string, unknown>;
  const db = dbBridge.getDatabase();

  // Reject unknown tables (explicit compatibility: only __meta allowed).
  const known = new Set<string>([...getDatabaseTables(), META_KEY]);
  const unknownKeys = Object.keys(payload).filter(key => !known.has(key));
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `El respaldo contiene tablas desconocidas (${unknownKeys.join(', ')}). Solo se admiten las tablas de CrossedArts.`
    };
  }

  // Format version check (optional and backward-compatible).
  const meta = payload[META_KEY];
  if (meta !== undefined) {
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      return { valid: false, error: translateKey(lang, 'backup.err.badMeta') };
    }
    const version = (meta as Record<string, unknown>).version;
    if (version !== undefined && (typeof version !== 'number' || !Number.isFinite(version))) {
      return { valid: false, error: translateKey(lang, 'backup.err.badVersion') };
    }
    if (typeof version === 'number' && version > JSON_BACKUP_FORMAT_VERSION) {
      return {
        valid: false,
        error: `El respaldo fue creado con una versión más moderna de CrossedArts (${version}). Actualiza la aplicación antes de restaurarlo.`
      };
    }
  }

  // Every known table must be a row array with valid columns.
  for (const table of getDatabaseTables()) {
    const rows = payload[table];
    if (rows === undefined) continue; // Absent table: not an error, keep existing rows.
    if (!Array.isArray(rows)) {
      return { valid: false, error: `La tabla "${table}" del respaldo debería ser una lista de registros y no es válida.` };
    }

    const allowed = getTableColumns(db, table);
    if (allowed.size === 0) {
      return { valid: false, error: `La tabla "${table}" no existe en la base de datos actual: el respaldo no es compatible.` };
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        return { valid: false, error: `El registro ${i + 1} de la tabla "${table}" no es un objeto válido.` };
      }
      const rowKeys = Object.keys(row as Record<string, unknown>);
      const unknownColumns = rowKeys.filter(col => !allowed.has(col));
      if (unknownColumns.length > 0) {
        return {
          valid: false,
          error: `El registro ${i + 1} de la tabla "${table}" contiene columnas que no existen en el esquema actual (${unknownColumns.join(', ')}).`
        };
      }
      if (!rowKeys.includes('id') || row.id === null || row.id === undefined || row.id === '') {
        return { valid: false, error: `El registro ${i + 1} de la tabla "${table}" no contiene una clave primaria "id" válida.` };
      }
    }
  }

  return { valid: true };
}

/**
 * Complete a session row on restore.
 *
 * A backup predating `learning_session.scope` lacks that column: inserting it
 * verbatim would apply the default (`global`) onto rows that DO have a resource
 * or lesson, and the schema integrity check would reject the whole restore.
 * Scope derives here from anchors under the SAME canonical rule
 * (`services/sessionScope.ts`), so an old backup restores whole with coherent
 * scope.
 */
function normalizeRestoredRow(table: string, row: Record<string, any>): Record<string, any> {
  if (table !== 'learning_session') return row;
  const scope = row.scope;
  const isUsableScope = typeof scope === 'string' && STUDY_SESSION_SCOPES.includes(scope as StudySessionScope);
  if (isUsableScope) return row;
  return {
    ...row,
    scope: resolveStudySessionScope({ resourceId: row.resource_id, lessonId: row.lesson_id })
  };
}

/**
 * Import a JSON backup after fully validating it.
 *
 * Validation runs BEFORE any `DELETE`. When final persistence fails, the
 * operation throws and the UI never reports an unsaved restore.
 */
export async function importJsonBackup(data: Record<string, any[]>, lang: LanguageCode = 'es'): Promise<void> {
  const validation = validateJsonBackup(data, lang);
  if (!validation.valid) {
    throw new Error(validation.error || translateKey(lang, 'backup.err.invalidFile'));
  }

  const db = dbBridge.getDatabase();
  const tables = getDatabaseTables();

  // The full restore must be a single transaction.
  db.run('PRAGMA foreign_keys = OFF;');
  db.run('BEGIN TRANSACTION;');

  try {
    for (const table of tables) {
      const rows = data[table];
      if (!rows || !Array.isArray(rows)) continue;
      db.run(`DELETE FROM ${table};`);

      for (const row of rows) {
        const normalized = normalizeRestoredRow(table, row);
        const keys = Object.keys(normalized);
        if (keys.length === 0) continue;
        const cols = keys.join(', ');
        const placeholders = keys.map(() => '?').join(', ');
        const values = keys.map(k => normalized[k]);
        db.run(`INSERT INTO ${table} (${cols}) VALUES (${placeholders});`, values);
      }
    }
    const foreignKeyViolations = db.exec('PRAGMA foreign_key_check;');
    if (foreignKeyViolations.length && foreignKeyViolations[0].values.length > 0) {
      throw new Error(translateKey(lang, 'backup.err.unsafeRef'));
    }
    db.run('COMMIT;');
  } catch (err) {
    try { db.run('ROLLBACK;'); } catch { /* defensive rollback */ }
    throw err;
  } finally {
    // SQLite ignores `PRAGMA foreign_keys` inside a transaction: re-assert it
    // outside, after COMMIT or ROLLBACK, or the connection keeps referential
    // integrity off for everything after.
    db.run('PRAGMA foreign_keys = ON;');
  }
  await dbBridge.persist();
}

export async function exportSqliteFile(): Promise<string> {
  const bytes = dbBridge.exportDatabase();
  const filename = `crossedarts-backup-${new Date().toISOString().slice(0, 10)}.crossedarts.sqlite`;
  if (typeof document !== 'undefined') {
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/x-sqlite3' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  return filename;
}

export async function importSqliteFile(file: File, lang: LanguageCode = 'es'): Promise<void> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error(translateKey(lang, 'backup.err.tooBig'));
  }
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  await dbBridge.importDatabase(bytes);
}

export async function exportJsonBackup(): Promise<void> {
  const dump = generateJsonBackup();
  downloadJsonFile(dump, `crossedarts-data-${new Date().toISOString().slice(0, 10)}.json`);
}

/**
 * Downloads a JSON object as a file. Used for full backups and course
 * packages alike; shares the same safe object-URL create/revoke pattern
 * (the `blob:` URL never leaks).
 */
export function downloadJsonFile(payload: unknown, filename: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Stable filename without problematic chars, derived from a title. */
export function slugifyForFilename(title: string, fallback = 'recurso'): string {
  const slug = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || fallback;
}