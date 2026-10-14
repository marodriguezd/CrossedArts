/**
 * SQL constants for the study session and its row mapping.
 *
 * Projection and duration calculation live here so the sessions module and
 * the rest of the DAO share exactly the same read.
 */

export const SESSION_LIVE_DURATION_SQL = `duration_minutes = CASE
  WHEN (cards_reviewed + questions_answered) > 0
  THEN MAX(1, CAST(ROUND((strftime('%s','now') - strftime('%s', started_at)) / 60.0) AS INTEGER))
  ELSE 0 END`;

export const SESSION_SELECT = `SELECT s.id, s.resource_id, s.started_at, s.ended_at, s.duration_minutes,
  s.inactive_seconds, s.mode, s.cards_reviewed, s.questions_answered, s.correct_answers, s.status,
  r.title AS resource_title, s.lesson_id, les.title AS lesson_title, s.scope
  FROM learning_session s
  LEFT JOIN learning_resource r ON s.resource_id = r.id
  LEFT JOIN lesson les ON s.lesson_id = les.id`;
