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
export const JSON_BACKUP_FORMAT_VERSION = 2;
const META_KEY = '__meta';
/** Optional section carrying the embedding cache (version 2+). */
export const EMBEDDINGS_SECTION_KEY = 'embeddings';
/**
 * Ceiling for a JSON backup, checked BEFORE `JSON.parse`.
 *
 * Parsing a multi-hundred-megabyte file in the main thread froze the tab with no
 * explanation; the import now refuses it with a clear message instead.
 */
export const JSON_BACKUP_MAX_BYTES = 50 * 1024 * 1024;

/**
 * Size (in characters) from which an export is written minified.
 *
 * Indentation inflates a media-heavy backup by ~15%; past this point the
 * readability is not worth the extra bytes. Matches the previous 20 MB probe.
 */
const LARGE_PAYLOAD_CHARS = 20 * 1024 * 1024;

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

export interface EmbeddingsBackupSection {
  format: 'crossedarts-embeddings';
  modelId: string;
  pipelineVersion: string;
  dimensions: number;
  entries: Array<{
    chunkId: string;
    contentHash: string;
    vector: number[];
    substantive?: boolean;
    resourceId?: string;
    lessonId?: string;
    sourceType?: string;
    sourceId?: string;
    title?: string;
  }>;
}

/**
 * Exports the vector cache for ONE model/pipeline.
 *
 * It is a derived cache, so it travels as an OPTIONAL section: a restore without
 * it is perfectly valid, and vectors are simply rebuilt on the next indexing
 * pass. Including it keeps a same-browser restore instant (no 300 MB model run).
 */
export async function buildEmbeddingsExport(
  modelId: string,
  pipelineVersion: string
): Promise<EmbeddingsBackupSection | null> {
  try {
    const { embeddingCache, expectedDimensionsForModel } = await import('../lib/localEmbeddings/cache.ts');
    const entries = await embeddingCache.getAllEntriesForModel(modelId, pipelineVersion);
    if (entries.length === 0) return null;
    return {
      format: 'crossedarts-embeddings',
      modelId,
      pipelineVersion,
      dimensions: expectedDimensionsForModel(modelId) ?? entries[0].vector.length,
      entries: entries.map((entry) => ({
        chunkId: entry.chunkId,
        contentHash: entry.contentHash,
        vector: entry.vector,
        substantive: entry.substantive === true,
        resourceId: entry.resourceId,
        lessonId: entry.lessonId,
        sourceType: entry.sourceType,
        // The chunk text itself is NOT exported: it is duplicated corpus, and
        // the restore only keeps a vector whose hash still matches the current
        // content anyway.
        title: entry.title
      }))
    };
  } catch {
    // A cache export must never block a backup.
    return null;
  }
}

/**
 * Dumps the canonical SQLite tables.
 *
 * Deliberately synchronous: it is the backing store of the whole app, and the
 * derived vector cache is merged only by `generateJsonBackupWithEmbeddings`.
 */
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

/**
 * Full backup: canonical tables plus the OPTIONAL vector cache section.
 *
 * A cache export failure never blocks the backup; the section is simply absent
 * and the vectors are rebuilt on the next indexing pass.
 */
export async function generateJsonBackupWithEmbeddings(
  options: { includeEmbeddings?: boolean } = {}
): Promise<Record<string, any>> {
  const dump = generateJsonBackup();
  if (options.includeEmbeddings === false) return dump;

  const { EMBEDDING_PIPELINE_VERSION } = await import('../lib/localEmbeddings/cache.ts');
  const { localEmbeddingEngine } = await import('../lib/localEmbeddings/engine.ts');
  const modelId = localEmbeddingEngine.getLoadedModelId() || (await resolveActiveEmbeddingModelId());
  const section = await buildEmbeddingsExport(modelId, EMBEDDING_PIPELINE_VERSION);
  if (section) dump[EMBEDDINGS_SECTION_KEY] = section;
  return dump;
}

/**
 * Validates the OPTIONAL embeddings section.
 *
 * Returns the usable entries and how many were dropped. An incoherent entry is
 * skipped with a warning; it never aborts the restore of the database itself.
 */
