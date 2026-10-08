/**
 * Proyección y orden de `practice_work`.
 *
 * El orden de atención (en marcha, planificado, terminado) es determinista y se
 * expresa en SQL: no depende de cargar filas en memoria ni del orden de un mapa.
 */

/**
 * Orden de atención del trabajo práctico: lo que está en marcha primero, lo
 * planificado después y lo terminado al final. Se expresa en SQL (CASE) para que
 * el orden sea determinista sin cargar todas las filas en memoria.
 */
export const PRACTICE_WORK_ORDER_SQL = `ORDER BY CASE status
  WHEN 'IN_PROGRESS' THEN 0
  WHEN 'PLANNED' THEN 1
  ELSE 2 END, updated_at DESC`;

export const PRACTICE_WORK_COLUMNS =
  'id, title, description, resource_id, lesson_id, concept_id, kind, status, artifact_url, notes, self_rating, completed_at, created_at, updated_at, content, checklist';


