/**
 * User notes.
 *
 * Domain contract (mirrors the backend): a note can be STANDALONE — SQL NULL
 * in `resource_id`/`lesson_id`, `undefined` in the mapped object
 * (`mapNoteRow`). No placeholder resources "fix" the link, and deleting the
 * resource or lesson UNLINKS the note instead of destroying it.
 *
 * `title` is part of that contract, not decoration: the schema declares it NOT
 * NULL, so it is DERIVED from the content when the caller gives none. A note
 * written here with only content and the same note created through the API must
 * end up with the same headline — the placeholder is the last resort for
 * content that carries no text at all, never the rule.
 */
import { dbBridge } from '../sqliteBridge.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import { mapNoteRow } from './sqlRows.ts';
import type { Note } from '../../types/models.ts';

/** Same width as the column and as the backend's `derive_note_title`. */
const TITLE_MAX_LENGTH = 255;

/**
 * First non-empty line of the content, or `fallback` when it has no text.
 *
 * Kept byte-for-byte equivalent to `derive_note_title` in
 * `backend/app/services/note.py`: the browser and the API must title the same
 * note the same way, so a change here is a change there.
 */
function deriveNoteTitle(content: string | null | undefined, fallback: string): string {
  for (const line of (content ?? '').split(/\r?\n/)) {
    const stripped = line.trim();
    if (stripped) return stripped.slice(0, TITLE_MAX_LENGTH);
  }
  return fallback;
}

export const noteDao = {
  async updateNote(id: string, fields: { title?: string; content?: string; tags?: string; resource_id?: string | null; lesson_id?: string | null }): Promise<void> {
    const db = dbBridge.getDatabase();
    // A blank title cannot be stored: the column is NOT NULL and the API rejects
    // it with 422. Derive one from the content sent along with it; when the
    // caller sent no content either, `null` leaves the stored title untouched
    // (COALESCE), which is the honest "nothing to retitle from" outcome.
    let titleParam: string | null = null;
    if (fields.title !== undefined) {
      const trimmed = fields.title.trim().slice(0, TITLE_MAX_LENGTH);
      titleParam =
        trimmed ||
        (fields.content === undefined
          ? null
          : deriveNoteTitle(fields.content, translateKey(daoLang(), 'dao.note.defaultTitle')));
    }
    db.run(
      `UPDATE note SET title = COALESCE(?, title), content = COALESCE(?, content), tags = COALESCE(?, tags),
         resource_id = CASE WHEN ? = 1 THEN ? ELSE resource_id END,
         lesson_id = CASE WHEN ? = 1 THEN ? ELSE lesson_id END,
         updated_at = datetime('now')
       WHERE id = ?`,
      [
        titleParam,
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
    return res[0].values.map(mapNoteRow);
  },
  async getNotesForLesson(lessonId: string): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      'SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE lesson_id = ? ORDER BY updated_at DESC',
      [lessonId]
    );
    if (!res.length) return [];
    return res[0].values.map(mapNoteRow);
  },
  async getNotes(): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note ORDER BY updated_at DESC');
    if (!res.length) return [];
    return res[0].values.map(mapNoteRow);
  },
  async addNote(note: Partial<Note>): Promise<void> {
    const db = dbBridge.getDatabase();
    // Random suffix: two notes born in the same millisecond must not collide on
    // the primary key (same pattern as every entity).
    const id = 'note-' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const content = note.content || '';
    // Same rule as the API: a real headline from the content, and the
    // placeholder only when the note has no usable text at all.
    const title =
      note.title?.trim().slice(0, TITLE_MAX_LENGTH) ||
      deriveNoteTitle(content, translateKey(daoLang(), 'dao.note.defaultTitle'));
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
    return mapNoteRow(res[0].values[0]);
  },
};
