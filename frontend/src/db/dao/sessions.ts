/**
 * Sesiones de estudio: KPIs, actividad diaria, ciclo de vida y analítica.
 *
 * Ámbito de dominio (regla única en `services/sessionScope.ts`): una sesión es
 * de LECCIÓN, de RECURSO o GLOBAL (repaso transversal sin anclas). El ámbito se
 * persiste explícito y se deriva de las anclas al escribir.
 *
 * Este módulo no conoce el resto del dominio: usa `dbBridge` y las constantes
 * de proyección propias. Las llamadas a métodos hermanos (`this.*`) las resuelve
 * el objeto `dao` compuesto que lo incorpora.
 */
import { dbBridge } from '../sqliteBridge.ts';
import {
  SESSION_SELECT,
  SESSION_LIVE_DURATION_SQL
} from './sessionQueries.ts';
import { mapLearningSessionRow } from './sqlRows.ts';
import { resolveLocalDay, computeActiveStreak } from '../../services/localDate.ts';
import { generateDailyActivitySeries } from '../../services/domainLogic.ts';
import type {
  DailyActivityPoint,
  KPIMetrics,
  LearningSession,
  StudySessionStatus,
  TimeRangeFilter,
  TodayStudySummary
} from '../../types/models.ts';

export const sessionDao = {
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
    // Una sesión completada es historial de aprendizaje en los TRES ámbitos
    // canónicos: lección, recurso y global (repaso transversal). Se mantiene el
    // filtro por `status` (una sesión cancelada o sin actividad no es historial)
    // y ya no se descarta el ámbito global, que es una sesión legítima y
    // explícita, no una sesión "sin ámbito". No se inventa ningún resource_id:
    // `resource_title` y `lesson_title` siguen resolviendose por LEFT JOIN.
    const res = db.exec(`${SESSION_SELECT}
      WHERE s.status = 'completed'
      ORDER BY datetime(s.started_at) DESC, s.id DESC
      LIMIT ?`, [Math.max(1, Math.floor(limit))]);
    if (!res.length) return [];
    return res[0].values.map(mapLearningSessionRow);
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
};
