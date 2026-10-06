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

CREATE TABLE IF NOT EXISTS learning_session (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE SET NULL,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE SET NULL,
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
  repetition_count INTEGER DEFAULT 0,
  interval_days INTEGER DEFAULT 1,
  ease_factor REAL DEFAULT 2.5,
  due_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_reviewed DATETIME
);
CREATE INDEX IF NOT EXISTS idx_flashcard_lesson ON flashcard(lesson_id);

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

-- knowledge_connection es polimorfica (los extremos pueden ser conceptos,
-- recursos, cursos, módulos, lecciones o notas), por lo que NO se fuerzan
-- claves foráneas. La integridad de existencia se valida en la aplicación; el
-- índice único de tripleta evita duplicados exactos y los índices de extremos
-- aceleran el podado de conexiones huérfanas.
CREATE INDEX IF NOT EXISTS idx_knowledge_connection_source ON knowledge_connection(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_connection_target ON knowledge_connection(target_id);

-- Trabajo práctico: artefactos producidos por el estudiante y ligados al
-- aprendizaje (recurso, lección o concepto). Se añade de forma ADITIVA: el DDL
-- usa IF NOT EXISTS y se ejecuta en cada apertura, así que las bases existentes
-- se migran solas sin perder datos.
CREATE TABLE IF NOT EXISTS practice_work (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  resource_id TEXT REFERENCES learning_resource(id) ON DELETE CASCADE,
  lesson_id TEXT REFERENCES lesson(id) ON DELETE CASCADE,
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
);
CREATE INDEX IF NOT EXISTS idx_practice_work_resource ON practice_work(resource_id);
CREATE INDEX IF NOT EXISTS idx_practice_work_lesson ON practice_work(lesson_id);
CREATE INDEX IF NOT EXISTS idx_practice_work_status ON practice_work(status);

-- Metas de aprendizaje: planificación personal derivada de datos reales.
-- El progreso NUNCA se persiste aquí: se calcula en cada lectura desde el
-- recurso enlazado, el trabajo práctico o las sesiones de estudio. Se añade de
-- forma ADITIVA (IF NOT EXISTS en cada apertura): las bases existentes crean la
-- tabla solas sin tocar sus datos.
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
-- Las columnas 'content' y 'checklist' de practice_work existen solo en bases
-- nuevas; la migración idempotente migratePracticeWorkspace() las añade a bases
-- creadas por versiones anteriores (ALTER TABLE ADD COLUMN).
`;

/**
 * Índice único determinista de tripletas (source_id, target_id, connection_type).
 * Se crea en una migración explícita (no en el DDL base) para poder deduplicar
 * primero bases de datos existentes sin romper la inicialización.
 */
export const KNOWLEDGE_CONNECTION_UNIQUE_INDEX_SQL =
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_connection_triple ON knowledge_connection(source_id, target_id, connection_type);';

