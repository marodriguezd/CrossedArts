/**
 * Courses: courses, modules, lessons, course packages export/import, workspace queries.
 */
import { dbBridge } from '../sqliteBridge.ts';
import type {
  Course,
  CourseDifficulty,
  Lesson,
  LessonProgressState,
  LessonType,
  LessonWorkspace,
  Module
} from '../../types/models.ts';
import {
  asNullableNumber,
  asNullableString,
  mapCourseRow
} from './sqlRows.ts';
import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import {
  buildCoursePackage,
  detectCoursePackageConflicts,
  lessonSignature,
  moduleSignature,
  planCoursePackageImport,
  practiceWorkSignature,
  resourceSignature,
  type CoursePackage,
  type CoursePackageConflict
} from '../../services/coursePackage.ts';
import { noteDao } from './notes.ts';
import { flashcardDao } from './flashcards.ts';
import { practiceWorkDao } from './practiceWork.ts';
import { graphDao } from './graph.ts';

/**
 * Recomputes the denormalized course totals after a lesson or module change.
 *
 * Deliberately NOT part of the `courseDao` or `dao` façade: it writes without
 * persisting, and invariant §2 says every modification persists. Every internal
 * caller persists right after, so the recalculation travels with the operation
 * that caused it.
 */
async function recalculateCourseTotals(courseId: string): Promise<void> {
  const db = dbBridge.getDatabase();
  const res = db.exec(`
    SELECT COUNT(l.id), COALESCE(SUM(CASE WHEN l.is_completed = 1 THEN 1 ELSE 0 END), 0), COALESCE(SUM(l.duration_minutes), 0)
    FROM module m LEFT JOIN lesson l ON l.module_id = m.id
    WHERE m.course_id = ?
  `, [courseId]);
  const row = res.length ? res[0].values[0] : [0, 0, 0];
  db.run(
    'UPDATE course SET total_lessons = ?, completed_lessons = ?, total_duration_minutes = ? WHERE id = ?',
    [Number(row[0]) || 0, Number(row[1]) || 0, Number(row[2]) || 0, courseId]
  );
}

/**
 * Attaches modules and lessons to the given courses with exactly TWO queries,
 * whatever the number of courses.
 */
function attachCourseHierarchy(
  db: ReturnType<typeof dbBridge.getDatabase>,
  courses: Course[]
): void {
  if (!courses.length) return;
  const ids = courses.map(c => c.id);
  const placeholders = ids.map(() => '?').join(',');

  const modRes = db.exec(
    `SELECT id, course_id, title, order_index FROM module WHERE course_id IN (${placeholders}) ORDER BY order_index ASC, id ASC`,
    ids
  );
  const lesRes = db.exec(
    `SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed
     FROM lesson
     WHERE module_id IN (SELECT id FROM module WHERE course_id IN (${placeholders}))
     ORDER BY order_index ASC, id ASC`,
    ids
  );

  const lessonsByModule = new Map<string, Lesson[]>();
  if (lesRes.length) {
    for (const row of lesRes[0].values) {
      const modId = String(row[1]);
      const lesson: Lesson = {
        id: String(row[0]),
        module_id: modId,
        title: String(row[2]),
        content: row[3] ? String(row[3]) : undefined,
        order_index: Number(row[4]) || 0,
        duration_minutes: Number(row[5]) || 0,
        lesson_type: row[6] as LessonType,
        media_url: row[7] ? String(row[7]) : undefined,
        is_completed: Boolean(row[8])
      };
      const list = lessonsByModule.get(modId) || [];
      list.push(lesson);
      lessonsByModule.set(modId, list);
    }
  }

  const modulesByCourse = new Map<string, Module[]>();
  if (modRes.length) {
    for (const row of modRes[0].values) {
      const modId = String(row[0]);
      const courseId = String(row[1]);
      const mod: Module = {
        id: modId,
        course_id: courseId,
        title: String(row[2]),
        order_index: Number(row[3]) || 0,
        lessons: lessonsByModule.get(modId) || []
      };
      const list = modulesByCourse.get(courseId) || [];
      list.push(mod);
      modulesByCourse.set(courseId, list);
    }
  }

  for (const c of courses) {
    c.modules = modulesByCourse.get(c.id) || [];
  }
}

