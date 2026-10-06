export type ResourceStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
export type CourseDifficulty = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type LessonType = 'VIDEO' | 'PDF' | 'EPUB' | 'ARTICLE' | 'PROJECT';

export interface LearningResource {
  id: string;
  title: string;
  description?: string;
  cover_path?: string;
  category: string;
  status: ResourceStatus;
  source_path?: string;
  type: 'course' | 'book' | 'learning_resource';
  created_at?: string;
  updated_at?: string;
}

export interface Course extends LearningResource {
  instructor?: string;
  difficulty: CourseDifficulty;
  total_duration_minutes?: number;
  total_lessons?: number;
  completed_lessons?: number;
  modules?: Module[];
}

export interface Book extends LearningResource {
  author?: string;
  isbn?: string;
  page_count?: number;
  current_page?: number;
  reading_percentage: number;
}

export interface Module {
  id: string;
  course_id: string;
  title: string;
  order_index: number;
  lessons?: Lesson[];
}

export interface Lesson {
  id: string;
  module_id: string;
  title: string;
  /** Contenido de la lección como texto plano / Markdown (se trata como datos, nunca como HTML). */
  content?: string;
  order_index: number;
  duration_minutes: number;
  lesson_type: LessonType;
  media_url?: string;
  is_completed: boolean;
}

/** Estado de progreso determinista de una lección. */
export type LessonProgressState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * Espacio de trabajo de una lección: agrega contenido, notas, recursos, conceptos
 * y progreso reutilizando el modelo relacional existente (sin almacenes paralelos).
 */
export interface LessonWorkspace {
  lesson: Lesson;
  module: { id: string; title: string; course_id: string } | null;
  course: { id: string; title: string } | null;
  notes: Note[];
  resources: RelatedKnowledgeItem[];
  concepts: RelatedKnowledgeItem[];
  relatedBooks: RelatedKnowledgeItem[];
  /** Nº de tarjetas SM-2 asociadas al curso de la lección (contexto de repaso). */
  flashcardCount: number;
  /** Tarjetas de estudio asociadas a esta lección específica. */
  flashcards?: Flashcard[];
  progress: LessonProgressState;
}

export type StudySessionMode = 'flashcards' | 'practice' | 'mixed';
export type StudySessionStatus = 'active' | 'completed' | 'cancelled';

/**
 * Sesión de estudio unificada. Reutiliza la tabla relacional `learning_session`
 * en lugar de introducir un segundo sistema de historial de aprendizaje.
 */
export interface LearningSession {
  id: string;
  resource_id?: string;
  lesson_id?: string;
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  inactive_seconds: number;
  mode: StudySessionMode;
  cards_reviewed: number;
  questions_answered: number;
  correct_answers: number;
  status: StudySessionStatus;
  resource_title?: string;
  lesson_title?: string;
}

/** Resumen agregado de la actividad registrada durante el día actual. */
export interface TodayStudySummary {
  items_reviewed: number;
  flashcards_reviewed: number;
  questions_answered: number;
  correct_answers: number;
}

