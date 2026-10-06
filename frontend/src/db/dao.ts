import { dbBridge } from './sqliteBridge.ts';
import type { Course, Book, LearningResource, KPIMetrics, Flashcard, Note, ConceptNode, ConceptEdge, Lesson, LearningSession, TodayStudySummary, StudySessionMode, StudySessionStatus, GraphNodeType, KnowledgeConnection, SearchResult, UnorganizedResource, CourseDifficulty, LessonType, ResourceKind, ResourceDetail, ResourceFragment, RelatedKnowledgeItem, LessonWorkspace, LessonProgressState, DailyActivityPoint, TimeRangeFilter, PracticeWork, PracticeWorkKind, PracticeWorkStatus, PracticeChecklistItem, LearningGoal, GoalKind, GoalStatus } from '../types/models.ts';
import { calculateBookProgress, calculateSM2, validateKnowledgeConnection, generateDailyActivitySeries } from '../services/domainLogic.ts';
import { parsePracticeChecklist, serializePracticeChecklist } from '../services/practiceWork.ts';
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
import { resolveLocalDay, computeActiveStreak } from '../services/localDate.ts';
import type { SM2Result } from '../services/domainLogic.ts';

const SESSION_LIVE_DURATION_SQL = `duration_minutes = CASE
  WHEN (cards_reviewed + questions_answered) > 0
  THEN MAX(1, CAST(ROUND((strftime('%s','now') - strftime('%s', started_at)) / 60.0) AS INTEGER))
  ELSE 0 END`;

/**
 * Orden de atención del trabajo práctico: lo que está en marcha primero, lo
 * planificado después y lo terminado al final. Se expresa en SQL (CASE) para que
 * el orden sea determinista sin cargar todas las filas en memoria.
 */
const PRACTICE_WORK_ORDER_SQL = `ORDER BY CASE status
  WHEN 'IN_PROGRESS' THEN 0
  WHEN 'PLANNED' THEN 1
  ELSE 2 END, updated_at DESC`;

const PRACTICE_WORK_COLUMNS =
  'id, title, description, resource_id, lesson_id, concept_id, kind, status, artifact_url, notes, self_rating, completed_at, created_at, updated_at, content, checklist';

/* La lista de verificación se parsea/serializa con los helpers puros de
 * services/practiceWork.ts: la base de datos guarda JSON y la lógica de
 * conversión vive en un módulo probable, no dentro del DAO. */

/** Convierte un valor de sql.js en texto nullable (o null). */
function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Convierte un valor de sql.js en número nullable, rechazando lo no numérico. */
function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Mapea una fila cruda de `practice_work` a un objeto de dominio tipado. */
function mapPracticeWorkRow(row: readonly unknown[]): PracticeWork {
  const r = new SqlRow(row);
  return {
    id: r.str(0),
    title: r.str(1),
    description: r.optionalStr(2),
    resource_id: r.optionalStr(3),
    lesson_id: r.optionalStr(4),
    concept_id: r.optionalStr(5),
    kind: (r.optionalStr(6) as PracticeWorkKind) || 'exercise',
    status: (r.optionalStr(7) as PracticeWorkStatus) || 'PLANNED',
    artifact_url: r.optionalStr(8),
    notes: r.optionalStr(9),
    self_rating: r.optionalStr(10) === undefined ? undefined : r.num(10),
    completed_at: r.optionalStr(11),
    created_at: r.optionalStr(12),
    updated_at: r.optionalStr(13),
    content: r.optionalStr(14),
    checklist: parsePracticeChecklist(r.optionalStr(15)) ?? undefined
  };
}

/**
 * Fila SQL cruda de `learning_session` (frontera de datos no confiables).
 *
 * sql.js devuelve `unknown[][]`; esta tupla documenta la posición de cada
 * columna y fuerza la validación explícita de tipos en el mapeador. Toda
 * conversión pasa por `asSqlType`, que rechaza null/undefined para campos no
 * anulables en lugar de propagar `null` silenciosamente.
 */
type SqlValue = unknown;

class SqlRow {
  private readonly row: readonly SqlValue[];

  constructor(row: readonly SqlValue[]) {
    this.row = row;
  }

