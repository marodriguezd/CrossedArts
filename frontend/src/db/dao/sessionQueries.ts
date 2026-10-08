/**
 * Constantes SQL de la sesión de estudio y su mapeo de fila.
 *
 * La proyección y el cálculo de duración viven aquí para que el módulo de
 * sesiones y el resto del DAO compartan exactamente la misma lectura.
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