export interface Note {
  id: string;
  resource_id?: string;
  lesson_id?: string;
  title: string;
  content: string;
  tags?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Trabajo práctico: un artefacto que el estudiante PRODUCE (ejercicio, proyecto,
 * ensayo, dibujo, código…) ligado a un recurso, una lección o un concepto.
 *
 * Es intencionadamente agnóstico al dominio: sirve igual para resolver
 * ejercicios de matemáticas, escribir un ensayo o entregar un proyecto. Se
 * guarda en la tabla relacional `practice_work`, nunca en almacenes paralelos.
 */
export type PracticeWorkKind = 'exercise' | 'project' | 'essay' | 'drawing' | 'code' | 'other';
export type PracticeWorkStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';

export interface PracticeWork {
  id: string;
  title: string;
  description?: string;
  resource_id?: string;
  lesson_id?: string;
  concept_id?: string;
  kind: PracticeWorkKind;
  status: PracticeWorkStatus;
  /** Referencia a un artefacto local (nunca un `blob:` ni un handle persistido). */
  artifact_url?: string;
  notes?: string;
  /** Autoevaluación 0..5 (misma escala que SM-2), opcional. */
  self_rating?: number;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Flashcard {
  id: string;
  resource_id?: string;
  lesson_id?: string;
  front: string;
  back: string;
  repetition_count: number;
  interval_days: number;
  ease_factor: number;
  due_date: string;
  last_reviewed?: string;
}

/** Categorías de nodo que representan conocimiento o estructura de aprendizaje real. */
export type GraphNodeType = 'concept' | 'course' | 'book' | 'module' | 'lesson' | 'note' | 'resource';

/** Tipos de relación explícitos y validados (se almacenan como texto canónico). */
export type GraphRelationType =
  | 'contains'
  | 'references'
  | 'teaches'
  | 'discusses'
  | 'related_to'
  | 'requires'
  | 'builds_on'
  | 'about';

/** Metadatos no crudos mostrados en el panel de detalle del grafo. */
export interface GraphNodeMeta {
  category?: string;
  status?: string;
  author?: string;
  instructor?: string;
  difficulty?: string;
  page_count?: number;
  current_page?: number;
  reading_percentage?: number;
  duration_minutes?: number;
  lesson_type?: string;
  total_lessons?: number;
  order_index?: number;
  course_id?: string;
  module_id?: string;
  resource_id?: string;
  lesson_id?: string;
  tags?: string;
  created_at?: string;
  source_path?: string;
}

export interface ConceptNode {
  id: string;
  name: string;
  description?: string;
  node_type?: GraphNodeType;
  meta?: GraphNodeMeta;
}

export interface ConceptEdge {
  id: string;
  source_id: string;
  target_id: string;
  connection_type: string;
  weight: number;
  /** true para aristas estructurales derivadas de claves foráneas (no editables). */
  derived?: boolean;
}

export interface KnowledgeConnection {
  id: string;
  source_id: string;
  target_id: string;
  connection_type: string;
  weight: number;
}

/** Resultado de búsqueda local determinista (sin embeddings). */
export interface SearchResult {
  id: string;
  type: GraphNodeType;
  title: string;
  subtitle?: string;
  resourceId?: string;
  lessonId?: string;
}

/** Recurso de aprendizaje importado que aún no se ha asociado a nada. */
export interface UnorganizedResource {
  resource: LearningResource;
  noteCount: number;
  connectionCount: number;
}

/** Tipo de nodo abrible en un detalle de recurso. */
export type ResourceKind = 'course' | 'book' | 'resource' | 'concept' | 'lesson' | 'note' | 'module';

/** Resumen de un nodo vecino mostrado en la sección "Relacionado". */
export interface RelatedKnowledgeItem {
  id: string;
  title: string;
  type: GraphNodeType;
  /** Relación canónica almacenada (o derivada de clave foránea). */
  relation: string;
  /** true si la relación proviene de la estructura y no puede eliminarse. */
  derived: boolean;
}

/** Contenido textual extraído de un documento importado (tratado como datos, nunca como HTML). */
export interface ResourceFragment {
  id: string;
  title: string;
  content: string;
  tags?: string;
  created_at?: string;
}

/**
 * Vista de detalle unificada para libros, recursos importados y conceptos.
 * Reutiliza el modelo relacional existente; no introduce un segundo sistema.
 */
export interface ResourceDetail {
  resource: LearningResource;
  kind: ResourceKind;
  book?: Book;
  source?: {
    sourceType: string;
    fileName?: string;
    fingerprint?: string;
    sectionCount: number;
  };
  fragments: ResourceFragment[];
  related: RelatedKnowledgeItem[];
}

/**
 * Destino determinista de navegación a partir de una búsqueda o un nodo del grafo.
 * Permite reutilizar el modelo de navegación por estado sin introducir un router.
 */
export type ResourceDestination =
  | { tab: 'course'; resourceId: string; lessonId?: string }
  | { tab: 'note'; noteId: string }
  | { tab: 'resource'; resourceId: string }
  | { tab: 'concept'; conceptId: string }
  | { tab: 'library' };

export type TimeRangeFilter = '7d' | '30d' | 'all';

/** Punto diario de actividad para gráficos deterministas sin bibliotecas externas. */
export interface DailyActivityPoint {
  date: string;       // YYYY-MM-DD local
  label: string;      // ej. 'Lun 04', '04 Oct'
  minutes: number;    // Minutos de estudio
  reviews: number;    // Ítems repasados (tarjetas + preguntas)
}

export interface KPIMetrics {
  total_resources: number;
  completed_resources: number;
  total_study_hours: number;
  active_streak_days: number;
  pending_reviews: number;
  today: TodayStudySummary;
}