  str(index: number): string {
    const v = this.row[index];
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new Error(`Fila SQL inválida: se esperaba texto en la posición ${index}`);
    }
    return String(v);
  }

  optionalStr(index: number): string | undefined {
    const v = this.row[index];
    return v === null || v === undefined ? undefined : this.str(index);
  }

  num(index: number, fallback = 0): number {
    const v = this.row[index];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  bool(index: number): boolean {
    return this.num(index) === 1;
  }
}

function mapLearningSessionRow(row: readonly unknown[]): LearningSession {
  const r = new SqlRow(row);
  return {
    id: r.str(0),
    resource_id: r.optionalStr(1),
    started_at: r.str(2),
    ended_at: r.optionalStr(3),
    duration_minutes: r.num(4),
    inactive_seconds: r.num(5),
    mode: (r.str(6) as StudySessionMode) || 'flashcards',
    cards_reviewed: r.num(7),
    questions_answered: r.num(8),
    correct_answers: r.num(9),
    status: (r.str(10) as StudySessionStatus) || 'completed',
    resource_title: r.optionalStr(11),
    lesson_id: r.optionalStr(12),
    lesson_title: r.optionalStr(13)
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
    // El "día de hoy" es el día calendario LOCAL del usuario, resuelto en
    // JavaScript y pasado como parámetro. Antes se usaba `date('now')` (UTC),
    // lo que desplazaba el día de estudio respecto al reloj del usuario.
    const { day, utcOffsetModifier } = resolveLocalDay();
    const res = db.exec(`
      SELECT COALESCE(SUM(cards_reviewed), 0), COALESCE(SUM(questions_answered), 0), COALESCE(SUM(correct_answers), 0)
      FROM learning_session
      WHERE date(started_at, ?) = ?
    `, [utcOffsetModifier, day]);
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

  /**
   * Obtiene la serie temporal agregada por día calendario local para gráficos de actividad.
   */
  async getDailyActivitySeries(range: TimeRangeFilter = '7d'): Promise<DailyActivityPoint[]> {
    const db = dbBridge.getDatabase();
    const { day: todayStr, utcOffsetModifier } = resolveLocalDay();

    const res = db.exec(`
      SELECT date(started_at, ?) AS study_day,
             COALESCE(SUM(duration_minutes), 0) AS total_minutes,
             COALESCE(SUM(cards_reviewed + questions_answered), 0) AS total_reviews
      FROM learning_session
      WHERE (cards_reviewed + questions_answered) > 0 OR duration_minutes > 0
      GROUP BY study_day
      ORDER BY study_day ASC
    `, [utcOffsetModifier]);

    const history: Array<{ date: string; minutes: number; reviews: number }> = [];
    if (res.length && res[0].values.length) {
      for (const row of res[0].values) {
        history.push({
          date: String(row[0]),
          minutes: Number(row[1]) || 0,
          reviews: Number(row[2]) || 0
        });
      }
    }

    return generateDailyActivitySeries(history, range, todayStr);
  },

  async getRecentStudySessions(limit: number = 5): Promise<LearningSession[]> {
    const db = dbBridge.getDatabase();
    // Una sesión completada es válida si tiene ámbito de RECURSO o de LECCIÓN.
    // Antes el filtro exigía `resource_id IS NOT NULL`, lo que descartaba una
    // sesión con ámbito de lección cuyo `resource_id` es nulo: el historial
    // reciente del Dashboard perdía actividad real. No se inventa ningún
    // resource_id; `lesson_title` sigue resolviendose por LEFT JOIN.
    const res = db.exec(`${SESSION_SELECT}
      WHERE s.status = 'completed' AND (s.resource_id IS NOT NULL OR s.lesson_id IS NOT NULL)
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

  /**
   * Racha de estudio activa en días consecutivos.
   *
   * Los días de estudio se etiquetan con el DÍA CALENDARIO LOCAL del usuario
   * (offset calculado en JavaScript y pasado como parámetro), no con el día UTC.
   * La aritmética de días consecutivos es pura y se hace sobre las cadenas
   * `YYYY-MM-DD`, de modo que no depende del huso horario del proceso.
   */
  async getActiveStreak(): Promise<number> {
    const db = dbBridge.getDatabase();
    const { day: todayStr, utcOffsetModifier } = resolveLocalDay();
    const res = db.exec(`
      SELECT DISTINCT date(started_at, ?) AS study_day
      FROM learning_session
      WHERE duration_minutes > 0
      ORDER BY study_day DESC
    `, [utcOffsetModifier]);

    if (!res.length || !res[0].values.length) return 0;

    const dates = new Set(res[0].values.map(row => String(row[0])));
    return computeActiveStreak(dates, todayStr);
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

  /**
   * Índice plano de lecciones con su curso y módulo, en UNA sola consulta.
   *
   * Existe para la recuperación RAG: antes, `retrieveLocalContext()` llamaba a
   * `getCourseById()` por cada curso y cada llamada re-ejecutaba `getCourses()`
   * (un escaneo completo de recursos) más una consulta por módulo. Con N cursos
   * y M módulos eso es O(N*M) consultas y N reconstrucciones completas de la
   * jerarquía. Esta versión resuelve la misma información en 2 consultas
   * fijas, sin cambiar el modelo de datos ni el orden determinista.
   */
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

  /**
   * Indice plano de TODOS los conceptos en una sola consulta, para que la paleta
   * de comandos (Ctrl+K) pueda filtrar en memoria sin golpear SQL en cada
   * pulsacion. Espejo de `getLessonIndex()`: consulta unica, orden determinista
   * y sin `N+1`. No modifica datos ni requiere esquema nuevo.
   */
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

  /**
   * Indice plano de los RECURSOS IMPORTADOS en una sola consulta para la paleta.
   *
   * `getCourses()` y `getBooks()` ya cubren los recursos de tipo `course` y `book`,
   * asi que aqui solo interesan los demás: PDF, EPUB, Markdown o texto que el
   * usuario importados. Antes eran inalcanzables desde Ctrl+K, aunque si se
   * encuentras en la busqueda de la Biblioteca, son nodos de primera clase del
   * grafo y tienen vista propia en `ResourceDetail`. Un punto de entrada global
   * que no llega al contenido del usuario no es global.
   *
   * Mismo contrato que sus hermanos: consulta unica, orden determinista, sin
   * `N+1`, sin tocar datos y sin esquema nuevo.
   */
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

  /**
   * Indice plano del TRABAJO PRACTICO en una sola consulta, para la paleta de
   * comandos (Ctrl+K).
   *
   * El trabajo practico ya es un artefacto de primera clase en la galeria del
   * panel y un nodo del grafo, asi que dejarlo fuera de la busqueda global era
   * una inconsistencia: no se podia encontrar un ensayo o un proyecto por su
   * titulo. No tiene vista propia, asi que cada fila viaja con su contexto de
   * origen para poder abrirlo donde vive (misma decision que el grafo).
   *
   * Mismo contrato que `getLessonIndex()`/`getResourceIndex()`: consulta unica con
   * JOIN (sin `N+1`), orden determinista, sin tocar datos y sin esquema nuevo.
   */
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

  async getFlashcardsForLesson(lessonId: string): Promise<Flashcard[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `SELECT id, resource_id, lesson_id, front, back, repetition_count, interval_days, ease_factor, due_date, last_reviewed
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
      last_reviewed: r[9] ? String(r[9]) : undefined
    }));
  },

  async createFlashcard(card: { resource_id?: string; lesson_id?: string; front: string; back: string }): Promise<{ success: boolean; id?: string; error?: string }> {
    const front = card.front.trim();
    const back = card.back.trim();
    if (!front || !back) {
      return { success: false, error: 'El anverso y el reverso no pueden estar vacíos.' };
    }
    const db = dbBridge.getDatabase();
    const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    db.run(
      `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, repetition_count, interval_days, ease_factor, due_date)
       VALUES (?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
      [id, card.resource_id || null, card.lesson_id || null, front, back]
    );
    await dbBridge.persist();
    return { success: true, id };
  },

  async updateFlashcard(id: string, updates: { front?: string; back?: string }): Promise<{ success: boolean; error?: string }> {
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

  async createFlashcards(cards: Array<{ resource_id?: string; lesson_id?: string; front: string; back: string }>): Promise<string[]> {
    if (!cards || cards.length === 0) return [];
    const db = dbBridge.getDatabase();
    const insertedIds: string[] = [];

    for (const card of cards) {
      const id = `fc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
      db.run(
        `INSERT INTO flashcard (id, resource_id, lesson_id, front, back, repetition_count, interval_days, ease_factor, due_date)
         VALUES (?, ?, ?, ?, ?, 0, 1, 2.5, datetime('now'))`,
        [id, card.resource_id || null, card.lesson_id || null, card.front, card.back]
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
    // El trabajo práctico es un nodo del grafo: sus conexiones manuales no deben
    // podarse como si fueran huérfanas.
    collect('SELECT id FROM practice_work');
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

    const practice = db.exec(`SELECT id, title FROM practice_work WHERE id IN (${ph})`, unique);
    if (practice.length) for (const r of practice[0].values) map.set(String(r[0]), { title: String(r[1]), type: 'practice' });

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
    // Sufijo aleatorio: dos notas creadas en el mismo milisegundo no deben
    // colisionar en la clave primaria (patrón idéntico al resto de entidades).
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

  /* ------------------------------------------------------------------ */
  /* Trabajo práctico (artefactos producidos por el estudiante)          */
  /* ------------------------------------------------------------------ */

  /**
   * Trabajo práctico de un recurso. Con `lessonId` incluye las tareas de esa
   * lección MÁS las del recurso completo (ámbito compartido), nunca las de otras
   * lecciones: mismo criterio de aislamiento que las notas.
   */
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

  /** Conteo por estado del trabajo práctico visible (sin inventar progreso). */
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

  /* ------------------------------------------------------------------ */
  /* Metas de aprendizaje (planificación personal)                        */
  /* ------------------------------------------------------------------ */

  /**
   * Lista las metas ordenadas de forma determinista: activas primero, después
   * por fecha objetivo y finalmente por título+id. El progreso NO se lee de la
   * base: se deriva en la capa de dominio (services/goals.ts).
   */
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

  /**
   * Minutos de estudio registrados (reales), opcionalmente desde una fecha.
   * Se usa para medir metas de tiempo de estudio SIN duplicar persistencia.
   */
  async getStudyMinutesSince(sinceIso?: string): Promise<number> {
    const db = dbBridge.getDatabase();
    const res = sinceIso
      ? db.exec(
          "SELECT COALESCE(SUM(duration_minutes), 0) FROM learning_session WHERE datetime(started_at) >= datetime(?)",
          [sinceIso]
        )
      : db.exec('SELECT COALESCE(SUM(duration_minutes), 0) FROM learning_session');
    return res.length ? Number(res[0].values[0][0]) || 0 : 0;
  },

  /**
   * Sesiones completadas para análisis. Devuelve las MISMAS filas que ya
   * registra `learning_session` (sin estructuras paralelas): la agregación pura
   * ocurre en services/analytics.ts.
   */
  async getSessionsForAnalytics(): Promise<LearningSession[]> {
    const db = dbBridge.getDatabase();
    const res = db.exec(
      `${SESSION_SELECT}
       WHERE s.status = 'completed'
       ORDER BY datetime(s.started_at) ASC, s.id ASC`
    );
    if (!res.length) return [];
    return res[0].values.map(mapLearningSessionRow);
  },

  /* ------------------------------------------------------------------ */
  /* Paquetes de curso (profesor → alumno)                               */
  /* ------------------------------------------------------------------ */

  /**
   * Exporta el MATERIAL de un recurso como paquete portable.
   *
   * Incluye el recurso, su estructura (módulos y lecciones), el trabajo práctico
   * propuesto y los metadatos de curso/libro. Deliberadamente NO incluye notas,
   * sesiones ni progreso: son datos personales del alumno, no material docente.
   */
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

  /**
   * Importa un paquete validado de forma ADITIVA e IDEMPOTENTE.
   *
   * Nunca borra ni sobrescribe: cada fila cuyo id ya exista se omite. Devuelve el
   * recuento de elementos creados y omitidos para poder informar al usuario.
   */
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

