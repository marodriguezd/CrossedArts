import { dbBridge } from './sqliteBridge.ts';
import {
  resolveStudySessionScope,
  STUDY_SESSION_SCOPES,
  type StudySessionScope
} from '../services/sessionScope.ts';

/**
 * Versión del formato de respaldo JSON.
 *
 * Se introduce de forma COMPATIBLE: la clave vive bajo un objeto de metadatos
 * con nombre reservado (`__meta`), que se acepta tanto si está presente como si
 * no. Los respaldos antiguos (sin `__meta`) siguen importándose sin cambios.
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
 * Columnas reales de una tabla, leídas del esquema vivo.
 * Se usa `PRAGMA table_info` en lugar de una lista codificada para que la
 * validación nunca se desincronice del esquema ni acepte columnas inventadas.
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
  /** Mensaje en español apto para el usuario. Solo se rellena si `valid` es false. */
  error?: string;
}

/**
 * Valida un respaldo JSON COMPLETO antes de tocar la base de datos.
 *
 * Se ejecuta como una pasada previa y total: si algo falla, la base de datos
 * existente queda intacta. Esto corrige el defecto por el que la importación
 * empezaba a borrar e insertar filas y solo entonces descubría que el payload
 * era inválido, dejando datos del usuario a medias.
 *
 * Reglas:
 *  1. La raíz debe ser un objeto plano (no un array, null ni primitivo).
 *  2. Las tablas conocidas deben ser arrays cuando están presentes.
 *  3. Se rechazan las tablas de nivel superior desconocidas.
 *  4. Cada fila debe ser un objeto plano cuyas columnas existan en el esquema real.
 */
export function validateJsonBackup(data: unknown): BackupValidationResult {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, error: 'El archivo de respaldo no tiene un formato válido: se esperaba un objeto con las tablas de CrossedArts.' };
  }

  const payload = data as Record<string, unknown>;
  const db = dbBridge.getDatabase();

  // 3. Sin tablas desconocidas (compatibilidad explícita: solo `__meta`).
  const known = new Set<string>([...getDatabaseTables(), META_KEY]);
  const unknownKeys = Object.keys(payload).filter(key => !known.has(key));
  if (unknownKeys.length > 0) {
    return {
      valid: false,
      error: `El respaldo contiene tablas desconocidas (${unknownKeys.join(', ')}). Solo se admiten las tablas de CrossedArts.`
    };
  }

  // 5. Versión de formato: opcional y retrocompatible.
  const meta = payload[META_KEY];
  if (meta !== undefined) {
    if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
      return { valid: false, error: 'Los metadatos del respaldo no tienen un formato válido.' };
    }
    const version = (meta as Record<string, unknown>).version;
    if (version !== undefined && (typeof version !== 'number' || !Number.isFinite(version))) {
      return { valid: false, error: 'La versión del formato de respaldo no es válida.' };
    }
    if (typeof version === 'number' && version > JSON_BACKUP_FORMAT_VERSION) {
      return {
        valid: false,
        error: `El respaldo fue creado con una versión más moderna de CrossedArts (${version}). Actualiza la aplicación antes de restaurarlo.`
      };
    }
  }

  // 2 + 4. Cada tabla conocida debe ser un array de filas con columnas reales.
  for (const table of getDatabaseTables()) {
    const rows = payload[table];
    if (rows === undefined) continue; // tabla ausente: se conserva lo existente
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
 * Completa la fila de una sesión al restaurarla.
 *
 * Un respaldo creado antes de que existiera `learning_session.scope` no trae esa
 * columna: insertarla tal cual aplicaría el valor por defecto (`global`) sobre
 * filas que SÍ tienen recurso o lección, y la restricción de integridad del
 * esquema rechazaría la restauración completa. El ámbito se deriva aquí de las
 * anclas con la MISMA regla canónica (`services/sessionScope.ts`), de modo que un
 * respaldo antiguo se restaura íntegro y con su ámbito coherente.
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
 * Importa un respaldo JSON tras validarlo por completo.
 *
 * La validación ocurre ANTES de cualquier `DELETE`. Si la persistencia final
 * falla, la operación lanza y la UI no informa de una restauración que no se
 * guardó.
 */
export async function importJsonBackup(data: Record<string, any[]>): Promise<void> {
  const validation = validateJsonBackup(data);
  if (!validation.valid) {
    throw new Error(validation.error || 'El archivo de respaldo no es válido.');
  }

  const db = dbBridge.getDatabase();
  const tables = getDatabaseTables();

  // La restauración completa debe ser una sola transacción.
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
      throw new Error('El respaldo contiene referencias internas incompatibles y no se puede restaurar de forma segura.');
    }
    db.run('COMMIT;');
  } catch (err) {
    try { db.run('ROLLBACK;'); } catch { /* rollback defensivo */ }
    throw err;
  } finally {
    // SQLite ignora `PRAGMA foreign_keys` dentro de una transacción: la
    // reafirmación debe ejecutarse fuera, tras COMMIT o ROLLBACK, o la conexión
    // quedaría con la integridad referencial desactivada para todo lo posterior.
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

export async function importSqliteFile(file: File): Promise<void> {
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('El archivo excede el tamaño máximo permitido para respaldos locales (50 MB).');
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
 * Descarga un objeto JSON como archivo. Se usa tanto para respaldos completos
 * como para paquetes de curso; comparte el mismo patrón seguro de creación y
 * revocación del object URL (nunca se filtra el `blob:`).
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

/** Nombre de archivo estable y sin caracteres problemáticos a partir de un título. */
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