/**
 * User notes.
 *
 * Domain contract (mirrors the backend): a note can be STANDALONE (null
 * `resource_id` and `lesson_id`). No placeholder resources "fix" the link, and
 * deleting the resource or lesson UNLINKS the note instead of destroying it.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type { Note } from '../../types/models.ts';

export const noteDao = {
  async updateNote(id: string, fields: { title?: string; content?: string; tags?: string; resource_id?: string | null; lesson_id?: string | null }): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      `UPDATE note SET title = COALESCE(?, title), content = COALESCE(?, content), tags = COALESCE(?, tags),
         resource_id = CASE WHEN ? = 1 THEN ? ELSE resource_id END,
         lesson_id = CASE WHEN ? = 1 THEN ? ELSE lesson_id END,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        fields.title ?? null,
        fields.content ?? null,
        fields.tags ?? null,
        fields.resource_id !== undefined ? 1 : 0,
        fields.resource_id ?? null,
        fields.lesson_id !== undefined ? 1 : 0,
        fields.lesson_id ?? null,
        id
      ]
    );
    await dbBridge.persist();
  },
  async deleteNote(id: string): Promise<boolean> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM note WHERE id = ?', [id]);
    await dbBridge.persist();
    return true;
  },
  async getNotesForResource(resourceId: string, lessonId?: string): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    // With a lesson given, scope strictly to that lesson. The old
    // `resource_id = ? OR lesson_id = ?` returned notes from OTHER lessons of
    // the same course (sharing `resource_id`), polluting the lesson workspace
    // and its progress state.
    const res = lessonId
      ? db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE lesson_id = ? ORDER BY updated_at DESC', [lessonId])
      : db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE resource_id = ? ORDER BY updated_at DESC', [resourceId]);
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0], resource_id: r[1], lesson_id: r[2], title: r[3], content: r[4], tags: r[5], created_at: r[6], updated_at: r[7]
    }));
  },
  async getNotesForLesson(lessonId: string): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      'SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE lesson_id = ? ORDER BY updated_at DESC',
      [lessonId]
    );
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0], resource_id: r[1], lesson_id: r[2], title: r[3], content: r[4], tags: r[5], created_at: r[6], updated_at: r[7]
    }));
  },
  async getNotes(): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note ORDER BY updated_at DESC');
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0],
      resource_id: r[1],
      lesson_id: r[2],
      title: r[3],
      content: r[4],
      tags: r[5],
      created_at: r[6],
      updated_at: r[7]
    }));
  },
  async addNote(note: Partial<Note>): Promise<void> {
    const db = dbBridge.getDatabase();
    // Random suffix: two notes born in the same millisecond must not collide on
    // the primary key (same pattern as every entity).
    const id = 'note-' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const title = note.title || 'Nueva Nota';
    const content = note.content || '';
    const tags = note.tags || '';
    const resourceId = note.resource_id || null;
    const lessonId = note.lesson_id || null;

    db.run(
      `INSERT INTO note (id, resource_id, lesson_id, title, content, tags)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, resourceId, lessonId, title, content, tags]
    );
    await dbBridge.persist();
  },
  async getNoteById(id: string): Promise<Note | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const r = res[0].values[0];
    return { id: String(r[0]), resource_id: r[1] ? String(r[1]) : undefined, lesson_id: r[2] ? String(r[2]) : undefined, title: String(r[3]), content: String(r[4]), tags: r[5] ? String(r[5]) : undefined, created_at: String(r[6]), updated_at: String(r[7]) };
  },
};
