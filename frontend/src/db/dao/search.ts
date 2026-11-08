/**
 * Search and Indexing: full-text search, lookup options, indexing catalogs.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type { SearchResult } from '../../types/models.ts';
import { foldForSearch } from '../../services/domainLogic.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import { goalKindLabel } from '../../services/goals.ts';

export const searchDao = {
  async getLessonIndex(): Promise<Array<{
    lessonId: string;
    lessonTitle: string;
    lessonContent?: string;
    durationMinutes: number;
    moduleTitle: string;
    courseId: string;
    courseTitle: string;
  }>> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT l.id, l.title, l.content, l.duration_minutes,
             m.title AS module_title, m.course_id,
             r.title AS course_title
      FROM lesson l
      JOIN module m ON l.module_id = m.id
      JOIN course c ON m.course_id = c.id
      JOIN learning_resource r ON r.id = c.id
      ORDER BY m.order_index ASC, m.id ASC, l.order_index ASC, l.id ASC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      lessonId: String(row[0]),
      lessonTitle: String(row[1]),
      lessonContent: row[2] ? String(row[2]) : undefined,
      durationMinutes: Number(row[3]) || 0,
      moduleTitle: String(row[4]),
      courseId: String(row[5]),
      courseTitle: String(row[6])
    }));
  },
  async getConceptIndex(): Promise<Array<{ conceptId: string; conceptName: string; conceptDescription?: string }>> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, name, description FROM concept ORDER BY name ASC, id ASC');
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      conceptId: String(row[0]),
      conceptName: String(row[1]),
      conceptDescription: row[2] ? String(row[2]) : undefined
    }));
  },
  async getResourceIndex(): Promise<Array<{
    resourceId: string;
    resourceTitle: string;
    resourceDescription?: string;
    resourceCategory?: string;
    resourceType: string;
  }>> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT id, title, description, category, type
      FROM learning_resource
      WHERE type NOT IN ('course', 'book')
      ORDER BY title ASC, id ASC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      resourceId: String(row[0]),
      resourceTitle: String(row[1]),
      resourceDescription: row[2] ? String(row[2]) : undefined,
      resourceCategory: row[3] ? String(row[3]) : undefined,
      resourceType: String(row[4])
    }));
  },
  async searchKnowledge(query: string, limit: number = 25): Promise<SearchResult[]> {
    const folded = foldForSearch((query || '').trim());
    if (folded.length < 2) return [];
    const db = dbBridge.getDatabase();
    const results: SearchResult[] = [];

    // Matching runs in JS over the same fold as the query: SQLite's `lower()`
    // only folds ASCII, so «Ética aplicada» was invisible to a search for
    // «ética». Those `LIKE '%…%'` scans were unindexable anyway — every row of
    // the table already crossed the filter — they just now cross it here.
    const hit = (value: unknown): boolean =>
      foldForSearch(value === null || value === undefined ? '' : String(value)).includes(folded);

    const resRes = db.exec(`SELECT id, title, description, category, type FROM learning_resource`);
    if (resRes.length) {
      for (const r of resRes[0].values) {
        if (!(hit(r[1]) || hit(r[2]) || hit(r[3]))) continue;
        const type = String(r[4]);
        results.push({
          id: String(r[0]),
          type: type === 'course' ? 'course' : type === 'book' ? 'book' : 'resource',
          title: String(r[1]),
          subtitle: r[3] ? String(r[3]) : (r[2] ? String(r[2]) : undefined),
          resourceId: String(r[0])
        });
      }
    }

    const lesRes = db.exec(
      `SELECT l.id, l.title, m.course_id, r.title, m.title
       FROM lesson l JOIN module m ON l.module_id = m.id JOIN learning_resource r ON m.course_id = r.id`
    );
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        if (!hit(r[1])) continue;
        results.push({ id: String(r[0]), type: 'lesson', title: String(r[1]), subtitle: `${r[3]} › ${r[4]}`, resourceId: String(r[2]), lessonId: String(r[0]) });
      }
    }

    const noteRes = db.exec(`SELECT id, title, content, resource_id, lesson_id FROM note`);
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        if (!(hit(r[1]) || hit(r[2]))) continue;
        results.push({ id: String(r[0]), type: 'note', title: String(r[1]), subtitle: String(r[2]).slice(0, 80), resourceId: r[3] ? String(r[3]) : undefined, lessonId: r[4] ? String(r[4]) : undefined });
      }
    }

    const conceptRes = db.exec(`SELECT id, name, description FROM concept`);
    if (conceptRes.length) {
      for (const r of conceptRes[0].values) {
        if (!(hit(r[1]) || hit(r[2]))) continue;
        results.push({ id: String(r[0]), type: 'concept', title: String(r[1]), subtitle: r[2] ? String(r[2]) : undefined });
      }
    }

    // Practice work is user learning evidence: if global search missed it, an
    // artifact visible in the panel and graph would be unreachable from search.
    const practiceRes = db.exec(`SELECT id, title, description, resource_id, lesson_id FROM practice_work`);
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        if (!(hit(r[1]) || hit(r[2]))) continue;
        results.push({
          id: String(r[0]),
          type: 'practice',
          title: String(r[1]),
          subtitle: r[2] ? String(r[2]).slice(0, 80) : translateKey(daoLang(), 'gallery.kind.practice'),
          resourceId: r[3] ? String(r[3]) : undefined,
          lessonId: r[4] ? String(r[4]) : undefined
        });
      }
    }

    // Learning goals are personal planning: if global search missed them, they
    // would be unreachable from the Library.
    const goalRes = db.exec(`SELECT id, title, description, kind, status FROM learning_goal`);
    if (goalRes.length) {
      for (const r of goalRes[0].values) {
        if (!(hit(r[1]) || hit(r[2]))) continue;
        const rawKind = String(r[3]);
        const kindLabel = goalKindLabel(((['course', 'book', 'practice', 'study_time', 'custom'] as readonly string[]).includes(rawKind) ? rawKind : 'custom') as 'course' | 'book' | 'practice' | 'study_time' | 'custom', daoLang());
        results.push({
          id: String(r[0]),
          type: 'goal',
          title: String(r[1]),
          subtitle: `${kindLabel} · ${String(r[4]) === 'completed' ? translateKey(daoLang(), 'goals.deadline.completed') : translateKey(daoLang(), 'palette.goalActive')}${r[2] ? ` · ${String(r[2]).slice(0, 60)}` : ''}`
        });
      }
    }

    // Deterministic order: title ascending, id ascending.
    results.sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
    return results.slice(0, Math.max(1, limit));
  },
  async getLessonOptions(): Promise<Array<{ id: string; title: string; courseTitle: string; moduleTitle: string }>> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT l.id, l.title, r.title, m.title
      FROM lesson l
      JOIN module m ON l.module_id = m.id
      JOIN learning_resource r ON m.course_id = r.id
      ORDER BY r.title ASC, m.order_index ASC, l.order_index ASC
    `);
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({ id: String(r[0]), title: String(r[1]), courseTitle: String(r[2]), moduleTitle: String(r[3]) }));
  }
};