export function validateEmbeddingsSection(
  section: unknown,
  lang: LanguageCode = 'es'
): { valid: boolean; error?: string; section?: EmbeddingsBackupSection; dropped: number } {
  if (section === undefined) return { valid: true, dropped: 0 };
  if (section === null || typeof section !== 'object' || Array.isArray(section)) {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }

  const raw = section as Record<string, unknown>;
  if (raw.format !== 'crossedarts-embeddings') {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }
  if (typeof raw.modelId !== 'string' || !raw.modelId) {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }
  if (typeof raw.pipelineVersion !== 'string' || !raw.pipelineVersion) {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }
  if (typeof raw.dimensions !== 'number' || !Number.isFinite(raw.dimensions) || raw.dimensions <= 0) {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }
  if (!Array.isArray(raw.entries)) {
    return { valid: false, error: translateKey(lang, 'backup.err.badEmbeddings'), dropped: 0 };
  }

  const dimensions = raw.dimensions;
  const entries: EmbeddingsBackupSection['entries'] = [];
  let dropped = 0;

  for (const candidate of raw.entries) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      dropped += 1;
      continue;
    }
    const entry = candidate as Record<string, unknown>;
    const chunkId = entry.chunkId;
    const contentHash = entry.contentHash;
    const vector = entry.vector;

    if (typeof chunkId !== 'string' || !chunkId) { dropped += 1; continue; }
    if (typeof contentHash !== 'string' || !contentHash) { dropped += 1; continue; }
    if (!Array.isArray(vector) || vector.length !== dimensions) { dropped += 1; continue; }
    if (!vector.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      dropped += 1;
      continue;
    }

    entries.push({
      chunkId,
      contentHash,
      vector: vector as number[],
      substantive: entry.substantive === true,
      resourceId: typeof entry.resourceId === 'string' ? entry.resourceId : undefined,
      lessonId: typeof entry.lessonId === 'string' ? entry.lessonId : undefined,
      sourceType: typeof entry.sourceType === 'string' ? entry.sourceType : undefined,
      sourceId: typeof entry.sourceId === 'string' ? entry.sourceId : undefined,
      title: typeof entry.title === 'string' ? entry.title : undefined
    });
  }

  return {
    valid: true,
    dropped,
    section: {
      format: 'crossedarts-embeddings',
      modelId: raw.modelId as string,
      pipelineVersion: raw.pipelineVersion as string,
      dimensions,
      entries
    }
  };
}

/** Active embedding model for the running session, from stored preference. */
async function resolveActiveEmbeddingModelId(): Promise<string> {
  const { getStoredEmbeddingModelId } = await import('../services/embeddingModelPreference.ts');
  const { DEFAULT_EMBEDDING_MODEL_ID } = await import('../lib/localEmbeddings/registry.ts');
  return getStoredEmbeddingModelId() || DEFAULT_EMBEDDING_MODEL_ID;
}

/**
 * Restores the vector cache after the SQLite restore.
 *
 * Entries whose identity does not match the RUNNING model/pipeline are skipped:
 * a vector from another model is never served as if it belonged to the active
 * one.
 */
export async function importEmbeddingsSection(
  section: EmbeddingsBackupSection,
  active: { modelId: string; pipelineVersion: string }
): Promise<{ imported: number; skipped: number }> {
  if (section.modelId !== active.modelId || section.pipelineVersion !== active.pipelineVersion) {
    return { imported: 0, skipped: section.entries.length };
  }

  const { embeddingCache } = await import('../lib/localEmbeddings/cache.ts');

  // ONE transaction for the whole section: restoring used to commit once per
  // vector (5.000 vectors, 5.000 transactions).
  const imported = await embeddingCache.setEntries(
    section.entries.map((entry) => ({
      chunkId: entry.chunkId,
      sourceType: entry.sourceType || 'note',
      sourceId: entry.sourceId || entry.chunkId,
      title: entry.title || '',
      text: '',
      contentHash: entry.contentHash,
      modelId: section.modelId,
      pipelineVersion: section.pipelineVersion,
      dimensions: entry.vector.length,
      vector: entry.vector,
      updatedAt: Date.now(),
      substantive: entry.substantive === true,
      resourceId: entry.resourceId,
      lessonId: entry.lessonId
    }))
  );

  return { imported, skipped: section.entries.length - imported };
}

export interface BackupValidationResult {
  valid: boolean;
  /** User-facing message in Spanish. Only set when `valid` is false. */
  error?: string;
  /**
   * Already-validated embeddings section, carried out of the single validation
   * pass so the import does not walk thousands of vectors a second time.
   */
  embeddings?: { section?: EmbeddingsBackupSection; dropped: number };
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

