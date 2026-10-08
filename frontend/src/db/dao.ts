import { dbBridge } from './sqliteBridge.ts';
import type { Course, Book, LearningResource, Flashcard, FlashcardType, MediaAsset, ConceptNode, ConceptEdge, Module, Lesson, LearningSession, StudySessionMode, GraphNodeType, KnowledgeConnection, SearchResult, UnorganizedResource, CourseDifficulty, LessonType, ResourceKind, ResourceDetail, ResourceFragment, RelatedKnowledgeItem, LessonWorkspace, LessonProgressState, DailyActivityPoint, TimeRangeFilter, PracticeWork, PracticeWorkKind, PracticeWorkStatus, PracticeChecklistItem } from '../types/models.ts';
import { calculateBookProgress, calculateSM2, validateKnowledgeConnection } from '../services/domainLogic.ts';
import { GOAL_KIND_LABELS } from '../services/goals.ts';
import {
  buildCoursePackage,
  planCoursePackageImport,
  detectCoursePackageConflicts,
  resourceSignature,
  moduleSignature,
  lessonSignature,
  practiceWorkSignature,
  type CoursePackage,
  type CoursePackageConflict
} from '../services/coursePackage.ts';
import {
  resolveStudySessionScope,
  validateStudySessionScope,
  type StudySessionScope
} from '../services/sessionScope.ts';
import { asNullableString, asNullableNumber } from './dao/sqlRows.ts';
import { sessionDao } from './dao/sessions.ts';
import { noteDao } from './dao/notes.ts';
import { practiceWorkDao } from './dao/practiceWork.ts';
import { goalDao } from './dao/goals.ts';
import type { SM2Result } from '../services/domainLogic.ts';

/**
 * Fachada estable del acceso a datos local (SQLite WASM).
 *
 * La implementación se ha modularizado por dominio (`db/dao/*`): sesiones,
 * notas, trabajo práctico, metas y lectura de filas/proyecciones SQL. Este objeto
 * compone esos módulos y mantiene los métodos de recursos, cursos, lecciones,
 * flashcards, grafo, búsqueda e importación.
 *
 * Ventajas del corte: cada frontera (sesión, nota, práctica, meta) se lee y se
 * prueba de forma aislada, el SQL de cada dominio está en un solo archivo y no
 * hay dos formas de leer la misma fila. No hay cambio de comportamiento: los
 * métodos son los mismos, con el mismo SQL, y la API pública (`dao.*`) es
 * idéntica para toda la aplicación.
 */

/* La lista de verificación se parsea/serializa con los helpers puros de
 * services/practiceWork.ts: la base de datos guarda JSON y la lógica de
 * conversión vive en un módulo probable, no dentro del DAO. */

