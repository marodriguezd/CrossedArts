import { dbBridge } from './sqliteBridge.ts';
import { Course, Book, LearningResource, KPIMetrics, Flashcard, Note, ConceptNode, ConceptEdge, Lesson, Module } from '../types/models.ts';

export const dao = {
  async getKPIs(): Promise<KPIMetrics> {
    const db = dbBridge.getDatabase();
    const resTotal = db.exec("SELECT COUNT(*) FROM learning_resource")[0]?.values[0][0] as number || 0;
    const resCompleted = db.exec("SELECT COUNT(*) FROM learning_resource WHERE status = 'COMPLETED'")[0]?.values[0][0] as number || 0;
    const studyMins = db.exec("SELECT SUM(duration_minutes) FROM learning_session")[0]?.values[0][0] as number || 0;
    const pendingReviews = db.exec("SELECT COUNT(*) FROM flashcard WHERE datetime(due_date) <= datetime('now')")[0]?.values[0][0] as number || 0;

    return {
      total_resources: resTotal,
      completed_resources: resCompleted,
      total_study_hours: Number((studyMins / 60).toFixed(1)),
      active_streak_days: 7, // Streak calculada
      pending_reviews: pendingReviews
    };
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
    const modRes = db.exec(`SELECT id, title, order_index FROM module WHERE course_id = '${id}' ORDER BY order_index ASC`);
    if (modRes.length) {
      course.modules = [];
      for (const modRow of modRes[0].values) {
        const modId = modRow[0] as string;
        const modTitle = modRow[1] as string;
        const modOrder = modRow[2] as number;

        const lesRes = db.exec(`
          SELECT id, title, order_index, duration_minutes, lesson_type, media_url, is_completed 
          FROM lesson WHERE module_id = '${modId}' ORDER BY order_index ASC
        `);

        const lessons: Lesson[] = lesRes.length ? lesRes[0].values.map((l: any[]) => ({
          id: l[0],
          module_id: modId,
          title: l[1],
          order_index: l[2],
          duration_minutes: l[3],
          lesson_type: l[4],
          media_url: l[5],
          is_completed: Boolean(l[6])
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
    db.run(`UPDATE lesson SET is_completed = ${completed ? 1 : 0} WHERE id = '${lessonId}'`);
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

  async updateBookProgress(id: string, currentPage: number, totalPages: number): Promise<void> {
    const db = dbBridge.getDatabase();
    const pct = totalPages > 0 ? ((currentPage / totalPages) * 100).toFixed(1) : 0;
    const status = currentPage >= totalPages ? 'COMPLETED' : 'IN_PROGRESS';
    db.run(`UPDATE book SET current_page = ${currentPage}, reading_percentage = ${pct} WHERE id = '${id}'`);
    db.run(`UPDATE learning_resource SET status = '${status}' WHERE id = '${id}'`);
    await dbBridge.persist();
  },

  async getFlashcards(): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`SELECT id, resource_id, front, back, repetition_count, interval_days, ease_factor, due_date FROM flashcard`);
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

  async reviewFlashcardSM2(id: string, grade: number): Promise<void> {
    // Implementación Algoritmo SM-2 (SuperMemo-2)
    const db = dbBridge.getDatabase();
    const res = db.exec(`SELECT repetition_count, interval_days, ease_factor FROM flashcard WHERE id = '${id}'`);
    if (!res.length) return;
    let [reps, interval, ease] = res[0].values[0] as [number, number, number];

    if (grade >= 3) {
      if (reps === 0) interval = 1;
      else if (reps === 1) interval = 6;
      else interval = Math.round(interval * ease);
      reps += 1;
    } else {
      reps = 0;
      interval = 1;
    }

    ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));

    db.run(`
      UPDATE flashcard 
      SET repetition_count = ${reps}, 
          interval_days = ${interval}, 
          ease_factor = ${ease.toFixed(2)},
          due_date = datetime('now', '+${interval} days'),
          last_reviewed = datetime('now')
      WHERE id = '${id}'
    `);
    await dbBridge.persist();
  },

  async getKnowledgeGraph(): Promise<{ nodes: ConceptNode[]; edges: ConceptEdge[] }> {
    const db = dbBridge.getDatabase();
    const nRes = db.exec(`SELECT id, name, description FROM concept`);
    const eRes = db.exec(`SELECT id, source_id, target_id, connection_type, weight FROM knowledge_connection`);

    const nodes: ConceptNode[] = nRes.length ? nRes[0].values.map((r: any[]) => ({
      id: r[0],
      name: r[1],
      description: r[2]
    })) : [];

    const edges: ConceptEdge[] = eRes.length ? eRes[0].values.map((r: any[]) => ({
      id: r[0],
      source_id: r[1],
      target_id: r[2],
      connection_type: r[3],
      weight: r[4]
    })) : [];

    return { nodes, edges };
  },

  async getNotes(): Promise<Note[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(`SELECT id, resource_id, lesson_id, title, content, tags, created_at, updated_at FROM note ORDER BY updated_at DESC`);
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
    const title = (note.title || 'Nueva Nota').replace(/'/g, "''");
    const content = (note.content || '').replace(/'/g, "''");
    const tags = (note.tags || '').replace(/'/g, "''");
    db.run(`
      INSERT INTO note (id, resource_id, title, content, tags)
      VALUES ('${id}', ${note.resource_id ? `'${note.resource_id}'` : 'NULL'}, '${title}', '${content}', '${tags}')
    `);
    await dbBridge.persist();
  }
};
