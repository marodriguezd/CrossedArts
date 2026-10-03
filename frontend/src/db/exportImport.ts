import { dbBridge } from './sqliteBridge.ts';

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
    'knowledge_connection'
  ];
}

export function generateJsonBackup(): Record<string, any[]> {
  const db = dbBridge.getDatabase();
  const tables = getDatabaseTables();
  const dump: Record<string, any[]> = {};

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

export async function importJsonBackup(data: Record<string, any[]>): Promise<void> {
  const db = dbBridge.getDatabase();
  const tables = getDatabaseTables();

  // Desactivar temporalmente foreign keys durante la restauración masiva
  db.run('PRAGMA foreign_keys = OFF;');
  
  for (const table of tables) {
    if (!data[table] || !Array.isArray(data[table])) continue;
    db.run(`DELETE FROM ${table};`);
    
    for (const row of data[table]) {
      const keys = Object.keys(row);
      if (keys.length === 0) continue;
      const cols = keys.join(', ');
      const placeholders = keys.map(() => '?').join(', ');
      const values = keys.map(k => row[k]);
      db.run(`INSERT INTO ${table} (${cols}) VALUES (${placeholders});`, values);
    }
  }

  db.run('PRAGMA foreign_keys = ON;');
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
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `crossedarts-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
