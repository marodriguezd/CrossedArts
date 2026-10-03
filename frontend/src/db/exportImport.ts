import { dbBridge } from './sqliteBridge.ts';

export async function exportSqliteFile(): Promise<void> {
  const bytes = dbBridge.exportDatabase();
  const blob = new Blob([bytes], { type: 'application/x-sqlite3' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `domestik-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function importSqliteFile(file: File): Promise<void> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  await dbBridge.importDatabase(bytes);
}

export async function exportJsonBackup(): Promise<void> {
  const db = dbBridge.getDatabase();
  const tables = ['learning_resource', 'course', 'book', 'module', 'lesson', 'learning_session', 'note', 'flashcard', 'concept', 'knowledge_connection'];
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

  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `domestik-data-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
