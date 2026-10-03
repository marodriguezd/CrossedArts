import { dbBridge } from './sqliteBridge.ts';
import type { Course, Book, LearningResource, KPIMetrics, Flashcard, Note, ConceptNode, ConceptEdge, Lesson, Module, LearningSession, TodayStudySummary, StudySessionMode, StudySessionStatus, GraphNodeType, KnowledgeConnection, SearchResult, UnorganizedResource, CourseDifficulty, LessonType, ResourceKind, ResourceDetail, ResourceFragment, RelatedKnowledgeItem, LessonWorkspace, LessonProgressState } from '../types/models.ts';
import { calculateBookProgress, calculateSM2, validateKnowledgeConnection } from '../services/domainLogic.ts';
import type { SM2Result } from '../services/domainLogic.ts';

const SESSION_LIVE_DURATION_SQL = `duration_minutes = CASE
  WHEN (cards_reviewed + questions_answered) > 0
  THEN MAX(1, CAST(ROUND((strftime('%s','now') - strftime('%s', started_at)) / 60.0) AS INTEGER))
  ELSE 0 END`;

function mapLearningSessionRow(row: any[]): LearningSession {
  return {
    id: String(row[0]),
    resource_id: row[1] ? String(row[1]) : undefined,
    started_at: String(row[2]),
    ended_at: row[3] ? String(row[3]) : undefined,
    duration_minutes: Number(row[4]) || 0,
    inactive_seconds: Number(row[5]) || 0,
    mode: (row[6] as StudySessionMode) || 'flashcards',
    cards_reviewed: Number(row[7]) || 0,
    questions_answered: Number(row[8]) || 0,
    correct_answers: Number(row[9]) || 0,
    status: (row[10] as StudySessionStatus) || 'completed',
    resource_title: row[11] ? String(row[11]) : undefined,
    lesson_id: row[12] ? String(row[12]) : undefined,
    lesson_title: row[13] ? String(row[13]) : undefined
  };
}

const SESSION_SELECT = `SELECT s.id, s.resource_id, s.started_at, s.ended_at, s.duration_minutes,
  s.inactive_seconds, s.mode, s.cards_reviewed, s.questions_answered, s.correct_answers, s.status,
  r.title AS resource_title, s.lesson_id, les.title AS lesson_title
  FROM learning_session s
  LEFT JOIN learning_resource r ON s.resource_id = r.id
  LEFT JOIN lesson les ON s.lesson_id = les.id`;

