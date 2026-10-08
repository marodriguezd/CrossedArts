/**
 * Metas de aprendizaje. El progreso se DERIVA por lectura de la actividad real
 * (`learning_session`, práctica, notas); aquí solo se persiste lo que el usuario
 * define.
 */
import { dbBridge } from '../sqliteBridge.ts';
import { SqlRow } from './sqlRows.ts';
import type { GoalKind, GoalStatus, LearningGoal } from '../../types/models.ts';

export const goalDao = {
  async getGoals(): Promise<LearningGoal[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `SELECT id, title, description, kind, resource_id, target_value, target_date, status, completed_at, created_at, updated_at
       FROM learning_goal
       ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
                CASE WHEN target_date IS NULL OR target_date = '' THEN 1 ELSE 0 END,
                target_date ASC, title ASC, id ASC`
    );
    if (!res.length) return [];
    return res[0].values.map((row) => {
      const r = new SqlRow(row);
      return {
        id: r.str(0),
        title: r.str(1),
        description: r.optionalStr(2),
        kind: (r.optionalStr(3) as GoalKind) || 'custom',
        resource_id: r.optionalStr(4),
        target_value: r.optionalStr(5) === undefined ? undefined : r.num(5, Number.NaN),
        target_date: r.optionalStr(6),
        status: (r.optionalStr(7) as GoalStatus) || 'active',
        completed_at: r.optionalStr(8),
        created_at: r.optionalStr(9),
        updated_at: r.optionalStr(10)
      } satisfies LearningGoal;
    });
  },
  async getGoalById(id: string): Promise<LearningGoal | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      'SELECT id, title, description, kind, resource_id, target_value, target_date, status, completed_at, created_at, updated_at FROM learning_goal WHERE id = ?',
      [id]
    );
    if (!res.length || !res[0].values.length) return null;
    const r = new SqlRow(res[0].values[0]);
    return {
      id: r.str(0),
      title: r.str(1),
      description: r.optionalStr(2),
      kind: (r.optionalStr(3) as GoalKind) || 'custom',
      resource_id: r.optionalStr(4),
      target_value: r.optionalStr(5) === undefined ? undefined : r.num(5, Number.NaN),
      target_date: r.optionalStr(6),
      status: (r.optionalStr(7) as GoalStatus) || 'active',
      completed_at: r.optionalStr(8),
      created_at: r.optionalStr(9),
      updated_at: r.optionalStr(10)
    };
  },
  async createGoal(input: {
    title: string;
    description?: string;
    kind: GoalKind;
    resource_id?: string | null;
    target_value?: number | null;
    target_date?: string | null;
  }): Promise<string> {
    const db = dbBridge.getDatabase();
    const id = `goal_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.run(
      `INSERT INTO learning_goal (id, title, description, kind, resource_id, target_value, target_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
      [
        id,
        input.title.trim(),
        input.description?.trim() || null,
        input.kind,
        input.resource_id || null,
        typeof input.target_value === 'number' && Number.isFinite(input.target_value) ? input.target_value : null,
        input.target_date || null
      ]
    );
    try {
      await dbBridge.persist();
    } catch (err) {
      db.run('DELETE FROM learning_goal WHERE id = ?', [id]);
      throw err;
    }
    return id;
  },
  async updateGoal(
    id: string,
    fields: Partial<Pick<LearningGoal, 'title' | 'description' | 'kind' | 'resource_id' | 'target_value' | 'target_date' | 'status' | 'completed_at'>>
  ): Promise<void> {
    const db = dbBridge.getDatabase();
    const allowed = ['title', 'description', 'kind', 'resource_id', 'target_value', 'target_date', 'status', 'completed_at'] as const;
    const assignments: string[] = [];
    const values: any[] = [];
    for (const key of allowed) {
      if (key in fields) {
        assignments.push(`${key} = ?`);
        const value = (fields as any)[key];
        values.push(value === undefined ? null : value);
      }
    }
    if (assignments.length === 0) return;

    // Sellar o limpiar `completed_at` de forma coherente con el estado.
    if (fields.status === 'completed' && !('completed_at' in fields)) {
      assignments.push("completed_at = COALESCE(completed_at, datetime('now'))");
    } else if (fields.status && fields.status !== 'completed') {
      assignments.push('completed_at = NULL');
    }

    assignments.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);
    db.run(`UPDATE learning_goal SET ${assignments.join(', ')} WHERE id = ?`, values);
    await dbBridge.persist();
  },
  async deleteGoal(id: string): Promise<boolean> {
    const db = dbBridge.getDatabase();
    const existing = db.exec('SELECT id FROM learning_goal WHERE id = ?', [id]);
    if (!existing.length || !existing[0].values.length) return false;
    db.run('DELETE FROM learning_goal WHERE id = ?', [id]);
    await dbBridge.persist();
    return true;
  },
};