export const dao = {
  ...sessionDao,
  ...noteDao,
  ...practiceWorkDao,
  ...goalDao,
  async getDueFlashcards(resourceId?: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const base = `SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, lesson_id, card_type, extra_data
      FROM flashcard WHERE datetime(due_date) <= datetime('now')`;
    const res = resourceId
      ? db.exec(`${base} AND resource_id = ? ORDER BY datetime(due_date) ASC, id ASC`, [resourceId])
      : db.exec(`${base} ORDER BY datetime(due_date) ASC, id ASC`);
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: String(r[0]),
      resource_id: r[1] ?? undefined,
      front: String(r[2]),
      back: String(r[3]),
      repetition_count: Number(r[4]) || 0,
      interval_days: Number(r[5]) || 1,
      ease_factor: Number(r[6]) || 2.5,
      due_date: String(r[7]),
      last_reviewed: r[8] ?? undefined,
      lesson_id: r[9] ? String(r[9]) : undefined,
      card_type: (r[10] as FlashcardType) || 'standard',
      extra_data: r[11] ? String(r[11]) : undefined
    }));
  },
  async startStudySession(params: {
    mode: StudySessionMode;
    resourceId?: string;
    lessonId?: string;
    scope?: StudySessionScope;
  }): Promise<string> {
    const db = dbBridge.getDatabase();
    const anchors = { resourceId: params.resourceId, lessonId: params.lessonId };
    const scope = params.scope ?? resolveStudySessionScope(anchors);
    const consistency = validateStudySessionScope(scope, anchors);
    if (!consistency.ok) {
      throw new Error(consistency.error || 'Ámbito de sesión incoherente.');
    }

    const id = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.run(
      `INSERT INTO learning_session
        (id, resource_id, lesson_id, scope, started_at, mode, status, duration_minutes, inactive_seconds, cards_reviewed, questions_answered, correct_answers)
       VALUES (?, ?, ?, ?, datetime('now'), ?, 'active', 0, 0, 0, 0, 0)`,
      [id, params.resourceId || null, params.lessonId || null, scope, params.mode]
    );
    // Si la persistencia falla se propaga y se revierte: la UI no debe iniciar
    // una sesión fantasma que luego aparezca como activa.
    try {
      await dbBridge.persist();
    } catch (err) {
      db.run('DELETE FROM learning_session WHERE id = ?', [id]);
      throw err;
    }
    return id;
  },
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
    return res[0].values.map((row: any[]) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      cover_path: row[3],
      category: row[4],
      status: row[5],
      source_path: row[6],
      type: 'course',
      instructor: row[8],
      difficulty: row[9],
      total_duration_minutes: row[10],
      total_lessons: row[11],
      completed_lessons: row[12]
    }));
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

    const row = res[0].values[0];
    const course: Course = {
      id: row[0] as string,
      title: row[1] as string,
      description: row[2] as string,
      cover_path: row[3] as string,
      category: row[4] as string,
      status: row[5] as any,
      source_path: row[6] as string,
      type: 'course',
      instructor: row[8] as string,
      difficulty: row[9] as any,
      total_duration_minutes: row[10] as number,
      total_lessons: row[11] as number,
      completed_lessons: row[12] as number
    };
    const modRes = db.exec(
      'SELECT id, title, order_index FROM module WHERE course_id = ? ORDER BY order_index ASC',
      [id]
    );
    if (modRes.length) {
      course.modules = [];
      for (const modRow of modRes[0].values) {
        const modId = modRow[0] as string;
        const modTitle = modRow[1] as string;
        const modOrder = modRow[2] as number;

        const lesRes = db.exec(
          `SELECT id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed 
           FROM lesson WHERE module_id = ? ORDER BY order_index ASC, id ASC`,
          [modId]
        );

        const lessons: Lesson[] = lesRes.length ? lesRes[0].values.map((l: any[]) => ({
          id: l[0],
          module_id: modId,
          title: l[1],
          content: l[2] ? String(l[2]) : undefined,
          order_index: l[3],
          duration_minutes: l[4],
          lesson_type: l[5],
          media_url: l[6],
          is_completed: Boolean(l[7])
        })) : [];

        course.modules.push({
          id: modId,
          course_id: id,
          title: modTitle,
          order_index: modOrder,
          lessons
        });
      }
    }
    return course;
  },
  async getCoursesWithModules(): Promise<Course[]> {
    const courses = await this.getCourses();
    if (!courses.length) return [];

    const db = dbBridge.getDatabase();
    const modRes = db.exec('SELECT id, course_id, title, order_index FROM module ORDER BY order_index ASC, id ASC');
    const lesRes = db.exec(`
      SELECT id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed
      FROM lesson
      ORDER BY order_index ASC, id ASC
    `);

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
          lesson_type: row[6] as any,
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

    return courses;
  },
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
  async toggleLessonCompleted(lessonId: string, completed: boolean): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      'UPDATE lesson SET is_completed = ? WHERE id = ?',
      [completed ? 1 : 0, lessonId]
    );
    // Mantener sincronizados los totales denormalizados del curso
    const courseRes = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [lessonId]);
    if (courseRes.length && courseRes[0].values.length) {
      await this.recalculateCourseTotals(String(courseRes[0].values[0][0]));
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
      await this.recalculateCourseTotals(String(modRes[0].values[0][0]));
    }
    await dbBridge.persist();
  },
  async getBooks(): Promise<Book[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             b.author, b.isbn, b.page_count, b.current_page, b.reading_percentage
      FROM learning_resource r
      JOIN book b ON r.id = b.id
      ORDER BY r.created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      cover_path: row[3],
      category: row[4],
      status: row[5],
      source_path: row[6],
      type: 'book',
      author: row[8],
      isbn: row[9],
      page_count: row[10],
      current_page: row[11],
      reading_percentage: row[12]
    }));
  },
  async getLearningResources(): Promise<LearningResource[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT id, title, description, cover_path, category, status, source_path, type, created_at, updated_at
      FROM learning_resource
      ORDER BY created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      id: row[0],
      title: row[1],
      description: row[2],
      cover_path: row[3],
      category: row[4],
      status: row[5],
      source_path: row[6],
      type: row[7],
      created_at: row[8],
      updated_at: row[9]
    }));
  },
  async getResourceSourceMeta(resourceId: string): Promise<{
    resource: LearningResource | null;
    sourceType: string;
    fileName?: string;
    fingerprint?: string;
    sectionCount: number;
    notesCount: number;
  }> {
    const db = dbBridge.getDatabase();
    const rRes = db.exec('SELECT id, title, description, cover_path, category, status, source_path, type, created_at FROM learning_resource WHERE id = ?', [resourceId]);
    if (!rRes.length || !rRes[0].values.length) {
      return { resource: null, sourceType: 'unknown', sectionCount: 0, notesCount: 0 };
    }
    const rRow = rRes[0].values[0];
    const resource: LearningResource = {
      id: String(rRow[0]),
      title: String(rRow[1]),
      description: rRow[2] ? String(rRow[2]) : undefined,
      cover_path: rRow[3] ? String(rRow[3]) : undefined,
      category: String(rRow[4]),
      status: (rRow[5] as any) || 'NOT_STARTED',
      source_path: rRow[6] ? String(rRow[6]) : undefined,
      type: (rRow[7] as any) || 'learning_resource',
      created_at: rRow[8] ? String(rRow[8]) : undefined
    };

    let fileName: string | undefined = undefined;
    let fingerprint: string | undefined = undefined;
    let sourceType: string = resource.type;

    if (resource.source_path?.startsWith('local://')) {
      const match = resource.source_path.match(/local:\/\/([^#]+)(?:#sha256=(.+))?/);
      if (match) {
        fileName = match[1];
        fingerprint = match[2];
        const ext = fileName.split('.').pop()?.toUpperCase() || 'DOCUMENT';
        sourceType = ext;
      }
    }

    const notesRes = db.exec('SELECT COUNT(*) FROM note WHERE resource_id = ?', [resourceId]);
    const notesCount = notesRes.length ? (notesRes[0].values[0][0] as number) : 0;

    return {
      resource,
      sourceType,
      fileName,
      fingerprint,
      sectionCount: notesCount,
      notesCount
    };
  },
  async updateBookProgress(id: string, currentPage: number, totalPages: number): Promise<{ success: boolean; error?: string }> {
    const calc = calculateBookProgress(currentPage, totalPages);
    if (!calc.valid) {
      return { success: false, error: calc.error };
    }

    const { clampedPage, percentage, status } = calc.data;
    const db = dbBridge.getDatabase();
    db.run(
      'UPDATE book SET current_page = ?, reading_percentage = ? WHERE id = ?',
      [clampedPage, percentage, id]
    );
    db.run(
      'UPDATE learning_resource SET status = ? WHERE id = ?',
      [status, id]
    );
    await dbBridge.persist();
    return { success: true };
  },
  async getFlashcards(): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, lesson_id, card_type, extra_data FROM flashcard');
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: String(r[0]),
      resource_id: r[1] ? String(r[1]) : undefined,
      front: String(r[2]),
      back: String(r[3]),
      repetition_count: Number(r[4]) || 0,
      interval_days: Number(r[5]) || 1,
      ease_factor: Number(r[6]) || 2.5,
      due_date: String(r[7]),
      last_reviewed: r[8] ? String(r[8]) : undefined,
      lesson_id: r[9] ? String(r[9]) : undefined,
      card_type: (r[10] as FlashcardType) || 'standard',
      extra_data: r[11] ? String(r[11]) : undefined
    }));
  },
  async reviewFlashcardSM2(id: string, grade: number): Promise<SM2Result | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      'SELECT repetition_count, interval_days, ease_factor FROM flashcard WHERE id = ?',
      [id]
    );
    if (!res.length || !res[0].values.length) return null;
    const [reps, interval, ease] = res[0].values[0] as [number, number, number];

    const updated = calculateSM2(
      { repetitionCount: reps, intervalDays: interval, easeFactor: ease },
      grade
    );

    db.run(
      `UPDATE flashcard 
       SET repetition_count = ?, 
           interval_days = ?, 
           ease_factor = ?, 
           due_date = datetime('now', ?),
           last_reviewed = datetime('now')
       WHERE id = ?`,
      [updated.repetitionCount, updated.intervalDays, updated.easeFactor, updated.intervalModifier, id]
    );
    await dbBridge.persist();
    return updated;
  },
  async getFlashcardsForLesson(lessonId: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `SELECT id, resource_id, lesson_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed, card_type, extra_data
       FROM flashcard
       WHERE lesson_id = ?
       ORDER BY rowid DESC`,
      [lessonId]
    );
    if (!res.length || !res[0].values.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: String(r[0]),
      resource_id: r[1] ? String(r[1]) : undefined,
      lesson_id: r[2] ? String(r[2]) : undefined,
      front: String(r[3]),
      back: String(r[4]),
      repetition_count: Number(r[5]) || 0,
      interval_days: Number(r[6]) || 1,
      ease_factor: Number(r[7]) || 2.5,
      due_date: String(r[8]),
      last_reviewed: r[9] ? String(r[9]) : undefined,
      card_type: (r[10] as FlashcardType) || 'standard',
      extra_data: r[11] ? String(r[11]) : undefined
    }));
  },
  async createFlashcard(card: { resource_id?: string; lesson_id?: string; front: string; back: string; card_type?: FlashcardType; extra_data?: string | null }): Promise<{ success: boolean; id?: string; error?: string }> {
    const front = card.front.trim();
    const back = card.back.trim();
    if (!front || !back) {
      return { success: false, error: 'El anverso y el reverso no pueden estar vacíos.' };
    }
    const db = dbBridge.getDatabase();
    const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.run(
      `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
      [id, card.resource_id || null, card.lesson_id || null, front, back, card.card_type || 'standard', card.extra_data || null]
    );
    await dbBridge.persist();
    return { success: true, id };
  },
  async updateFlashcard(id: string, updates: { front?: string; back?: string; card_type?: FlashcardType; extra_data?: string | null }): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    const clauses: string[] = [];
    const params: any[] = [];
    if (updates.front !== undefined) {
      const f = updates.front.trim();
      if (!f) return { success: false, error: 'El anverso no puede estar vacío.' };
      clauses.push('front = ?');
      params.push(f);
    }
    if (updates.back !== undefined) {
      const b = updates.back.trim();
      if (!b) return { success: false, error: 'El reverso no puede estar vacío.' };
      clauses.push('back = ?');
      params.push(b);
    }
    if (updates.card_type !== undefined) {
      clauses.push('card_type = ?');
      params.push(updates.card_type);
    }
    if (updates.extra_data !== undefined) {
      clauses.push('extra_data = ?');
      params.push(updates.extra_data);
    }
    if (clauses.length === 0) return { success: true };
    params.push(id);
    db.run(`UPDATE flashcard SET ${clauses.join(', ')} WHERE id = ?`, params);
    await dbBridge.persist();
    return { success: true };
  },
  async deleteFlashcard(id: string): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM flashcard WHERE id = ?', [id]);
    await dbBridge.persist();
    return { success: true };
  },
  async createFlashcards(cards: Array<{ resource_id?: string; lesson_id?: string; front: string; back: string; card_type?: FlashcardType; extra_data?: string | null }>): Promise<string[]> {
    if (!cards || cards.length === 0) return [];
    const db = dbBridge.getDatabase();
    const insertedIds: string[] = [];

    for (const card of cards) {
      const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, card_type, extra_data, repetition_count, interval_days, ease_factor, due_date)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
        [id, card.resource_id || null, card.lesson_id || null, card.front, card.back, card.card_type || 'standard', card.extra_data || null]
      );
      insertedIds.push(id);
    }

    await dbBridge.persist();
    return insertedIds;
  },
  async saveMediaAsset(asset: { id?: string; mime_type: string; data: string }): Promise<string> {
    const db = dbBridge.getDatabase();
    const id = asset.id || `asset_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.run(
      `INSERT OR REPLACE INTO media_asset (id, mime_type, data, created_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [id, asset.mime_type, asset.data]
    );
    await dbBridge.persist();
    return id;
  },
  async getMediaAsset(id: string): Promise<MediaAsset | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, mime_type, data, created_at FROM media_asset WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const [assetId, mime, data, createdAt] = res[0].values[0];
    return {
      id: String(assetId),
      mime_type: String(mime),
      data: String(data),
      created_at: String(createdAt)
    };
  },
  async getKnowledgeGraph(): Promise<{ nodes: ConceptNode[]; edges: ConceptEdge[] }> {
    const db = dbBridge.getDatabase();
    const nodes: ConceptNode[] = [];
    const byId = new Map<string, ConceptNode>();

    const addNode = (node: ConceptNode) => {
      if (byId.has(node.id)) return;
      byId.set(node.id, node);
      nodes.push(node);
    };

    // 1. Conceptos
    const conceptRes = db.exec('SELECT id, name, description FROM concept');
    if (conceptRes.length) {
      for (const r of conceptRes[0].values) {
        addNode({ id: String(r[0]), name: String(r[1]), description: r[2] ? String(r[2]) : undefined, node_type: 'concept', meta: {} });
      }
    }

    // 2. Recursos de aprendizaje (curso / libro / recurso)
    const resRes = db.exec('SELECT id, title, description, type, category, status, source_path, created_at, updated_at FROM learning_resource');
    if (resRes.length) {
      for (const r of resRes[0].values) {
        const rawType = String(r[3]);
        const nodeType: GraphNodeType = rawType === 'course' ? 'course' : rawType === 'book' ? 'book' : 'resource';
        addNode({
          id: String(r[0]),
          name: String(r[1]),
          description: r[2] ? String(r[2]) : undefined,
          node_type: nodeType,
          meta: {
            category: r[4] ? String(r[4]) : undefined,
            status: r[5] ? String(r[5]) : undefined,
            source_path: r[6] ? String(r[6]) : undefined,
            created_at: r[7] ? String(r[7]) : undefined,
            updated_at: r[8] ? String(r[8]) : undefined
          }
        });
      }
    }

    const courseRes = db.exec('SELECT id, instructor, difficulty, total_lessons FROM course');
    if (courseRes.length) {
      for (const r of courseRes[0].values) {
        const node = byId.get(String(r[0]));
        if (node) node.meta = { ...node.meta, instructor: r[1] ? String(r[1]) : undefined, difficulty: r[2] ? String(r[2]) : undefined, total_lessons: Number(r[3]) || 0 };
      }
    }

    const bookRes = db.exec('SELECT id, author, page_count, current_page, reading_percentage FROM book');
    if (bookRes.length) {
      for (const r of bookRes[0].values) {
        const node = byId.get(String(r[0]));
        if (node) node.meta = { ...node.meta, author: r[1] ? String(r[1]) : undefined, page_count: Number(r[2]) || 0, current_page: Number(r[3]) || 0, reading_percentage: Number(r[4]) || 0 };
      }
    }

    // 3. Módulos
    const modRes = db.exec('SELECT id, course_id, title, order_index FROM module');
    if (modRes.length) {
      for (const r of modRes[0].values) {
        addNode({ id: String(r[0]), name: String(r[2]), node_type: 'module', meta: { course_id: String(r[1]), order_index: Number(r[3]) || 0 } });
      }
    }

    // 4. Lecciones
    const lesRes = db.exec('SELECT l.id, l.module_id, l.title, l.duration_minutes, l.lesson_type, m.course_id FROM lesson l JOIN module m ON l.module_id = m.id');
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[2]),
          node_type: 'lesson',
          meta: { module_id: String(r[1]), course_id: String(r[5]), duration_minutes: Number(r[3]) || 0, lesson_type: r[4] ? String(r[4]) : undefined }
        });
      }
    }

    // 5. Notas
    const noteRes = db.exec('SELECT id, resource_id, lesson_id, title, tags, created_at, updated_at FROM note');
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[3]),
          node_type: 'note',
          meta: { resource_id: r[1] ? String(r[1]) : undefined, lesson_id: r[2] ? String(r[2]) : undefined, tags: r[4] ? String(r[4]) : undefined, created_at: r[5] ? String(r[5]) : undefined, updated_at: r[6] ? String(r[6]) : undefined }
        });
      }
    }

    // 5.b Trabajo práctico: evidencia producida por el estudiante. Participa en el
    // grafo como nodo propio porque el usuario necesita responder "¿qué trabajo
    // demuestra este concepto/lección?" sin salir del mapa de relaciones.
    const practiceRes = db.exec(
      'SELECT id, title, resource_id, lesson_id, concept_id, kind, status, created_at, updated_at FROM practice_work'
    );
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[1]),
          node_type: 'practice',
          meta: {
            resource_id: r[2] ? String(r[2]) : undefined,
            lesson_id: r[3] ? String(r[3]) : undefined,
            concept_id: r[4] ? String(r[4]) : undefined,
            practice_kind: r[5] ? String(r[5]) : undefined,
            status: r[6] ? String(r[6]) : undefined,
            created_at: r[7] ? String(r[7]) : undefined,
            updated_at: r[8] ? String(r[8]) : undefined
          }
        });
      }
    }

    const edges: ConceptEdge[] = [];

    // 6. Aristas estructurales derivadas de claves foráneas (no editables)
    if (modRes.length) {
      for (const r of modRes[0].values) {
        const courseId = String(r[1]);
        const moduleId = String(r[0]);
        if (byId.has(courseId)) {
          edges.push({ id: `derived-contains-${moduleId}`, source_id: courseId, target_id: moduleId, connection_type: 'contains', weight: 1, derived: true });
        }
      }
    }
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        const moduleId = String(r[1]);
        const lessonId = String(r[0]);
        if (byId.has(moduleId)) {
          edges.push({ id: `derived-contains-${lessonId}`, source_id: moduleId, target_id: lessonId, connection_type: 'contains', weight: 1, derived: true });
        }
      }
    }
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        const noteId = String(r[0]);
        const resourceId = r[1] ? String(r[1]) : null;
        const lessonId = r[2] ? String(r[2]) : null;
        if (resourceId && byId.has(resourceId)) {
          edges.push({ id: `derived-about-${noteId}-${resourceId}`, source_id: noteId, target_id: resourceId, connection_type: 'about', weight: 1, derived: true });
        }
        if (lessonId && byId.has(lessonId)) {
          edges.push({ id: `derived-references-${noteId}-${lessonId}`, source_id: lessonId, target_id: noteId, connection_type: 'references', weight: 1, derived: true });
        }
      }
    }

    // 6.b Aristas derivadas del trabajo práctico: liga la evidencia con aquello
    // que demuestra (recurso, lección o concepto). Solo si ambos extremos existen.
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        const workId = String(r[0]);
        const resourceId = r[2] ? String(r[2]) : null;
        const lessonId = r[3] ? String(r[3]) : null;
        const conceptId = r[4] ? String(r[4]) : null;
        if (resourceId && byId.has(resourceId)) {
          edges.push({ id: `derived-about-${workId}-${resourceId}`, source_id: workId, target_id: resourceId, connection_type: 'about', weight: 1, derived: true });
        }
        if (lessonId && byId.has(lessonId)) {
          edges.push({ id: `derived-references-${lessonId}-${workId}`, source_id: lessonId, target_id: workId, connection_type: 'references', weight: 1, derived: true });
        }
        if (conceptId && byId.has(conceptId)) {
          edges.push({ id: `derived-about-${workId}-${conceptId}`, source_id: workId, target_id: conceptId, connection_type: 'about', weight: 1, derived: true });
        }
      }
    }

    // 7. Conexiones explícitas del usuario (solo si ambos extremos existen)
    const eRes = db.exec('SELECT id, source_id, target_id, connection_type, weight FROM knowledge_connection');
    if (eRes.length) {
      for (const r of eRes[0].values) {
        const source = String(r[1]);
        const target = String(r[2]);
        if (!byId.has(source) || !byId.has(target)) continue;
        edges.push({ id: String(r[0]), source_id: source, target_id: target, connection_type: String(r[3]), weight: Number(r[4]) || 1 });
      }
    }

    return { nodes, edges };
  },
  async getKnowledgeConnections(): Promise<KnowledgeConnection[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, source_id, target_id, connection_type, weight FROM knowledge_connection');
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: String(r[0]),
      source_id: String(r[1]),
      target_id: String(r[2]),
      connection_type: String(r[3]),
      weight: Number(r[4]) || 1
    }));
  },
  async createKnowledgeConnection(input: { sourceId: string; targetId: string; relationType: string; weight?: number }): Promise<{ success: boolean; error?: string; id?: string }> {
    const graph = await this.getKnowledgeGraph();
    const validation = validateKnowledgeConnection(
      { sourceId: input.sourceId, targetId: input.targetId, relationType: input.relationType },
      {
        nodeIds: graph.nodes.map(n => n.id),
        existingEdges: graph.edges.filter(e => !e.derived).map(e => ({ source_id: e.source_id, target_id: e.target_id, connection_type: e.connection_type }))
      }
    );
    if (!validation.valid || !validation.relation) {
      return { success: false, error: validation.error || 'Conexión inválida.' };
    }

    const db = dbBridge.getDatabase();
    const id = `kc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const weight = typeof input.weight === 'number' && input.weight > 0 ? input.weight : 1.0;
    db.run(
      `INSERT INTO knowledge_connection (id, source_id, target_id, connection_type, weight) VALUES (?, ?, ?, ?, ?)`,
      [id, input.sourceId, input.targetId, validation.relation, weight]
    );
    await dbBridge.persist();
    return { success: true, id };
  },
  async deleteKnowledgeConnection(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM knowledge_connection WHERE id = ?', [id]);
    await dbBridge.persist();
  },
  async pruneDanglingConnections(): Promise<number> {
    const db = dbBridge.getDatabase();
    const nodeIds = await this.collectGraphNodeIds();
    const res = db.exec('SELECT id, source_id, target_id FROM knowledge_connection');
    if (!res.length) return 0;
    let removed = 0;
    for (const row of res[0].values) {
      const id = String(row[0]);
      if (!nodeIds.has(String(row[1])) || !nodeIds.has(String(row[2]))) {
        db.run('DELETE FROM knowledge_connection WHERE id = ?', [id]);
        removed++;
      }
    }
    if (removed > 0) await dbBridge.persist();
    return removed;
  },
  async getRelatedNodeIds(nodeId: string): Promise<string[]> {
    const db = dbBridge.getDatabase();
    const related = new Set<string>();
    const addAll = (res: any) => {
      if (!res.length) return;
      for (const r of res[0].values) related.add(String(r[0]));
    };

    // Conexiones explícitas (ambas direcciones)
    addAll(db.exec('SELECT target_id FROM knowledge_connection WHERE source_id = ?', [nodeId]));
    addAll(db.exec('SELECT source_id FROM knowledge_connection WHERE target_id = ?', [nodeId]));

    // Estructura derivada
    addAll(db.exec('SELECT id FROM module WHERE course_id = ?', [nodeId]));
    addAll(db.exec('SELECT course_id FROM module WHERE id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM lesson WHERE module_id = ?', [nodeId]));
    addAll(db.exec('SELECT module_id FROM lesson WHERE id = ?', [nodeId]));
    addAll(db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM note WHERE resource_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM note WHERE lesson_id = ?', [nodeId]));
    addAll(db.exec('SELECT resource_id FROM note WHERE id = ? AND resource_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT lesson_id FROM note WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]));

    // Trabajo práctico: el artefacto pertenece al perímetro de su recurso o
    // lección, y su propio ámbito se resuelve hacia el padre. Sin esto, el
    // trabajo práctico quedaría fuera de cualquier recuperación acotada.
    addAll(db.exec('SELECT id FROM practice_work WHERE resource_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM practice_work WHERE lesson_id = ?', [nodeId]));
    addAll(db.exec('SELECT id FROM practice_work WHERE concept_id = ?', [nodeId]));
    addAll(db.exec('SELECT resource_id FROM practice_work WHERE id = ? AND resource_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT lesson_id FROM practice_work WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]));
    addAll(db.exec('SELECT concept_id FROM practice_work WHERE id = ? AND concept_id IS NOT NULL', [nodeId]));

    related.delete(nodeId);
    return Array.from(related);
  },
  async collectGraphNodeIds(): Promise<Set<string>> {
    const db = dbBridge.getDatabase();
    const ids = new Set<string>();
    const collect = (sql: string) => {
      const res = db.exec(sql);
      if (!res.length) return;
      for (const r of res[0].values) ids.add(String(r[0]));
    };
    collect('SELECT id FROM concept');
    collect('SELECT id FROM learning_resource');
    collect('SELECT id FROM module');
    collect('SELECT id FROM lesson');
    collect('SELECT id FROM note');
    // El trabajo práctico es un nodo del grafo: sus conexiones manuales no deben
    // podarse como si fueran huérfanas.
    collect('SELECT id FROM practice_work');
    return ids;
  },
  async createCourse(input: { title: string; description?: string; category?: string; instructor?: string; difficulty?: CourseDifficulty }): Promise<{ success: boolean; id?: string; error?: string }> {
    const title = (input.title || '').trim();
    if (title.length < 3) return { success: false, error: 'El título del curso debe tener al menos 3 caracteres.' };
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
    if (!input.courseId) return { success: false, error: 'Debes seleccionar un curso.' };
    if (title.length < 2) return { success: false, error: 'El título del módulo es demasiado corto.' };
    const db = dbBridge.getDatabase();
    const courseExists = db.exec('SELECT 1 FROM course WHERE id = ?', [input.courseId]);
    if (!courseExists.length || !courseExists[0].values.length) return { success: false, error: 'El curso indicado no existe.' };
    const id = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orderRes = db.exec('SELECT COALESCE(MAX(order_index), 0) + 1 FROM module WHERE course_id = ?', [input.courseId]);
    const orderIndex = orderRes.length ? Number(orderRes[0].values[0][0]) : 1;
    db.run('INSERT INTO module (id, course_id, title, order_index) VALUES (?, ?, ?, ?)', [id, input.courseId, title, orderIndex]);
    await this.recalculateCourseTotals(input.courseId);
    await dbBridge.persist();
    return { success: true, id };
  },
  async createLesson(input: { moduleId: string; title: string; content?: string; durationMinutes?: number; lessonType?: LessonType; mediaUrl?: string }): Promise<{ success: boolean; id?: string; error?: string }> {
    const title = (input.title || '').trim();
    if (!input.moduleId) return { success: false, error: 'Debes seleccionar un módulo.' };
    if (title.length < 2) return { success: false, error: 'El título de la lección es demasiado corto.' };
    const db = dbBridge.getDatabase();
    const moduleRes = db.exec('SELECT course_id FROM module WHERE id = ?', [input.moduleId]);
    if (!moduleRes.length || !moduleRes[0].values.length) return { success: false, error: 'El módulo indicado no existe.' };
    const courseId = String(moduleRes[0].values[0][0]);
    const id = `les_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const orderRes = db.exec('SELECT COALESCE(MAX(order_index), 0) + 1 FROM lesson WHERE module_id = ?', [input.moduleId]);
    const orderIndex = orderRes.length ? Number(orderRes[0].values[0][0]) : 1;
    db.run(
      `INSERT INTO lesson (id, module_id, title, content, order_index, duration_minutes, lesson_type, media_url, is_completed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [id, input.moduleId, title, input.content ?? null, orderIndex, Math.max(0, input.durationMinutes || 0), input.lessonType || 'VIDEO', input.mediaUrl || null]
    );
    await this.recalculateCourseTotals(courseId);
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
      return { success: false, error: 'El título de la lección es demasiado corto.' };
    }
    if (fields.durationMinutes !== undefined && (typeof fields.durationMinutes !== 'number' || fields.durationMinutes < 0)) {
      return { success: false, error: 'La duración debe ser un número no negativo.' };
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
      await this.recalculateCourseTotals(String(courseRes[0].values[0][0]));
    }
    await dbBridge.persist();
    return { success: true };
  },
  async moveLesson(lessonId: string, direction: 'up' | 'down'): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) return { success: false, error: 'La lección indicada no existe.' };

    const res = db.exec('SELECT id, order_index FROM lesson WHERE module_id = ? ORDER BY order_index ASC, id ASC', [lesson.module_id]);
    const ordered = res.length ? res[0].values.map(r => ({ id: String(r[0]), order: Number(r[1]) || 0 })) : [];
    const index = ordered.findIndex(l => l.id === lessonId);
    if (index === -1) return { success: false, error: 'La lección no pertenece al módulo.' };

    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= ordered.length) {
      return { success: false, error: direction === 'up' ? 'La lección ya es la primera.' : 'La lección ya es la última.' };
    }

    const reordered = [...ordered];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    // Normaliza posiciones a 1..N garantizando ausencia de duplicados.
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
    const lesson = await this.getLessonById(lessonId);
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

    // Las notas del espacio de trabajo deben pertenecer estrictamente a ESTA
    // lección. Reutilizar `getNotesForResource(courseId, lessonId)` mezclaría
    // notas de otras lecciones del mismo curso (comparten `resource_id`).
    const notes = await this.getNotesForLesson(lessonId);
    const flashcards = await this.getFlashcardsForLesson(lessonId);
    const related = await this.getRelatedKnowledge(lessonId);

    const resources = related.filter(r => r.type === 'resource' || r.type === 'book' || r.type === 'course' || r.type === 'lesson' || r.type === 'module');
    const concepts = related.filter(r => r.type === 'concept');
    const relatedBooks = related.filter(r => r.type === 'book');

    // "Actividad" significa contenido propio, notas, tarjetas o relaciones explícitas creadas
    // por el usuario. La mera pertenencia estructural (estar en un módulo/curso) no
    // cuenta como progreso, para no inventar un porcentaje sin significado.
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
    if (courseId) await this.recalculateCourseTotals(courseId);
    await this.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async deleteLesson(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    const courseRes = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [id]);
    const courseId = courseRes.length && courseRes[0].values.length ? String(courseRes[0].values[0][0]) : null;
    db.run('DELETE FROM lesson WHERE id = ?', [id]);
    if (courseId) await this.recalculateCourseTotals(courseId);
    await this.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async deleteCourse(id: string): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run('DELETE FROM learning_resource WHERE id = ?', [id]);
    await this.pruneDanglingConnections();
    await dbBridge.persist();
  },
  async recalculateCourseTotals(courseId: string): Promise<void> {
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
  },
  async updateBookDetails(id: string, fields: { title?: string; description?: string; category?: string; author?: string; isbn?: string; pageCount?: number }): Promise<{ success: boolean; error?: string }> {
    const db = dbBridge.getDatabase();
    if (fields.pageCount !== undefined && (typeof fields.pageCount !== 'number' || fields.pageCount <= 0)) {
      return { success: false, error: 'El número de páginas debe ser mayor que cero.' };
    }

    if (fields.title !== undefined || fields.description !== undefined || fields.category !== undefined) {
      db.run(
        `UPDATE learning_resource SET title = COALESCE(?, title), description = COALESCE(?, description), category = COALESCE(?, category), updated_at = datetime('now') WHERE id = ?`,
        [fields.title ?? null, fields.description ?? null, fields.category ?? null, id]
      );
    }

    db.run(
      `UPDATE book SET author = COALESCE(?, author), isbn = COALESCE(?, isbn), page_count = COALESCE(?, page_count) WHERE id = ?`,
      [fields.author ?? null, fields.isbn ?? null, fields.pageCount ?? null, id]
    );

    // Si cambia el total de páginas, recalcular el porcentaje de lectura de forma coherente
    if (fields.pageCount !== undefined) {
      const row = db.exec('SELECT current_page, page_count FROM book WHERE id = ?', [id]);
      if (row.length && row[0].values.length) {
        const current = Number(row[0].values[0][0]) || 0;
        const total = Number(row[0].values[0][1]) || fields.pageCount;
        const pct = total > 0 ? Number(((Math.min(current, total) / total) * 100).toFixed(1)) : 0;
        db.run('UPDATE book SET reading_percentage = ? WHERE id = ?', [pct, id]);
      }
    }

    await dbBridge.persist();
    return { success: true };
  },
  async getUnorganizedResources(): Promise<UnorganizedResource[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type, r.created_at,
             (SELECT COUNT(*) FROM note n WHERE n.resource_id = r.id) AS note_count,
             (SELECT COUNT(*) FROM knowledge_connection kc WHERE kc.source_id = r.id OR kc.target_id = r.id) AS conn_count
      FROM learning_resource r
      WHERE r.type = 'learning_resource'
        AND (SELECT COUNT(*) FROM knowledge_connection kc WHERE kc.source_id = r.id OR kc.target_id = r.id) = 0
      ORDER BY r.created_at DESC
    `);
    if (!res.length) return [];
    return res[0].values.map((row: any[]) => ({
      resource: {
        id: String(row[0]),
        title: String(row[1]),
        description: row[2] ? String(row[2]) : undefined,
        cover_path: row[3] ? String(row[3]) : undefined,
        category: String(row[4] || 'General'),
        status: (row[5] as any) || 'NOT_STARTED',
        source_path: row[6] ? String(row[6]) : undefined,
        type: 'learning_resource',
        created_at: row[8] ? String(row[8]) : undefined
      },
      noteCount: Number(row[9]) || 0,
      connectionCount: Number(row[10]) || 0
    }));
  },
  async searchKnowledge(query: string, limit: number = 25): Promise<SearchResult[]> {
    const trimmed = (query || '').trim().toLowerCase();
    if (trimmed.length < 2) return [];
    const escaped = trimmed.replace(/[\\%_]/g, c => `\\${c}`);
    const like = `%${escaped}%`;
    const db = dbBridge.getDatabase();
    const results: SearchResult[] = [];

    const resRes = db.exec(
      `SELECT id, title, description, category, type FROM learning_resource
       WHERE lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(description,'')) LIKE ? ESCAPE '\\' OR lower(COALESCE(category,'')) LIKE ? ESCAPE '\\'`,
      [like, like, like]
    );
    if (resRes.length) {
      for (const r of resRes[0].values) {
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
       FROM lesson l JOIN module m ON l.module_id = m.id JOIN learning_resource r ON m.course_id = r.id
       WHERE lower(l.title) LIKE ? ESCAPE '\\'`,
      [like]
    );
    if (lesRes.length) {
      for (const r of lesRes[0].values) {
        results.push({ id: String(r[0]), type: 'lesson', title: String(r[1]), subtitle: `${r[3]} › ${r[4]}`, resourceId: String(r[2]), lessonId: String(r[0]) });
      }
    }

    const noteRes = db.exec(
      `SELECT id, title, content, resource_id, lesson_id FROM note
       WHERE lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(content,'')) LIKE ? ESCAPE '\\'`,
      [like, like]
    );
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        results.push({ id: String(r[0]), type: 'note', title: String(r[1]), subtitle: String(r[2]).slice(0, 80), resourceId: r[3] ? String(r[3]) : undefined, lessonId: r[4] ? String(r[4]) : undefined });
      }
    }

    const conceptRes = db.exec(
      `SELECT id, name, description FROM concept WHERE lower(name) LIKE ? ESCAPE '\\' OR lower(COALESCE(description,'')) LIKE ? ESCAPE '\\'`,
      [like, like]
    );
    if (conceptRes.length) {
      for (const r of conceptRes[0].values) {
        results.push({ id: String(r[0]), type: 'concept', title: String(r[1]), subtitle: r[2] ? String(r[2]) : undefined });
      }
    }

    // El trabajo práctico es evidencia de aprendizaje del usuario: si la búsqueda
    // global no lo encontrara, un artefacto visible en el panel y en el grafo
    // sería inalcanzable desde la búsqueda.
    const practiceRes = db.exec(
      `SELECT id, title, description, resource_id, lesson_id FROM practice_work
       WHERE lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(description,'')) LIKE ? ESCAPE '\\'`,
      [like, like]
    );
    if (practiceRes.length) {
      for (const r of practiceRes[0].values) {
        results.push({
          id: String(r[0]),
          type: 'practice',
          title: String(r[1]),
          subtitle: r[2] ? String(r[2]).slice(0, 80) : 'Trabajo práctico',
          resourceId: r[3] ? String(r[3]) : undefined,
          lessonId: r[4] ? String(r[4]) : undefined
        });
      }
    }

    // Las metas de aprendizaje son planificación personal: si la búsqueda
    // global no las encontrara, serían inalcanzables desde la Biblioteca.
    const goalRes = db.exec(
      `SELECT id, title, description, kind, status FROM learning_goal
       WHERE lower(title) LIKE ? ESCAPE '\\' OR lower(COALESCE(description,'')) LIKE ? ESCAPE '\\'`,
      [like, like]
    );
    if (goalRes.length) {
      for (const r of goalRes[0].values) {
        const kindLabel = GOAL_KIND_LABELS[String(r[3]) as keyof typeof GOAL_KIND_LABELS] || GOAL_KIND_LABELS.custom;
        results.push({
          id: String(r[0]),
          type: 'goal',
          title: String(r[1]),
          subtitle: `${kindLabel} · ${String(r[4]) === 'completed' ? 'Completada' : 'Activa'}${r[2] ? ` · ${String(r[2]).slice(0, 60)}` : ''}`
        });
      }
    }

    // Orden determinista: título ascendente, id ascendente
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
  async resolveNodeKind(id: string): Promise<ResourceKind | null> {
    const db = dbBridge.getDatabase();
    const concept = db.exec('SELECT 1 FROM concept WHERE id = ?', [id]);
    if (concept.length && concept[0].values.length) return 'concept';

    const lr = db.exec('SELECT type FROM learning_resource WHERE id = ?', [id]);
    if (lr.length && lr[0].values.length) {
      const type = String(lr[0].values[0][0]);
      return type === 'course' ? 'course' : type === 'book' ? 'book' : 'resource';
    }

    const lesson = db.exec('SELECT 1 FROM lesson WHERE id = ?', [id]);
    if (lesson.length && lesson[0].values.length) return 'lesson';

    const note = db.exec('SELECT 1 FROM note WHERE id = ?', [id]);
    if (note.length && note[0].values.length) return 'note';

    const mod = db.exec('SELECT 1 FROM module WHERE id = ?', [id]);
    if (mod.length && mod[0].values.length) return 'module';

    return null;
  },
  async getBookById(id: string): Promise<Book | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT r.id, r.title, r.description, r.cover_path, r.category, r.status, r.source_path, r.type,
             b.author, b.isbn, b.page_count, b.current_page, b.reading_percentage
      FROM learning_resource r JOIN book b ON r.id = b.id WHERE r.id = ?`, [id]);
    if (!res.length || !res[0].values.length) return null;
    const row = res[0].values[0];
    return {
      id: String(row[0]), title: String(row[1]), description: row[2] ? String(row[2]) : undefined,
      cover_path: row[3] ? String(row[3]) : undefined, category: String(row[4]), status: row[5] as any,
      source_path: row[6] ? String(row[6]) : undefined, type: 'book', author: row[8] ? String(row[8]) : undefined,
      isbn: row[9] ? String(row[9]) : undefined, page_count: Number(row[10]) || 0,
      current_page: Number(row[11]) || 0, reading_percentage: Number(row[12]) || 0
    };
  },
  async getConceptById(id: string): Promise<{ id: string; name: string; description?: string } | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, name, description FROM concept WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const r = res[0].values[0];
    return { id: String(r[0]), name: String(r[1]), description: r[2] ? String(r[2]) : undefined };
  },
  async getNodeSummaries(ids: string[]): Promise<Map<string, { title: string; type: GraphNodeType }>> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const map = new Map<string, { title: string; type: GraphNodeType }>();
    if (!unique.length) return map;
    const db = dbBridge.getDatabase();
    const ph = unique.map(() => '?').join(',');

    const lr = db.exec(`SELECT id, title, type FROM learning_resource WHERE id IN (${ph})`, unique);
    if (lr.length) for (const r of lr[0].values) {
      const t = String(r[2]);
      map.set(String(r[0]), { title: String(r[1]), type: t === 'course' ? 'course' : t === 'book' ? 'book' : 'resource' });
    }
    const concept = db.exec(`SELECT id, name FROM concept WHERE id IN (${ph})`, unique);
    if (concept.length) for (const r of concept[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'concept' });

    const mod = db.exec(`SELECT id, title FROM module WHERE id IN (${ph})`, unique);
    if (mod.length) for (const r of mod[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'module' });

    const les = db.exec(`SELECT id, title FROM lesson WHERE id IN (${ph})`, unique);
    if (les.length) for (const r of les[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'lesson' });

    const note = db.exec(`SELECT id, title FROM note WHERE id IN (${ph})`, unique);
    if (note.length) for (const r of note[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'note' });

    const practice = db.exec(`SELECT id, title FROM practice_work WHERE id IN (${ph})`, unique);
    if (practice.length) for (const r of practice[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'practice' });

    return map;
  },
  async getRelatedKnowledge(nodeId: string): Promise<RelatedKnowledgeItem[]> {
    const db = dbBridge.getDatabase();
    const related: RelatedKnowledgeItem[] = [];
    const seen = new Set<string>();
    const push = (counterpartId: string, relation: string, derived: boolean) => {
      if (!counterpartId || counterpartId === nodeId) return;
      const key = `${counterpartId}:${relation}`;
      if (seen.has(key)) return;
      seen.add(key);
      related.push({ id: counterpartId, title: counterpartId, type: 'resource', relation, derived });
    };

    const conn = db.exec('SELECT source_id, target_id, connection_type FROM knowledge_connection WHERE source_id = ? OR target_id = ?', [nodeId, nodeId]);
    if (conn.length) for (const r of conn[0].values) {
      const counterpart = String(r[0]) === nodeId ? String(r[1]) : String(r[0]);
      push(counterpart, String(r[2]), false);
    }

    const notesOfResource = db.exec('SELECT id FROM note WHERE resource_id = ?', [nodeId]);
    if (notesOfResource.length) for (const r of notesOfResource[0].values) push(String(r[0]), 'about', true);

    const notesOfLesson = db.exec('SELECT id FROM note WHERE lesson_id = ?', [nodeId]);
    if (notesOfLesson.length) for (const r of notesOfLesson[0].values) push(String(r[0]), 'references', true);

    // Estructura derivada (igual que el grafo): módulos, lecciones, curso y vínculos de notas.
    const modulesOfCourse = db.exec('SELECT id FROM module WHERE course_id = ?', [nodeId]);
    if (modulesOfCourse.length) for (const r of modulesOfCourse[0].values) push(String(r[0]), 'contains', true);

    const courseOfModule = db.exec('SELECT course_id FROM module WHERE id = ?', [nodeId]);
    if (courseOfModule.length) for (const r of courseOfModule[0].values) push(String(r[0]), 'contains', true);

    const lessonsOfModule = db.exec('SELECT id FROM lesson WHERE module_id = ?', [nodeId]);
    if (lessonsOfModule.length) for (const r of lessonsOfModule[0].values) push(String(r[0]), 'contains', true);

    const moduleOfLesson = db.exec('SELECT module_id FROM lesson WHERE id = ?', [nodeId]);
    if (moduleOfLesson.length) for (const r of moduleOfLesson[0].values) push(String(r[0]), 'contains', true);

    const courseOfLesson = db.exec('SELECT m.course_id FROM lesson l JOIN module m ON l.module_id = m.id WHERE l.id = ?', [nodeId]);
    if (courseOfLesson.length) for (const r of courseOfLesson[0].values) push(String(r[0]), 'contains', true);

    const noteResource = db.exec('SELECT resource_id FROM note WHERE id = ? AND resource_id IS NOT NULL', [nodeId]);
    if (noteResource.length) for (const r of noteResource[0].values) push(String(r[0]), 'about', true);

    const noteLesson = db.exec('SELECT lesson_id FROM note WHERE id = ? AND lesson_id IS NOT NULL', [nodeId]);
    if (noteLesson.length) for (const r of noteLesson[0].values) push(String(r[0]), 'references', true);

    // Trabajo práctico como EVIDENCIA del aprendizaje: se muestra junto al
    // recurso, la lección o el concepto que demuestra (y viceversa), para que la
    // relación sea navegable y no viva solo en la base de datos.
    const practiceOfResource = db.exec('SELECT id FROM practice_work WHERE resource_id = ?', [nodeId]);
    if (practiceOfResource.length) for (const r of practiceOfResource[0].values) push(String(r[0]), 'about', true);

    const practiceOfLesson = db.exec('SELECT id FROM practice_work WHERE lesson_id = ?', [nodeId]);
    if (practiceOfLesson.length) for (const r of practiceOfLesson[0].values) push(String(r[0]), 'references', true);

    const practiceOfConcept = db.exec('SELECT id FROM practice_work WHERE concept_id = ?', [nodeId]);
    if (practiceOfConcept.length) for (const r of practiceOfConcept[0].values) push(String(r[0]), 'about', true);

    const practiceContext = db.exec('SELECT resource_id, lesson_id, concept_id FROM practice_work WHERE id = ?', [nodeId]);
    if (practiceContext.length) {
      for (const r of practiceContext[0].values) {
        if (r[0]) push(String(r[0]), 'about', true);
        if (r[1]) push(String(r[1]), 'references', true);
        if (r[2]) push(String(r[2]), 'about', true);
      }
    }

    const summaries = await this.getNodeSummaries(related.map(r => r.id));
    return related.map(item => {
      const s = summaries.get(item.id);
      return { ...item, title: s?.title || item.id, type: s?.type || 'resource' };
    });
  },
  async getRelatedConcepts(nodeIds: string[]): Promise<Array<{ id: string; name: string }>> {
    const found = new Map<string, string>();
    for (const id of nodeIds) {
      if (!id) continue;
      const items = await this.getRelatedKnowledge(id);
      for (const item of items) {
        if (item.type === 'concept') found.set(item.id, item.title);
      }
    }
    return Array.from(found.entries()).map(([id, name]) => ({ id, name }));
  },
  async getResourceDetail(resourceId: string): Promise<ResourceDetail | null> {
    const db = dbBridge.getDatabase();

    const kind = await this.resolveNodeKind(resourceId);
    if (!kind || kind === 'lesson' || kind === 'note' || kind === 'module') return null;

    if (kind === 'concept') {
      const concept = await this.getConceptById(resourceId);
      if (!concept) return null;
      return {
        resource: { id: concept.id, title: concept.name, description: concept.description, category: 'Concepto', status: 'NOT_STARTED', type: 'learning_resource' },
        kind: 'concept',
        fragments: [],
        related: await this.getRelatedKnowledge(resourceId)
      };
    }

    const meta = await this.getResourceSourceMeta(resourceId);
    if (!meta.resource) return null;

    const book = kind === 'book' ? await this.getBookById(resourceId) || undefined : undefined;

    const fragRes = db.exec('SELECT id, title, content, tags, created_at FROM note WHERE resource_id = ? ORDER BY created_at ASC, title ASC', [resourceId]);
    const fragments: ResourceFragment[] = fragRes.length ? fragRes[0].values.map((r: any[]) => ({
      id: String(r[0]), title: String(r[1]), content: String(r[2]), tags: r[3] ? String(r[3]) : undefined, created_at: r[4] ? String(r[4]) : undefined
    })) : [];

    const hasSource = meta.sourceType && meta.sourceType !== 'learning_resource' && meta.sourceType !== 'book';
    return {
      resource: meta.resource,
      kind,
      book,
      source: hasSource || meta.fileName ? {
        sourceType: meta.sourceType,
        fileName: meta.fileName,
        fingerprint: meta.fingerprint,
        sectionCount: meta.sectionCount
      } : undefined,
      fragments,
      related: await this.getRelatedKnowledge(resourceId)
    };
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

    const work = await this.getPracticeWorkForResource(resourceId);
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
        // Tabla ausente en una base antigua: la migración de esquema la creará.
      }
    }

    const plan = planCoursePackageImport(pkg, existing);

    // Conflictos: IDs que ya existen localmente con un contenido DISTINTO. La
    // importación es aditiva y el contenido local gana siempre, así que el
    // conflicto no cambia lo que se escribe; solo se reporta para que el
    // resultado sea determinista y visible (nunca una pérdida silenciosa).
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
  },
  async getAllLearningResources() {
    const [coursesWithModules, books, notes, flashcards, graph, practiceWork] = await Promise.all([
      this.getCoursesWithModules(),
      this.getBooks(),
      this.getNotes(),
      this.getFlashcards(),
      this.getKnowledgeGraph(),
      this.getAllPracticeWork()
    ]);

    return {
      courses: coursesWithModules,
      books,
      notes,
      flashcards,
      concepts: graph.nodes,
      // El trabajo práctico forma parte del corpus indexable: misma vía que el
      // resto de fuentes, sin una segunda abstracción de indexación.
      practiceWork
    };
  },
  async importDocument(params: {
    title: string;
    author?: string;
    fileType: 'txt' | 'md' | 'pdf' | 'epub';
    fileName: string;
    fingerprint: string;
    category?: string;
    pageCount?: number;
    sections: Array<{ title?: string; page?: number; chapter?: string; content: string }>;
    importAsBook?: boolean;
    destination?: {
      type: 'standalone' | 'course' | 'module' | 'lesson' | 'book';
      targetId?: string;
      targetTitle?: string;
    };
  }): Promise<string> {
    const db = dbBridge.getDatabase();
    const resourceId = `doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const category = params.category || (params.importAsBook ? 'Lecturas' : 'Documentos');
    const sourcePath = `local://${params.fileName}#sha256=${params.fingerprint}`;
    const destination = params.destination || { type: params.importAsBook ? 'book' : 'standalone' };

    // Determinar resource_id y lesson_id destino para las notas creadas
    let linkedResourceId: string | null = null;
    let linkedLessonId: string | null = null;

    if (destination.type === 'lesson' && destination.targetId) {
      linkedLessonId = destination.targetId;
      // Consultar el resource_id de la lección
      const lesRow = db.exec(`
        SELECT m.course_id FROM lesson l
        JOIN module m ON l.module_id = m.id
        WHERE l.id = ?
      `, [destination.targetId]);
      if (lesRow.length && lesRow[0].values.length) {
        linkedResourceId = lesRow[0].values[0][0] as string;
      }
    } else if (destination.type === 'course' && destination.targetId) {
      linkedResourceId = destination.targetId;
    } else if (destination.type === 'book' && destination.targetId) {
      linkedResourceId = destination.targetId;
    } else {
      // Standalone o nuevo libro: siempre registrar como learning_resource canónico
      linkedResourceId = resourceId;
      const resourceType = params.importAsBook ? 'book' : 'learning_resource';

      db.run(
        `INSERT INTO learning_resource (id, title, description, category, status, source_path, type)
         VALUES (?, ?, ?, ?, 'NOT_STARTED', ?, ?)`,
        [
          resourceId,
          params.title,
          `Documento importado localmente: ${params.fileName} (${params.fileType.toUpperCase()})`,
          category,
          sourcePath,
          resourceType
        ]
      );

      if (params.importAsBook) {
        const pageCount = params.pageCount || params.sections.length || 1;
        db.run(
          `INSERT INTO book (id, author, page_count, current_page, reading_percentage)
           VALUES (?, ?, ?, 0, 0.0)`,
          [
            resourceId,
            params.author || 'Autor local',
            pageCount
          ]
        );
      }
    }

    // Crear notas con el contenido extraído vinculadas al recurso o lección destino
    for (let i = 0; i < params.sections.length; i++) {
      const sec = params.sections[i];
      const noteId = `note-${resourceId}-${i + 1}`;
      const noteTitle = sec.title || (sec.chapter ? `${params.title} · ${sec.chapter}` : `${params.title} (pág. ${sec.page || i + 1})`);
      const tags = `documento,${params.fileType},sha256:${params.fingerprint}${sec.page ? `,pág:${sec.page}` : ''}${destination.type !== 'standalone' ? `,asociado:${destination.type}` : ''}`;
      
      db.run(
        `INSERT INTO note (id, resource_id, lesson_id, title, content, tags)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          noteId,
          linkedResourceId,
          linkedLessonId,
          noteTitle,
          sec.content,
          tags
        ]
      );
    }

    await dbBridge.persist();
    return resourceId;
  }
};