export const dao = {
  async getKPIs(): Promise<KPIMetrics> {
    const db = dbBridge.getDatabase();
    const resTotal = db.exec("SELECT COUNT(*) FROM learning_resource")[0]?.values[0][0] as number || 0;
    const resCompleted = db.exec("SELECT COUNT(*) FROM learning_resource WHERE status = 'COMPLETED'")[0]?.values[0][0] as number || 0;
    const studyMins = db.exec("SELECT SUM(duration_minutes) FROM learning_session")[0]?.values[0][0] as number || 0;
    const pendingReviews = db.exec("SELECT COUNT(*) FROM flashcard WHERE datetime(due_date) <= datetime('now')")[0]?.values[0][0] as number || 0;

    // Cálculo dinámico y real de racha de estudio basado en learning_session
    const streakDays = await this.getActiveStreak();
    const today = await this.getTodayStudySummary();

    return {
      total_resources: resTotal,
      completed_resources: resCompleted,
      total_study_hours: Number((studyMins / 60).toFixed(1)),
      active_streak_days: streakDays,
      pending_reviews: pendingReviews,
      today
    };
  },

  async getTodayStudySummary(): Promise<TodayStudySummary> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT COALESCE(SUM(cards_reviewed), 0), COALESCE(SUM(questions_answered), 0), COALESCE(SUM(correct_answers), 0)
      FROM learning_session
      WHERE date(started_at) = date('now')
    `);
    const row = res.length ? res[0].values[0] : [0, 0, 0];
    const flashcards = Number(row[0]) || 0;
    const questions = Number(row[1]) || 0;
    return {
      items_reviewed: flashcards + questions,
      flashcards_reviewed: flashcards,
      questions_answered: questions,
      correct_answers: Number(row[2]) || 0
    };
  },

  async getRecentStudySessions(limit: number = 5): Promise<LearningSession[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`${SESSION_SELECT}
      WHERE s.status = 'completed' AND s.resource_id IS NOT NULL
      ORDER BY datetime(s.started_at) DESC, s.id DESC
      LIMIT ?`, [Math.max(1, Math.floor(limit))]);
    if (!res.length) return [];
    return res[0].values.map(mapLearningSessionRow);
  },

  async getDueFlashcards(resourceId?: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const base = `SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed
      FROM flashcard WHERE datetime(due_date) <= datetime('now')`;
    const res = resourceId
      ? db.exec(`${base} AND resource_id = ? ORDER BY datetime(due_date) ASC, id ASC`, [resourceId])
      : db.exec(`${base} ORDER BY datetime(due_date) ASC, id ASC`);
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0],
      resource_id: r[1] ?? undefined,
      front: r[2],
      back: r[3],
      repetition_count: r[4],
      interval_days: r[5],
      ease_factor: r[6],
      due_date: r[7],
      last_reviewed: r[8] ?? undefined
    }));
  },

  async startStudySession(params: { mode: StudySessionMode; resourceId?: string; lessonId?: string }): Promise<string> {
    const db = dbBridge.getDatabase();
    const id = `ss_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    db.run(
      `INSERT INTO learning_session
        (id, resource_id, lesson_id, started_at, mode, status, duration_minutes, inactive_seconds, cards_reviewed, questions_answered, correct_answers)
       VALUES (?, ?, ?, datetime('now'), ?, 'active', 0, 0, 0, 0, 0)`,
      [id, params.resourceId || null, params.lessonId || null, params.mode]
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

  async getActiveStudySession(): Promise<LearningSession | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`${SESSION_SELECT}
      WHERE s.status = 'active'
      ORDER BY datetime(s.started_at) DESC, s.id DESC
      LIMIT 1`);
    if (!res.length || !res[0].values.length) return null;
    return mapLearningSessionRow(res[0].values[0]);
  },

  async getStudySessionById(id: string): Promise<LearningSession | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`${SESSION_SELECT} WHERE s.id = ?`, [id]);
    if (!res.length || !res[0].values.length) return null;
    return mapLearningSessionRow(res[0].values[0]);
  },

  async recordStudyFlashcardReview(sessionId: string): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      `UPDATE learning_session
       SET cards_reviewed = cards_reviewed + 1, ${SESSION_LIVE_DURATION_SQL}
       WHERE id = ? AND status = 'active'`,
      [sessionId]
    );
    await dbBridge.persist();
  },

  async recordStudyQuestionAnswer(sessionId: string, correct: boolean): Promise<void> {
    const db = dbBridge.getDatabase();
    db.run(
      `UPDATE learning_session
       SET questions_answered = questions_answered + 1,
           correct_answers = correct_answers + ?,
           ${SESSION_LIVE_DURATION_SQL}
       WHERE id = ? AND status = 'active'`,
      [correct ? 1 : 0, sessionId]
    );
    await dbBridge.persist();
  },

  /**
   * Finaliza la sesión. Solo la marca como `completed` si hubo actividad real de
   * estudio (tarjetas o preguntas); de lo contrario queda como `cancelled`.
   * Lanza si la persistencia falla, de modo que la UI nunca reporte una
   * finalización que no se guardó.
   */
  async finalizeStudySession(sessionId: string): Promise<StudySessionStatus> {
    const db = dbBridge.getDatabase();
    const active = db.exec("SELECT duration_minutes FROM learning_session WHERE id = ? AND status = 'active'", [sessionId]);
    if (!active.length || !active[0].values.length) {
      const current = db.exec('SELECT status FROM learning_session WHERE id = ?', [sessionId]);
      return (current.length && current[0].values.length ? (current[0].values[0][0] as StudySessionStatus) : 'cancelled');
    }
    const prevDuration = Number(active[0].values[0][0]) || 0;
    db.run(
      `UPDATE learning_session
       SET ended_at = datetime('now'),
           status = CASE WHEN (cards_reviewed + questions_answered) > 0 THEN 'completed' ELSE 'cancelled' END,
           duration_minutes = CASE
             WHEN (cards_reviewed + questions_answered) > 0
             THEN MAX(1, CAST(ROUND((strftime('%s','now') - strftime('%s', started_at)) / 60.0) AS INTEGER))
             ELSE 0 END
       WHERE id = ? AND status = 'active'`,
      [sessionId]
    );
    try {
      await dbBridge.persist();
    } catch (err) {
      // Revertir el cambio en memoria: la sesión sigue activa y la UI no reporta
      // una finalización que no llegó a persistirse.
      db.run("UPDATE learning_session SET status = 'active', ended_at = NULL, duration_minutes = ? WHERE id = ?", [prevDuration, sessionId]);
      throw err;
    }
    const res = db.exec('SELECT status FROM learning_session WHERE id = ?', [sessionId]);
    return (res.length && res[0].values.length ? (res[0].values[0][0] as StudySessionStatus) : 'cancelled');
  },

  async cancelStudySession(sessionId: string): Promise<void> {
    const db = dbBridge.getDatabase();
    const active = db.exec("SELECT duration_minutes FROM learning_session WHERE id = ? AND status = 'active'", [sessionId]);
    if (!active.length || !active[0].values.length) return;
    const prevDuration = Number(active[0].values[0][0]) || 0;
    db.run(
      `UPDATE learning_session
       SET ended_at = datetime('now'),
           status = 'cancelled',
           duration_minutes = CASE
             WHEN (cards_reviewed + questions_answered) > 0
             THEN MAX(1, CAST(ROUND((strftime('%s','now') - strftime('%s', started_at)) / 60.0) AS INTEGER))
             ELSE 0 END
       WHERE id = ? AND status = 'active'`,
      [sessionId]
    );
    try {
      await dbBridge.persist();
    } catch (err) {
      db.run("UPDATE learning_session SET status = 'active', ended_at = NULL, duration_minutes = ? WHERE id = ?", [prevDuration, sessionId]);
      throw err;
    }
  },

  async getActiveStreak(): Promise<number> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`
      SELECT DISTINCT date(started_at)
      FROM learning_session
      WHERE duration_minutes > 0
      ORDER BY date(started_at) DESC
    `);

    if (!res.length || !res[0].values.length) return 0;

    const dates = new Set(res[0].values.map(row => String(row[0])));
    const todayRes = db.exec("SELECT date('now')");
    const todayStr = String(todayRes[0]?.values[0][0]);

    let checkDate = new Date(`${todayStr}T00:00:00Z`);
    const formatDate = (d: Date) => d.toISOString().slice(0, 10);

    let currentStr = formatDate(checkDate);
    // Si no hubo sesión hoy, comprobar si hubo ayer para mantener la racha activa
    if (!dates.has(currentStr)) {
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
      currentStr = formatDate(checkDate);
      if (!dates.has(currentStr)) {
        return 0;
      }
    }

    let streak = 0;
    while (dates.has(currentStr)) {
      streak++;
      checkDate.setUTCDate(checkDate.getUTCDate() - 1);
      currentStr = formatDate(checkDate);
    }

    return streak;
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
    const courses = await this.getCourses();
    const course = courses.find(c => c.id === id) || null;
    if (!course) return null;

    const db = dbBridge.getDatabase();
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
    const res = db.exec('SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date FROM flashcard');
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0],
      resource_id: r[1],
      front: r[2],
      back: r[3],
      repetition_count: r[4],
      interval_days: r[5],
      ease_factor: r[6],
      due_date: r[7]
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

  async createFlashcards(cards: Array<{ resource_id?: string; front: string; back: string }>): Promise<string[]> {
    if (!cards || cards.length === 0) return [];
    const db = dbBridge.getDatabase();
    const insertedIds: string[] = [];

    for (const card of cards) {
      const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO flashcard (id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date)
         VALUES (?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
        [id, card.resource_id || null, card.front, card.back]
      );
      insertedIds.push(id);
    }

    await dbBridge.persist();
    return insertedIds;
  },

  /**
   * Construye el grafo de conocimiento canónico desde SQLite: conceptos y
   * recursos de aprendizaje (cursos/libros/recursos), módulos, lecciones y notas,
   * más las aristas estructurales derivadas de claves foráneas y las conexiones
   * explícitas definidas por el usuario en `knowledge_connection`.
   */
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
    const resRes = db.exec('SELECT id, title, description, type, category, status, source_path, created_at FROM learning_resource');
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
            created_at: r[7] ? String(r[7]) : undefined
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
    const noteRes = db.exec('SELECT id, resource_id, lesson_id, title, tags, created_at FROM note');
    if (noteRes.length) {
      for (const r of noteRes[0].values) {
        addNode({
          id: String(r[0]),
          name: String(r[3]),
          node_type: 'note',
          meta: { resource_id: r[1] ? String(r[1]) : undefined, lesson_id: r[2] ? String(r[2]) : undefined, tags: r[4] ? String(r[4]) : undefined, created_at: r[5] ? String(r[5]) : undefined }
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

  /**
   * Crea una conexión explícita validada entre dos nodos existentes del grafo.
   */
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

  /**
   * Elimina conexiones explícitas cuyos extremos ya no existen (evita aristas huérfanas).
   */
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
    return ids;
  },

  // ---------------------------------------------------------------------------
  // Organización manual de cursos, módulos y lecciones (Iteración 13)
  // ---------------------------------------------------------------------------

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

  /**
   * Reordena deterministamente las lecciones de un módulo intercambiando su
   * `order_index` con el vecino adyacente. No deja posiciones duplicadas y
   * normaliza la secuencia a 1..N.
   */
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

  /**
   * Devuelve la siguiente lección determinista para "continuar aprendiendo" en
   * un curso: primera lección incompleta por orden de módulo y lección. Si todas
   * están completas, devuelve la última lección. Sin puntuaciones ni adaptabilidad.
   */
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

  /**
   * Espacio de trabajo de la lección: contenido, notas, recursos, conceptos y
   * progreso determinista, reutilizando el modelo relacional existente.
   */
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
    const related = await this.getRelatedKnowledge(lessonId);

    const resources = related.filter(r => r.type === 'resource' || r.type === 'book' || r.type === 'course' || r.type === 'lesson' || r.type === 'module');
    const concepts = related.filter(r => r.type === 'concept');
    const relatedBooks = related.filter(r => r.type === 'book');

    // "Actividad" significa contenido propio, notas o relaciones explícitas creadas
    // por el usuario. La mera pertenencia estructural (estar en un módulo/curso) no
    // cuenta como progreso, para no inventar un porcentaje sin significado.
    const hasOwnContent = Boolean(lesson.content && lesson.content.trim().length > 0);
    const hasExplicitRelation = related.some(r => !r.derived);
    const hasActivity = hasOwnContent || notes.length > 0 || hasExplicitRelation;
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

  async getNotesForResource(resourceId: string, lessonId?: string): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    // Cuando se especifica una lección, el resultado se acota estrictamente a esa
    // lección. El antiguo `resource_id = ? OR lesson_id = ?` devolvía notas de
    // OTRAS lecciones del mismo curso (que comparten `resource_id`), lo que
    // contaminaba el espacio de trabajo de la lección y su estado de progreso.
    const res = lessonId
      ? db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE lesson_id = ? ORDER BY updated_at DESC', [lessonId])
      : db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE resource_id = ? ORDER BY updated_at DESC', [resourceId]);
    if (!res.length) return [];
    return res[0].values.map((r: any[]) => ({
      id: r[0], resource_id: r[1], lesson_id: r[2], title: r[3], content: r[4], tags: r[5], created_at: r[6], updated_at: r[7]
    }));
  },

  /**
   * Notas asociadas EXCLUSIVAMENTE a una lección (`lesson_id = ?`). Query precisa
   * y sin ambigüedad usada por el espacio de trabajo de la lección, de modo que
   * nunca hereda notas de otras lecciones del mismo curso.
   */
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

  /**
   * Recursos de aprendizaje importados (standalone) que aún no están asociados a
   * ningún otro nodo mediante conexiones explícitas.
   */
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

  /**
   * Búsqueda local determinista (SQL LIKE) sin embeddings: encuentra cursos,
   * libros, lecciones, notas, conceptos y recursos importados al instante.
   */
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

  /** Determina el tipo canónico de un nodo abrible sin cargar todo el grafo. */
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

  async getNoteById(id: string): Promise<Note | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const r = res[0].values[0];
    return { id: String(r[0]), resource_id: r[1] ? String(r[1]) : undefined, lesson_id: r[2] ? String(r[2]) : undefined, title: String(r[3]), content: String(r[4]), tags: r[5] ? String(r[5]) : undefined, created_at: String(r[6]), updated_at: String(r[7]) };
  },

  async getConceptById(id: string): Promise<{ id: string; name: string; description?: string } | null> {
    const db = dbBridge.getDatabase();
    const res = db.exec('SELECT id, name, description FROM concept WHERE id = ?', [id]);
    if (!res.length || !res[0].values.length) return null;
    const r = res[0].values[0];
    return { id: String(r[0]), name: String(r[1]), description: r[2] ? String(r[2]) : undefined };
  },

  /**
   * Resuelve títulos y tipos de un conjunto acotado de ids sin construir el grafo
   * completo (respeta el rendimiento al abrir un detalle concreto).
   */
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

    return map;
  },

  /**
   * Conocimiento relacionado con un nodo usando conexiones explícitas y claves
   * foráneas existentes. Nunca inventa relaciones automáticas.
   */
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

    const summaries = await this.getNodeSummaries(related.map(r => r.id));
    return related.map(item => {
      const s = summaries.get(item.id);
      return { ...item, title: s?.title || item.id, type: s?.type || 'resource' };
    });
  },

  /** Conceptos conectados (explícita o estructuralmente) a cualquiera de los nodos dados. */
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

  /**
   * Vista de detalle unificada para libros, recursos importados y conceptos.
   * Consulta solo los datos necesarios: no carga el grafo completo.
   */
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
    const id = 'note-' + Date.now();
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

  async getAllLearningResources() {
    const [courses, books, notes, flashcards, graph] = await Promise.all([
      this.getCourses(),
      this.getBooks(),
      this.getNotes(),
      this.getFlashcards(),
      this.getKnowledgeGraph()
    ]);

    // Poblar módulos para cada curso si no los tienen
    const coursesWithModules = await Promise.all(
      courses.map(async (c) => (await this.getCourseById(c.id)) || c)
    );

    return {
      courses: coursesWithModules,
      books,
      notes,
      flashcards,
      concepts: graph.nodes
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
    const resourceId = `doc-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
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

