/**
 * Projection and ordering for `practice_work`.
 */

/**
 * Practice-work attention order: in progress first, then planned, then done
 * last. Expressed in SQL (CASE) so ordering is deterministic without loading
 * every row into memory.
 */
export const PRACTICE_WORK_ORDER_SQL = `ORDER BY CASE status
  WHEN 'IN_PROGRESS' THEN 0
  WHEN 'PLANNED' THEN 1
  ELSE 2 END, updated_at DESC`;

export const PRACTICE_WORK_COLUMNS =
  'id, title, description, resource_id, lesson_id, concept_id, kind, status, artifact_url, notes, self_rating, completed_at, created_at, updated_at, content, checklist';


