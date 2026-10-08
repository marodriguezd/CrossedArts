/**
 * Trabajo práctico: evidencia PRODUCIDA por el estudiante.
 *
 * Es una fuente de conocimiento de primera clase, no un anexo del recurso: se
 * vincula con `ON DELETE SET NULL` para que reorganizar la biblioteca nunca
 * destruya el trabajo del usuario.
 */
import { dbBridge } from '../sqliteBridge.ts';
import { serializePracticeChecklist } from '../../services/practiceWork.ts';
import { PRACTICE_WORK_ORDER_SQL, PRACTICE_WORK_COLUMNS } from './practiceWorkQueries.ts';
import { mapPracticeWorkRow } from './sqlRows.ts';
import type { PracticeWork } from '../../types/models.ts';

export const practiceWorkDao = {
  async getPracticeWorkIndex(): Promise<Array<{
    practiceId: string;
    practiceTitle: string;
    practiceDescription?: string;
    practiceKind: string;
    practiceStatus: string;
    resourceId?: string;
    lessonId?: string;
    conceptId?: string;
    contextTitle?: string;
  }>> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT pw.id, pw.title, pw.description, pw.kind, pw.status,
             pw.resource_id, pw.lesson_id, pw.concept_id,
             COALESCE(r.title, c.name, les.title) AS context_title
      FROM practice_work pw
      LEFT JOIN learning_resource r ON pw.resource_id = r.id
      LEFT JOIN concept c ON pw.concept_id = c.id
      LEFT JOIN lesson les ON pw.lesson_id = les.id
      ORDER BY pw.title ASC, pw.id ASC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      practiceId: String(row[0]),
      practiceTitle: String(row[1]),
      practiceDescription: row[2] ? String(row[2]) : undefined,
      practiceKind: String(row[3] || 'other'),
      practiceStatus: String(row[4] || 'PLANNED'),
      resourceId: row[5] ? String(row[5]) : undefined,
      lessonId: row[6] ? String(row[6]) : undefined,
      conceptId: row[7] ? String(row[7]) : undefined,
      contextTitle: row[8] ? String(row[8]) : undefined
    }));
  },
  async getPracticeWorkForResource(resourceId: string, lessonId?: string): Promise<PracticeWork[]> {
    const db = dbBridge.getDatabase();
    if (!resourceId) return [];
    const res = lessonId
      ? db.exec(
          `SELECT ${PRACTICE_WORK_COLUMNS} FROM practice_work
           WHERE resource_id = ? AND (lesson_id = ? OR lesson_id IS NULL)
           ${PRACTICE_WORK_ORDER_SQL}`,
          [resourceId, lessonId]
        )
      : db.exec(
          `SELECT ${PRACTICE_WORK_COLUMNS} FROM practice_work
           WHERE resource_id = ? ${PRACTICE_WORK_ORDER_SQL}`,
          [resourceId]
        );
    if (!res.length) return [];
    return res[0].values.map(mapPracticeWorkRow);
  },
  async getAllPracticeWork(): Promise<PracticeWork[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`SELECT ${PRACTICE_WORK_COLUMNS} FROM practice_work ${PRACTICE_WORK_ORDER_SQL}`);
    if (!res.length) return [];
    return res[0].values.map(mapPracticeWorkRow);
  },
  async getPracticeWorkById(id: string): Promise<PracticeWork | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`SELECT ${PRACTICE_WORK_COLUMNS} FROM practice_work WHERE id = ?`, [id]);
    if (!res.length || !res[0].values.length) return null;
    return mapPracticeWorkRow(res[0].values[0]);
  },
  async addPracticeWork(work: Partial<PracticeWork>): Promise<string> {
    const db = dbBridge.getDatabase();
    const id = work.id || 'pw-' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const title = (work.title || '').trim() || 'Trabajo práctico';
    db.run(
      `INSERT INTO practice_work
        (id, title, description, resource_id, lesson_id, concept_id, kind, status, artifact_url, notes, self_rating, completed_at, content, checklist)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title,
        work.description || null,
        work.resource_id || null,
        work.lesson_id || null,
        work.concept_id || null,
        work.kind || 'exercise',
        work.status || 'PLANNED',
        work.artifact_url || null,
        work.notes || null,
        typeof work.self_rating === 'number' ? work.self_rating : null,
        work.completed_at || null,
        work.content || null,
        serializePracticeChecklist(work.checklist)
      ]
    );
    await dbBridge.persist();
    return id;
  },
  async updatePracticeWork(
    id: string,
    fields: Partial<Omit<PracticeWork, 'id' | 'created_at'>>
  ): Promise<void> {
    const db = dbBridge.getDatabase();
    const allowed = [
      'title', 'description', 'resource_id', 'lesson_id', 'concept_id',
      'kind', 'status', 'artifact_url', 'notes', 'self_rating', 'completed_at',
      'content', 'checklist'
    ] as const;

    const assignments: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (key in fields) {
        assignments.push(`${key} = ?`);
        const value = (fields as any)[key];
        if (key === 'checklist') {
          // La lista de verificación se persiste como JSON; vacía o ausente → NULL.
          values.push(serializePracticeChecklist(Array.isArray(value) ? value : null));
        } else {
          values.push(value === undefined ? null : value);
        }
      }
    }
    if (assignments.length === 0) return;

    // Transición determinista: marcar DONE sella `completed_at` si no venía dado.
    if (fields.status === 'DONE' && !('completed_at' in fields)) {
      assignments.push('completed_at = COALESCE(completed_at, datetime(\'now\'))');
    } else if (fields.status && fields.status !== 'DONE') {
      assignments.push('completed_at = NULL');
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(`UPDATE practice_work SET ${assignments.join(', ')} WHERE id = ?`, values);
    await dbBridge.persist();
  },
  async deletePracticeWork(id: string): Promise<boolean> {
    const db = dbBridge.getDatabase();
    const existing = db.exec('SELECT id FROM practice_work WHERE id = ?', [id]);
    if (!existing.length || !existing[0].values.length) return false;
    db.run('DELETE FROM practice_work WHERE id = ?', [id]);
    await dbBridge.persist();
    return true;
  },
  async getPracticeWorkStats(): Promise<{
    total: number;
    done: number;
    inProgress: number;
    planned: number;
    completionPercent: number;
  }> {
    const items = await this.getAllPracticeWork();
    const done = items.filter((item) => item.status === 'DONE').length;
    const inProgress = items.filter((item) => item.status === 'IN_PROGRESS').length;
    const planned = items.filter((item) => item.status === 'PLANNED').length;
    return {
      total: items.length,
      done,
      inProgress,
      planned,
      completionPercent: items.length > 0 ? Math.round((done / items.length) * 100) : 0
    };
  },
};