export const courseDao = {
  async getCourses(): Promise<Course[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             c.instructor, c.difficulty, c.total_duration_minutes, c.total_lessons, c.completed_lessons
      FROM learning_resource r
      JOIN course c ON r.id = c.id
      ORDER BY r.created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map(mapCourseRow);
  },
  async getCourseById(id: string): Promise<Course | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             c.instructor, c.difficulty, c.total_duration_minutes, c.total_lessons, c.completed_lessons
      FROM learning_resource r
      JOIN course c ON r.id = c.id
      WHERE r.id = ?
    `, [id]);
    if (!res.length || !res[0].values.length) return null;

    const course = mapCourseRow(res[0].values[0]);
    attachCourseHierarchy(db, [course]);
    return course;
  },
  async getCoursesWithModules(): Promise<Course[]> {
    const courses = await courseDao.getCourses();
    if (!courses.length) return [];

    const db = dbBridge.getDatabase();
    attachCourseHierarchy(db, courses);
    return courses;
  },
  async toggleLessonCompleted(lessonId: string, completed: boolean): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      'UPDATE lesson SET is_completed = ? WHERE id = ?',
      [completed ? 1 : 0, lessonId]
    );
    // Keep the course denormalized totals in sync
    const courseRes = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [lessonId]);
    if (courseRes.length && courseRes[0].values.length) {
      await recalculateCourseTotals(String(courseRes[0].values[0][0]));
    }
    await dbBridge.persist();
  },
  async toggleModuleLessonsCompleted(moduleId: string, completed: boolean): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      'UPDATE lesson SET is_completed = ? WHERE module_id = ?',
      [completed ? 1 : 0, moduleId]
    );
    const modRes = db.exec('SELECT course_id FROM module WHERE id = ?', [moduleId]);
    if (modRes.length && modRes[0].values.length) {
      await recalculateCourseTotals(String(modRes[0].values[0][0]));
    }
    await dbBridge.persist();
  },
  async createCourse(input: { title: string; description?: string; category?: string; instructor?: string; difficulty?: CourseDifficulty }): Promise<{ success: boolean; id?: string; error?: string }> {
    const title = (input.title || '').trim();
    if (title.length < 3) return { success: false, error: translateKey(daoLang(), 'dao.err.courseShort') };
    const db = dbBridge.getDatabase();
    const id = `course_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const difficulty = input.difficulty || 'BEGINNER';
    db.run(
      `INSERT INTO learning_resource (id, title, description, category, status, type) VALUES (?, ?, ?, ?, 'NOT_STARTED', 'course')`,
      [id, title, input.description || '', input.category || 'General']
    );
    db.run(
      `INSERT INTO course (id, instructor, difficulty, total_duration_minutes, total_lessons, completed_lessons) VALUES (?, ?, ?, 0, 0, 0)`,
      [id, input.instructor || '', difficulty]
    );
    await dbBridge.persist();
    return { success: true, id };
  },
  async createModule(input: { courseId: string; title: string }): Promise<{ success: boolean; id?: string; error?: string }> {
    const title = (input.title || '').trim();
    if (!input.courseId) return { success: false, error: translateKey(daoLang(), 'dao.err.needCourse') };
    if (title.length < 2) return { success: false, error: translateKey(daoLang(), 'dao.err.moduleShort') };
    const db = dbBridge.getDatabase();
    const courseExists = db.exec('SELECT 1 FROM course WHERE id = ?', [input.courseId]);
    if (!courseExists.length || !courseExists[0].values.length) return { success: false, error: translateKey(daoLang(), 'dao.err.courseGone') };
    const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orderRes = db.exec('SELECT COALESCE(MAX(order_index), 0) + 1 FROM module WHERE course_id = ?', [input.courseId]);
    const orderIndex = orderRes.length ? Number(orderRes[0].values[0][0]) : 1;
    db.run('INSERT INTO module (id, course_id, title, order_index) VALUES (?, ?, ?, ?)', [id, input.courseId, title, orderIndex]);
    await recalculateCourseTotals(input.courseId);
    await dbBridge.persist();
    return { success: true, id };
  },
  async createLesson(input: { moduleId: string; title: string; content?: string; durationMinutes?: number; lessonType?: LessonType; mediaUrl?: string }): Promise<{ success: boolean; id?: string; error?: string }> {
    const title = (input.title || '').trim();
    if (!input.moduleId) return { success: false, error: translateKey(daoLang(), 'dao.err.needModule') };
    if (title.length < 2) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonShort') };
    const db = dbBridge.getDatabase();
    const moduleRes = db.exec('SELECT course_id FROM module WHERE id = ?', [input.moduleId]);
    if (!moduleRes.length || !moduleRes[0].values.length) return { success: false, error: translateKey(daoLang(), 'dao.err.moduleGone') };
    const courseId = String(moduleRes[0].values[0][0]);
    const id = `les_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orderRes = db.exec('SELECT COALESCE(MAX(order_index), 0) + 1 FROM lesson WHERE module_id = ?', [input.moduleId]);
    const orderIndex = orderRes.length ? Number(orderRes[0].values[0][0]) : 1;
    db.run(
      `INSERT INTO lesson (id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, input.moduleId, title, input.content ?? null, orderIndex, Math.max(0, input.durationMinutes || 0), input.lessonType || 'VIDEO', input.mediaUrl || null]
    );
    await recalculateCourseTotals(courseId);
    await dbBridge.persist();
    return { success: true, id };
  },
  async getLessonById(id: string): Promise<Lesson | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed FROM lesson WHERE id = ?`,
      [id]
    );
    if (!res.length || !res[0].values.length) return null;
    const l = res[0].values[0];
    return {
      id: String(l[0]),
      module_id: String(l[1]),
      title: String(l[2]),
      content: l[3] ? String(l[3]) : undefined,
      order_index: Number(l[4]) || 0,
      duration_minutes: Number(l[5]) || 0,
      lesson_type: (l[6] as LessonType) || 'VIDEO',
      media_url: l[7] ? String(l[7]) : undefined,
      is_completed: Boolean(l[8])
    };
  },
  async updateCourse(id: string, fields: { title?: string; description?: string; category?: string; instructor?: string; difficulty?: CourseDifficulty; status?: string }): Promise<void> {
    const db = dbBridge.getDatabase();
    if (fields.title !== undefined || fields.description !== undefined || fields.category !== undefined || fields.status !== undefined) {
      db.run(
        `UPDATE learning_resource SET title = COALESCE(?, title), description = COALESCE(?, description), category = COALESCE(?, category), status = COALESCE(?, status), updated_at = datetime('now') WHERE id = ?`,
        [fields.title ?? null, fields.description ?? null, fields.category ?? null, fields.status ?? null, id]
      );
    }
    db.run(
      `UPDATE course SET instructor = COALESCE(?, instructor), difficulty = COALESCE(?, difficulty) WHERE id = ?`,
      [fields.instructor ?? null, fields.difficulty ?? null, id]
    );
    await dbBridge.persist();
  },
  async updateModule(id: string, fields: { title?: string }): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run('UPDATE module SET title = COALESCE(?, title) WHERE id = ?', [fields.title ?? null, id]);
    await dbBridge.persist();
  },
  async updateLesson(id: string, fields: { title?: string; content?: string | null; durationMinutes?: number; lessonType?: LessonType; mediaUrl?: string }): Promise<{ success: boolean; error?: string }> {
    const title = fields.title !== undefined ? (fields.title || '').trim() : undefined;
    if (title !== undefined && title.length < 2) {
      return { success: false, error: translateKey(daoLang(), 'dao.err.lessonShort') };
    }
    if (fields.durationMinutes !== undefined && (typeof fields.durationMinutes !== 'number' || fields.durationMinutes < 0)) {
      return { success: false, error: translateKey(daoLang(), 'dao.err.durationNeg') };
    }
    const db = dbBridge.getDatabase();
    db.run(
      `UPDATE lesson SET title = COALESCE(?, title),
         content = CASE WHEN ? = 1 THEN ? ELSE content END,
         duration_minutes = COALESCE(?, duration_minutes), lesson_type = COALESCE(?, lesson_type), media_url = COALESCE(?, media_url)
       WHERE id = ?`,
      [
        title ?? null,
        fields.content !== undefined ? 1 : 0,
        fields.content ?? null,
        fields.durationMinutes ?? null,
        fields.lessonType ?? null,
        fields.mediaUrl ?? null,
        id
      ]
    );
    const courseRes = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [id]);
    if (courseRes.length && courseRes[0].values.length) {
      await recalculateCourseTotals(String(courseRes[0].values[0][0]));
    }
    await dbBridge.persist();
    return { success: true };
  },
  async moveLesson(lessonId: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    const lesson = await courseDao.getLessonById(lessonId);
    if (!lesson) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonGone') };

    const res = db.exec('SELECT id, order_index FROM lesson WHERE module_id = ? ORDER BY order_index ASC, id ASC', [lesson.module_id]);
    const ordered = res.length ? res[0].values.map(r => ({ id: String(r[0]), order: Number(r[1]) || 0 })) : [];
    const index = ordered.findIndex(l => l.id === lessonId);
    if (index === -1) return { success: false, error: translateKey(daoLang(), 'dao.err.lessonNotInModule') };

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) {
      return { success: false, error: direction === 'up' ? translateKey(daoLang(), 'dao.err.lessonFirst') : translateKey(daoLang(), 'dao.err.lessonLast') };
    }

    const reordered = [...ordered];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    // Renumber to 1..N, guaranteeing no duplicate positions.
    for (let i = 0; i < reordered.length; i++) {
      db.run('UPDATE lesson SET order_index = ? WHERE id = ?', [i + 1, reordered[i].id]);
    }
    await dbBridge.persist();
    return { success: true };
  },
  async getNextLessonForCourse(courseId: string): Promise<{ lesson: Lesson; moduleTitle: string; allCompleted: boolean } | null> {
    const db = dbBridge.getDatabase();
    const modRes = db.exec('SELECT id, title, order_index FROM module WHERE course_id = ? ORDER BY order_index ASC, id ASC', [courseId]);
    if (!modRes.length) return null;

    const lessons: Array<{ lesson: Lesson; moduleTitle: string }> = [];
    for (const m of modRes[0].values) {
      const moduleId = String(m[0]);
      const moduleTitle = String(m[1]);
      const lesRes = db.exec(
        `SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed
         FROM lesson WHERE module_id = ? ORDER BY order_index ASC, id ASC`,
        [moduleId]
      );
      if (!lesRes.length) continue;
      for (const l of lesRes[0].values) {
        lessons.push({
          moduleTitle,
          lesson: {
            id: String(l[0]), module_id: String(l[1]), title: String(l[2]), content: l[3] ? String(l[3]) : undefined,
            order_index: Number(l[4]) || 0, duration_minutes: Number(l[5]) || 0, lesson_type: (l[6] as LessonType) || 'VIDEO',
            media_url: l[7] ? String(l[7]) : undefined, is_completed: Boolean(l[8])
          }
        });
      }
    }

    if (!lessons.length) return null;
    const firstIncomplete = lessons.find(item => !item.lesson.is_completed);
    if (firstIncomplete) return { lesson: firstIncomplete.lesson, moduleTitle: firstIncomplete.moduleTitle, allCompleted: false };
    const last = lessons[lessons.length - 1];
    return { lesson: last.lesson, moduleTitle: last.moduleTitle, allCompleted: true };
  },
  async getLessonWorkspace(lessonId: string): Promise<LessonWorkspace | null> {
    const lesson = await courseDao.getLessonById(lessonId);
    if (!lesson) return null;

    const db = dbBridge.getDatabase();
    const modRes = db.exec('SELECT id, title, course_id FROM module WHERE id = ?', [lesson.module_id]);
    const module = modRes.length && modRes[0].values.length
      ? { id: String(modRes[0].values[0][0]), title: String(modRes[0].values[0][1]), course_id: String(modRes[0].values[0][2]) }
      : null;

    let course: { id: string; title: string } | null = null;
    let flashcardCount = 0;
    if (module) {
      const cRes = db.exec('SELECT id, title FROM learning_resource WHERE id = ?', [module.course_id]);
      if (cRes.length && cRes[0].values.length) {
        course = { id: String(cRes[0].values[0][0]), title: String(cRes[0].values[0][1]) };
      }
      const fcRes = db.exec('SELECT COUNT(*) FROM flashcard WHERE resource_id = ?', [module.course_id]);
      flashcardCount = fcRes.length ? Number(fcRes[0].values[0][0]) || 0 : 0;
    }

    // Workspace notes must belong strictly to THIS lesson. Reusing
    // `getNotesForResource(courseId, lessonId)` would mix in notes from sibling
    // lessons sharing the `resource_id`.
    const notes = await noteDao.getNotesForLesson(lessonId);
    const flashcards = await flashcardDao.getFlashcardsForLesson(lessonId);
    const related = await graphDao.getRelatedKnowledge(lessonId);

    const resources = related.filter(r => r.type === 'resource' || r.type === 'book' || r.type === 'course' || r.type === 'lesson' || r.type === 'module');
    const concepts = related.filter(r => r.type === 'concept');
    const relatedBooks = related.filter(r => r.type === 'book');

    // "Activity" means own content, notes, cards, or user-created explicit
    // relations. Mere structural membership (sitting in a module/course) counts
    // as no progress, so no meaningless percentage is invented.
    const hasOwnContent = Boolean(lesson.content && lesson.content.trim().length > 0);
    const hasExplicitRelation = related.some(r => !r.derived);
    const hasActivity = hasOwnContent || notes.length > 0 || flashcards.length > 0 || hasExplicitRelation;
    const progress: LessonProgressState = lesson.is_completed
      ? 'COMPLETED'
      : hasActivity
        ? 'IN_PROGRESS'
        : 'NOT_STARTED';

    return {
      lesson,
      module,
      course,
      notes,
      flashcards,
      resources,
      concepts,
      relatedBooks,
      flashcardCount,
      progress
    };
  },
  async deleteModule(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    const courseRes = db.exec('SELECT course_id FROM module WHERE id = ?', [id]);
    const courseId = courseRes.length && courseRes[0].values.length ? String(courseRes[0].values[0][0]) : null;
    db.run('DELETE FROM module WHERE id = ?', [id]);
    if (courseId) await recalculateCourseTotals(courseId);
    await graphDao.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async deleteLesson(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    const courseRes = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [id]);
    const courseId = courseRes.length && courseRes[0].values.length ? String(courseRes[0].values[0][0]) : null;
    db.run('DELETE FROM lesson WHERE id = ?', [id]);
    if (courseId) await recalculateCourseTotals(courseId);
    await graphDao.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async deleteCourse(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM learning_resource WHERE id = ?', [id]);
    await graphDao.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async getCourseIdForLesson(lessonId: string): Promise<string | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [lessonId]);
    return res.length && res[0].values.length ? String(res[0].values[0][0]) : null;
  },
  async getCourseIdForModule(moduleId: string): Promise<string | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT course_id FROM module WHERE id = ?', [moduleId]);
    return res.length && res[0].values.length ? String(res[0].values[0][0]) : null;
  },
  async exportCoursePackage(resourceId: string): Promise<CoursePackage | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      'SELECT id, title, description, category, cover_path, type FROM learning_resource WHERE id = ?',
      [resourceId]
    );
    if (!res.length || !res[0].values.length) return null;
    const row = res[0].values[0];

    const resource = {
      id: String(row[0]),
      title: String(row[1]),
      description: asNullableString(row[2]),
      category: asNullableString(row[3]),
      cover_path: asNullableString(row[4]),
      type: String(row[5])
    };

    let course = null;
    let book = null;
    let modules: any[] = [];
    let lessons: any[] = [];

    if (resource.type === 'course') {
      const c = db.exec(
        'SELECT instructor, difficulty, total_duration_minutes, total_lessons FROM course WHERE id = ?',
        [resourceId]
      );
      if (c.length && c[0].values.length) {
        const r = c[0].values[0];
        course = {
          instructor: asNullableString(r[0]),
          difficulty: asNullableString(r[1]),
          total_duration_minutes: asNullableNumber(r[2]),
          total_lessons: asNullableNumber(r[3])
        };
      }

      const m = db.exec('SELECT id, title, order_index FROM module WHERE course_id = ? ORDER BY order_index', [resourceId]);
      modules = m.length
        ? m[0].values.map(r => ({ id: String(r[0]), title: String(r[1]), order_index: Number(r[2]) || 0 }))
        : [];

      if (modules.length) {
        const placeholders = modules.map(() => '?').join(',');
        const l = db.exec(
          `SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url
           FROM lesson WHERE module_id IN (${placeholders}) ORDER BY order_index`,
          modules.map(x => x.id)
        );
        lessons = l.length
          ? l[0].values.map(r => ({
              id: String(r[0]),
              module_id: String(r[1]),
              title: String(r[2]),
              content: asNullableString(r[3]),
              order_index: Number(r[4]) || 0,
              duration_minutes: Number(r[5]) || 0,
              lesson_type: String(r[6] || 'VIDEO'),
              media_url: asNullableString(r[7])
            }))
          : [];
      }
    } else if (resource.type === 'book') {
      const b = db.exec('SELECT author, isbn, page_count FROM book WHERE id = ?', [resourceId]);
      if (b.length && b[0].values.length) {
        const r = b[0].values[0];
        book = {
          author: asNullableString(r[0]),
          isbn: asNullableString(r[1]),
          page_count: asNullableNumber(r[2])
        };
      }
    }

    const work = await practiceWorkDao.getPracticeWorkForResource(resourceId);
    const practiceWork = work.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description ?? null,
      lesson_id: item.lesson_id ?? null,
      kind: item.kind,
      status: item.status,
      notes: item.notes ?? null
    }));

    return buildCoursePackage({ resource, course, book, modules, lessons, practiceWork });
  },
  async importCoursePackage(
    pkg: CoursePackage
  ): Promise<{ created: number; skipped: number; conflicts: CoursePackageConflict[] }> {
    const db = dbBridge.getDatabase();

    const allIds = [
      pkg.resource.id,
      ...(pkg.modules || []).map(m => m.id),
      ...(pkg.lessons || []).map(l => l.id),
      ...(pkg.practiceWork || []).map(w => w.id)
    ];
    if (allIds.length === 0) return { created: 0, skipped: 0, conflicts: [] };

    const placeholders = allIds.map(() => '?').join(',');
    const existing = new Set<string>();
    for (const sql of [
      `SELECT id FROM learning_resource WHERE id IN (${placeholders})`,
      `SELECT id FROM module WHERE id IN (${placeholders})`,
      `SELECT id FROM lesson WHERE id IN (${placeholders})`,
      `SELECT id FROM practice_work WHERE id IN (${placeholders})`
    ]) {
      try {
        const found = db.exec(sql, allIds);
        if (found.length) {
          for (const r of found[0].values) existing.add(String(r[0]));
        }
      } catch {
        // Missing table on an old database: schema migration will create it.
      }
    }

    const plan = planCoursePackageImport(pkg, existing);

    // Conflicts: locally existing IDs with DIFFERENT content. Import is additive
    // and local content always wins, so a conflict changes nothing written; it is
    // only reported to keep the result deterministic and visible (never a silent
    // loss).
    const localSignatures = new Map<string, string>();
    const readSignatures = (sql: string, build: (row: any[]) => string) => {
      const res = db.exec(sql, allIds);
      if (!res.length) return;
      for (const row of res[0].values) localSignatures.set(String(row[0]), build(row));
    };
    readSignatures(
      `SELECT id, title, description, category, type FROM learning_resource WHERE id IN (${placeholders})`,
      row => resourceSignature({ id: String(row[0]), title: String(row[1]), description: row[2] ?? null, category: row[3] ?? null, type: String(row[4]) })
    );
    readSignatures(
      `SELECT id, title, order_index FROM module WHERE id IN (${placeholders})`,
      row => moduleSignature({ id: String(row[0]), title: String(row[1]), order_index: Number(row[2]) || 0 })
    );
    readSignatures(
      `SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url FROM lesson WHERE id IN (${placeholders})`,
      row => lessonSignature({
        id: String(row[0]), module_id: String(row[1]), title: String(row[2]), content: row[3] ?? null,
        order_index: Number(row[4]) || 0, duration_minutes: Number(row[5]) || 0,
        lesson_type: String(row[6] ?? 'VIDEO'), media_url: row[7] ?? null
      })
    );
    readSignatures(
      `SELECT id, title, description, lesson_id, kind, notes FROM practice_work WHERE id IN (${placeholders})`,
      row => practiceWorkSignature({
        id: String(row[0]), title: String(row[1]), description: row[2] ?? null,
        lesson_id: row[3] ?? null, kind: String(row[4] ?? 'exercise'), status: '', notes: row[5] ?? null
      })
    );
    const conflicts = detectCoursePackageConflicts(pkg, localSignatures);

    if (!existing.has(pkg.resource.id)) {
      db.run(
        'INSERT INTO learning_resource (id, title, description, cover_path, category, status, type) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          pkg.resource.id,
          pkg.resource.title,
          pkg.resource.description ?? null,
          pkg.resource.cover_path ?? null,
          pkg.resource.category ?? 'General',
          'NOT_STARTED',
          pkg.resource.type
        ]
      );

      if (pkg.course) {
        db.run(
          'INSERT INTO course (id, instructor, difficulty, total_duration_minutes, total_lessons, completed_lessons) VALUES (?, ?, ?, ?, ?, 0)',
          [
            pkg.resource.id,
            pkg.course.instructor ?? null,
            pkg.course.difficulty ?? 'BEGINNER',
            pkg.course.total_duration_minutes ?? 0,
            pkg.course.total_lessons ?? (pkg.lessons || []).length
          ]
        );
      } else if (pkg.book) {
        db.run(
          'INSERT INTO book (id, author, isbn, page_count, current_page, reading_percentage) VALUES (?, ?, ?, ?, 0, 0)',
          [pkg.resource.id, pkg.book.author ?? null, pkg.book.isbn ?? null, pkg.book.page_count ?? null]
        );
      }
    }

    for (const module of pkg.modules || []) {
      if (existing.has(module.id)) continue;
      db.run('INSERT INTO module (id, course_id, title, order_index) VALUES (?, ?, ?, ?)', [
        module.id, pkg.resource.id, module.title, module.order_index ?? 0
      ]);
    }

    for (const lesson of pkg.lessons || []) {
      if (existing.has(lesson.id)) continue;
      db.run(
        'INSERT INTO lesson (id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)',
        [
          lesson.id,
          lesson.module_id,
          lesson.title,
          lesson.content ?? null,
          lesson.order_index ?? 0,
          lesson.duration_minutes ?? 0,
          lesson.lesson_type || 'VIDEO',
          lesson.media_url ?? null
        ]
      );
    }

    for (const work of pkg.practiceWork || []) {
      if (existing.has(work.id)) continue;
      db.run(
        'INSERT INTO practice_work (id, title, description, resource_id, lesson_id, kind, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          work.id,
          work.title,
          work.description ?? null,
          pkg.resource.id,
          work.lesson_id ?? null,
          work.kind || 'exercise',
          work.status || 'PLANNED',
          work.notes ?? null
        ]
      );
    }

    await dbBridge.persist();
    return { created: plan.toCreate.length, skipped: plan.existing.length, conflicts };
  }
};
