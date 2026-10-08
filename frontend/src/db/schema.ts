/**
 * DDL canónico del trabajo práctico.
 *
 * El trabajo práctico es EVIDENCIA PRODUCIDA POR EL ESTUDIANTE: no es un dato
 * derivado del recurso, así que sus vínculos al recurso y a la lección usan
 * `ON DELETE SET NULL`. Borrar una lección o un recurso NO debe destruir el
 * trabajo del usuario; el artefacto queda huérfano pero visible y explicable.
 *
 * Se expone como función para que la migración de bases existentes construya
 * la tabla con exactamente la misma definición (una sola fuente de verdad).
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

/** Índices del trabajo práctico (mismos nombres para la tabla canónica y la migrada). */
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

-- Ámbito de la sesión (regla canónica en services/sessionScope.ts):
--   'lesson'   -> sesión iniciada en una lección (resource_id opcional)
--   'resource' -> sesión iniciada en un recurso, sin lección
--   'global'   -> repaso transversal: ninguna ancla (ámbito explícito, no ausencia)
-- Al escribir, el DAO valida la coherencia estricta del ámbito con sus anclas.
-- La base solo garantiza el dominio de valores y que 'global' nunca tenga
-- ancla, porque la regla ON DELETE SET NULL puede desvincular la lección de una
-- sesión de lección ya terminada: el historial se conserva y su ámbito se
-- reclasifica en la lectura (el DAO deriva el ámbito efectivo de las anclas).
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
-- se migran solas sin perder datos. Los vínculos usan SET NULL (ver
-- buildPracticeWorkTableSql): borrar el padre no debe destruir el trabajo del
-- usuario. Las bases antiguas con CASCADE se reconstruyen en
-- migratePracticeWorkParentCascade().
${buildPracticeWorkTableSql('practice_work')}
${PRACTICE_WORK_INDEX_SQL}

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

