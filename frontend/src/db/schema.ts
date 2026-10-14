/**
 * Canonical DDL for practice work.
 *
 * Practice work is EVIDENCE PRODUCED BY THE LEARNER: not data derived from a
 * resource, so its resource and lesson links use `ON DELETE SET NULL`. Deleting
 * a lesson or resource must NOT destroy the user's work; the artifact is left
 * orphaned but visible and explainable.
 *
 * Exposed as a function so the existing-database migration builds the table
 * with exactly the same definition (a single source of truth).
 */
export function buildPracticeWorkTableSql(tableName: string): string {
  return `CREATE TABLE IF NOT EXISTS ${tableName} (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
  concept_id TEXT REFERENCES concept(id) ON DELETE SET NULL,
  kind TEXT DEFAULT 'exercise',
  status TEXT DEFAULT 'PLANNED',
  artifact_url TEXT,
  notes TEXT,
  self_rating INTEGER,
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  content TEXT,
  checklist TEXT
);`;
}

/** Practice-work indexes (same names for the canonical and migrated tables). */
export const PRACTICE_WORK_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_practice_work_resource ON practice_work(resource_id);
CREATE INDEX IF NOT EXISTS idx_practice_work_lesson ON practice_work(lesson_id);
CREATE INDEX IF NOT EXISTS idx_practice_work_status ON practice_work(status);`;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS learning_resource (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  cover_path TEXT,
  category TEXT DEFAULT 'General',
  status TEXT DEFAULT 'NOT_STARTED',
  source_path TEXT,
  type TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS course (
  id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
  instructor TEXT,
  difficulty TEXT DEFAULT 'BEGINNER',
  total_duration_minutes INTEGER DEFAULT 0,
  total_lessons INTEGER DEFAULT 0,
  completed_lessons INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS book (
  id TEXT PRIMARY KEY REFERENCES learning_resource(id) ON DELETE CASCADE,
  author TEXT,
  isbn TEXT,
  page_count INTEGER,
  current_page INTEGER DEFAULT 0,
  reading_percentage REAL DEFAULT 0.0
);

CREATE TABLE IF NOT EXISTS module (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES course(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  order_index INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lesson (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT,
  order_index INTEGER DEFAULT 0,
  duration_minutes INTEGER DEFAULT 0,
  lesson_type TEXT DEFAULT 'VIDEO',
  media_url TEXT,
  is_completed BOOLEAN DEFAULT 0
);

-- Session scope (canonical rule in services/sessionScope.ts):
--   'lesson'   -> session started in a lesson (resource_id optional)
--   'resource' -> session started in a resource, with no lesson
--   'global'   -> cross-cutting review: no anchors (explicit scope, not absence)
-- On write, the DAO strictly validates scope coherence against its anchors.
-- The database only enforces the value domain and that 'global' never carries
-- an anchor, because ON DELETE SET NULL may unlink the lesson from an already
-- finished lesson session: history is preserved and its scope is reclassified
-- on read (the DAO derives the effective scope from the remaining anchors).
CREATE TABLE IF NOT EXISTS learning_session (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
  scope TEXT NOT NULL DEFAULT 'global'
    CHECK (scope IN ('global', 'resource', 'lesson'))
    CHECK (scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL))
    CHECK (scope <> 'resource' OR resource_id IS NOT NULL),
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME,
  duration_minutes INTEGER DEFAULT 0,
  inactive_seconds INTEGER DEFAULT 0,
  mode TEXT DEFAULT 'flashcards',
  cards_reviewed INTEGER DEFAULT 0,
  questions_answered INTEGER DEFAULT 0,
  correct_answers INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS note (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  tags TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS flashcard (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  card_type TEXT DEFAULT 'standard',
  extra_data TEXT,
  repetition_count INTEGER DEFAULT 0,
  interval_days INTEGER DEFAULT 1,
  ease_factor REAL DEFAULT 2.5,
  due_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_reviewed DATETIME
);

CREATE TABLE IF NOT EXISTS media_asset (
  id TEXT PRIMARY KEY,
  mime_type TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS concept (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS knowledge_connection (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  connection_type TEXT DEFAULT 'related_to',
  weight REAL DEFAULT 1.0
);

-- knowledge_connection is polymorphic (either end may be a concept, resource,
-- course, module, lesson, or note), so foreign keys are deliberately NOT
-- enforced. Existence integrity is validated in the application; the triple
-- unique index prevents exact duplicates and the endpoint indexes speed up
-- pruning of orphaned connections.
CREATE INDEX IF NOT EXISTS idx_knowledge_connection_source ON knowledge_connection(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_connection_target ON knowledge_connection(target_id);

-- Practice work: learner-produced artifacts linked to learning (resource,
-- lesson, or concept). Added ADDITIVELY: the DDL uses IF NOT EXISTS and runs on
-- every open, so existing databases migrate themselves without data loss. Links
-- use SET NULL (see buildPracticeWorkTableSql): deleting the parent must not
-- destroy the user's work. Legacy databases with CASCADE are rebuilt by
-- migratePracticeWorkParentCascade().
${buildPracticeWorkTableSql('practice_work')}
${PRACTICE_WORK_INDEX_SQL}

-- Learning goals: personal planning derived from real data. Progress is NEVER
-- persisted here: it is computed on every read from the linked resource,
-- practice work, or study sessions. Added ADDITIVELY (IF NOT EXISTS on every
-- open): existing databases create the table on their own without touching
-- their data.
CREATE TABLE IF NOT EXISTS learning_goal (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'course',
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
  target_value REAL,
  target_date DATETIME,
  status TEXT NOT NULL DEFAULT 'active',
  completed_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_learning_goal_status ON learning_goal(status);
CREATE INDEX IF NOT EXISTS idx_learning_goal_resource ON learning_goal(resource_id);
-- The 'content' and 'checklist' columns of practice_work exist only in new
-- databases; the idempotent migratePracticeWorkspace() migration adds them to
-- databases created by earlier versions (ALTER TABLE ADD COLUMN).
`;

/**
 * Deterministic unique index on the (source_id, target_id, connection_type)
 * triples. Created in an explicit migration (not in the base DDL) so existing
 * databases can be deduplicated first without breaking initialization.
 */
export const KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_connection_triple ON knowledge_connection(source_id, target_id, connection_type);';