  // 3. No unknown tables (explicit compatibility: `__meta` and, from version 2,
  // the optional `embeddings` cache section).
  const known = new Set<string>([...getDatabaseTables(), META_KEY, EMBEDDINGS_SECTION_KEY]);
  const unknownKeys = Object.keys(payload).filter(key => !known.has(key));
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `El respaldo contiene tablas desconocidas (${unknownKeys.join(', ')}). Solo se admiten las tablas de CrossedArts.`
    };
  }

  // 5. Format version: optional and backward-compatible.
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

  // 6. The optional embeddings section is validated structurally: an incoherent
  //    entry is dropped later, but a malformed SHAPE is a real error.
  const embeddingsCheck = validateEmbeddingsSection(payload[EMBEDDINGS_SECTION_KEY], lang);
  if (!embeddingsCheck.valid) {
    return { valid: false, error: embeddingsCheck.error };
  }

  // 2 + 4. Every known table must be a row array with real columns.
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

  return { valid: true, embeddings: { section: embeddingsCheck.section, dropped: embeddingsCheck.dropped } };
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
 * Exact UTF-8 byte length without building the encoded copy.
 *
 * `new TextEncoder().encode(text)` allocated a second full copy of a backup
 * that can span tens of megabytes just to compare its size against the limit.
 * A lone surrogate is counted as its replacement character's 3 bytes, which is
 * what the encoder would produce.
 */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Parses a JSON backup text with the size ceiling applied FIRST.
 *
 * Parsing an oversized file froze the tab; refusing it with a clear message is
 * the honest outcome.
 */
export function parseJsonBackupText(text: string, lang: LanguageCode = 'es'): Record<string, any[]> {
  const bytes = utf8ByteLength(text);
  if (bytes > JSON_BACKUP_MAX_BYTES) {
    throw new Error(translateKey(lang, 'backup.err.tooBig'));
  }
  try {
    return JSON.parse(text) as Record<string, any[]>;
  } catch {
    throw new Error(translateKey(lang, 'backup.err.badFormat'));
  }
}

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

  // The vector cache is DERIVED data: it is restored AFTER the canonical
  // database, and a failure here never invalidates an otherwise good restore.
  // It is filed under the RUNNING model and pipeline, never the section's own:
  // a vector produced by another model must not masquerade as the active one.
  // Reused from the validation pass above: re-validating thousands of vectors
  // here doubled the work for exactly the same answer.
  const embeddingsCheck = validation.embeddings;
  if (embeddingsCheck?.section) {
    try {
      const { EMBEDDING_PIPELINE_VERSION } = await import('../lib/localEmbeddings/cache.ts');
      const { localEmbeddingEngine } = await import('../lib/localEmbeddings/engine.ts');
      const activeModelId = localEmbeddingEngine.getLoadedModelId() || (await resolveActiveEmbeddingModelId());
      const result = await importEmbeddingsSection(embeddingsCheck.section, {
        modelId: activeModelId,
        pipelineVersion: EMBEDDING_PIPELINE_VERSION
      });
      if (embeddingsCheck.dropped > 0 || result.skipped > 0) {
        console.warn(
          `Caché de embeddings restaurada parcialmente: ${result.imported} vectores importados, ` +
          `${embeddingsCheck.dropped + result.skipped} descartados.`
        );
      }
    } catch (err) {
      console.warn('El respaldo se restauró, pero la caché de embeddings no pudo importarse:', err);
    }
  }
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

export async function exportJsonBackup(options: { includeEmbeddings?: boolean; minify?: boolean } = {}): Promise<void> {
  const dump = await generateJsonBackupWithEmbeddings(options);
  downloadJsonFile(
    dump,
    `crossedarts-data-${new Date().toISOString().slice(0, 10)}.json`,
    { pretty: options.minify !== true }
  );
}

/**
 * Downloads a JSON object as a file. Used for full backups and course
 * packages alike; shares the same safe object-URL create/revoke pattern
 * (the `blob:` URL never leaks).
 */
export function downloadJsonFile(
  payload: unknown,
  filename: string,
  options: { pretty?: boolean } = {}
): void {
  if (typeof document === 'undefined') return;
  // Indented JSON is readable but inflates a media-heavy backup by ~15%. Large
  // exports are written minified instead of paying that cost silently.
  //
  // Serialized ONCE for the normal case: a separate size probe serialized the
  // whole payload a first time and threw it away. Only an export past the
  // threshold pays for the second, minified pass.
  let text = JSON.stringify(payload, null, options.pretty === false ? 0 : 2);
  if (text.length > LARGE_PAYLOAD_CHARS) {
    text = JSON.stringify(payload, null, 0);
  }
  const blob = new Blob([text], { type: 'application/json' });
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