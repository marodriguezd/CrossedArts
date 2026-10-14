import type { StudySessionScope } from '../services/sessionScope.ts';

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
  /** Lesson content as plain text / Markdown (handled as data, never as HTML). */
  content?: string;
  order_index: number;
  duration_minutes: number;
  lesson_type: LessonType;
  media_url?: string;
  is_completed: boolean;
}

/** Deterministic lesson progress state. */
export type LessonProgressState = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';

/**
 * Lesson workspace: aggregates content, notes, resources, concepts, and
 * progress by reusing the existing relational model (no parallel stores).
 */
export interface LessonWorkspace {
  lesson: Lesson;
  module: { id: string; title: string; course_id: string } | null;
  course: { id: string; title: string } | null;
  notes: Note[];
  resources: RelatedKnowledgeItem[];
  concepts: RelatedKnowledgeItem[];
  relatedBooks: RelatedKnowledgeItem[];
  /** SM-2 card count for the lesson's course (review context). */
  flashcardCount: number;
  /** Study cards for this specific lesson. */
  flashcards?: Flashcard[];
  progress: LessonProgressState;
}

export type StudySessionMode = 'flashcards' | 'practice' | 'mixed';
/** Canonical study-session scope. Re-exported from the domain layer. */
export type { StudySessionScope } from '../services/sessionScope.ts';
export type StudySessionStatus = 'active' | 'completed' | 'cancelled';

/**
 * Unified study session. Reuses the relational `learning_session` table
 * instead of introducing a second learning-history system.
 */
export interface LearningSession {
  id: string;
  resource_id?: string;
  lesson_id?: string;
  /**
   * Canonical explicit session scope: `lesson`, `resource`, or `global`
   * (cross-cutting review without anchors). Persisted in SQLite and derived
   * from anchors on write; never inferred from missing data.
   * See `services/sessionScope.ts`.
   */
  scope: StudySessionScope;
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

/** Aggregate summary of activity recorded during the current day. */
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
 * Practice work: an artifact the learner PRODUCES (exercise, project, essay,
 * drawing, code) linked to a resource, lesson, or concept.
 *
 * Deliberately domain-agnostic: it covers solving math exercises, writing an
 * essay, or shipping a project alike. Stored in the relational `practice_work`
 * table, never in parallel stores.
 */
export type PracticeWorkKind = 'exercise' | 'project' | 'essay' | 'drawing' | 'code' | 'other';
export type PracticeWorkStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE';

/** Checklist item in a practice-work workspace. */
export interface PracticeChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface PracticeWork {
  id: string;
  title: string;
  description?: string;
  resource_id?: string;
  lesson_id?: string;
  concept_id?: string;
  kind: PracticeWorkKind;
  status: PracticeWorkStatus;
  /** Reference to a local artifact (never a `blob:` URL or persisted handle). */
  artifact_url?: string;
  notes?: string;
  /** Self-rating 0..5 (same scale as SM-2), optional. */
  self_rating?: number;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
  /** Work content in Markdown (handled as data, never as HTML). */
  content?: string;
  /** Checklist persisted as JSON (derivable, user-editable). */
  checklist?: PracticeChecklistItem[];
}

export type FlashcardType = 'standard' | 'image_occlusion';

export interface OcclusionMask {
  id: string;
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  width: number; // percentage 0..100
  height: number; // percentage 0..100
  label?: string;
  orderIndex?: number;
}

export interface ImageOcclusionData {
  imageId?: string;
  imageUrl?: string; // data URL or relative URI
  mode: 'hide_all_reveal_one' | 'hide_one_reveal_one';
  masks: OcclusionMask[];
  originalWidth?: number;
  originalHeight?: number;
}

export interface MediaAsset {
  id: string;
  mime_type: string;
  data: string;
  created_at?: string;
}

export interface Flashcard {
  id: string;
  resource_id?: string;
  lesson_id?: string;
  front: string;
  back: string;
  card_type?: FlashcardType;
  extra_data?: string | null;
  repetition_count: number;
  interval_days: number;
  ease_factor: number;
  due_date: string;
  last_reviewed?: string;
}

/**
 * Node categories for real knowledge or learning structure. `practice` is
 * learner-produced practice work: not study content, but evidence of learning.
 */
export type GraphNodeType =
  | 'concept'
  | 'course'
  | 'book'
  | 'module'
  | 'lesson'
  | 'note'
  | 'practice'
  | 'resource';

/** Explicit validated relation types (stored as canonical text). */
export type GraphRelationType =
  | 'contains'
  | 'references'
  | 'teaches'
  | 'discusses'
  | 'related_to'
  | 'requires'
  | 'builds_on'
  | 'about';

/**
 * Refined metadata shown in the graph detail panel.
 *
 * Instead of a flat bag of mixed fields, the shape is declared PER NODE TYPE
 * (`GraphNodeMetaByKind`) and composed afterwards. Each field has a clear
 * owner, and adding a node type requires declaring its shape.
 */

/** Fields shared by more than one node type. */
export interface GraphNodeMetaCommon {
  category?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
  source_path?: string;
}

export interface CourseNodeMeta extends GraphNodeMetaCommon {
  instructor?: string;
  difficulty?: string;
  total_lessons?: number;
}

export interface BookNodeMeta extends GraphNodeMetaCommon {
  author?: string;
  page_count?: number;
  current_page?: number;
  reading_percentage?: number;
}

export interface ModuleNodeMeta extends GraphNodeMetaCommon {
  course_id?: string;
  order_index?: number;
}

export interface LessonNodeMeta extends GraphNodeMetaCommon {
  module_id?: string;
  course_id?: string;
  duration_minutes?: number;
  lesson_type?: string;
  order_index?: number;
}

export interface NoteNodeMeta extends GraphNodeMetaCommon {
  resource_id?: string;
  lesson_id?: string;
  tags?: string;
}

/** `practice`-specific metadata (learner-produced evidence). */
export interface PracticeNodeMeta extends GraphNodeMetaCommon {
  resource_id?: string;
  lesson_id?: string;
  concept_id?: string;
  practice_kind?: string;
}

/** `resource`-specific metadata (imported document). */
export type ResourceNodeMeta = GraphNodeMetaCommon;

export type ConceptNodeMeta = GraphNodeMetaCommon;

/**
 * Node-type to `meta`-shape map.
 *
 * This is the type-level coverage guarantee: adding a new `GraphNodeType`
 * without declaring its shape here fails compilation. Use it when the node
 * type is KNOWN at the use site.
 */
export interface GraphNodeMetaByKind {
  concept: ConceptNodeMeta;
  course: CourseNodeMeta;
  book: BookNodeMeta;
  module: ModuleNodeMeta;
  lesson: LessonNodeMeta;
  note: NoteNodeMeta;
  practice: PracticeNodeMeta;
  resource: ResourceNodeMeta;
}

/**
 * Read view of `ConceptNode.meta`.
 *
 * It intersects every per-type shape (all fields optional) because a consumer
 * receives `meta` with a dynamic `node_type` and must read ANY type's field:
 * `resolveGraphNodeDestination` reads `course_id`, `resource_id`, and
 * `lesson_id` without knowing the type upfront. The per-type shape
 * (`GraphNodeMetaByKind`) is for callers that do know the type.
 *
 * No runtime behavior change: exactly the same optional fields as before,
 * only grouped and documented.
 */
export type GraphNodeMeta = GraphNodeMetaCommon &
  CourseNodeMeta &
  BookNodeMeta &
  ModuleNodeMeta &
  LessonNodeMeta &
  NoteNodeMeta &
  PracticeNodeMeta &
  ResourceNodeMeta &
  ConceptNodeMeta;

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
  /** True for structural edges derived from foreign keys (not editable). */
  derived?: boolean;
}

export interface KnowledgeConnection {
  id: string;
  source_id: string;
  target_id: string;
  connection_type: string;
  weight: number;
}

/** Deterministic local search result (no embeddings). */
export interface SearchResult {
  id: string;
  /** Entity type. `goal` is not a graph node: it has its own view. */
  type: GraphNodeType | 'goal';
  title: string;
  subtitle?: string;
  resourceId?: string;
  lessonId?: string;
}

/** Imported learning resource not linked to anything yet. */
export interface UnorganizedResource {
  resource: LearningResource;
  noteCount: number;
  connectionCount: number;
}

/** Node type openable from a resource detail. */
export type ResourceKind = 'course' | 'book' | 'resource' | 'concept' | 'lesson' | 'note' | 'module';

/** Neighbor-node summary shown in the "Related" section. */
export interface RelatedKnowledgeItem {
  id: string;
  title: string;
  type: GraphNodeType;
  /** Stored canonical relation (or foreign-key derived). */
  relation: string;
  /** True when the relation comes from structure and cannot be deleted. */
  derived: boolean;
}

/** Text content extracted from an imported document (data, never HTML). */
export interface ResourceFragment {
  id: string;
  title: string;
  content: string;
  tags?: string;
  created_at?: string;
}

/**
 * Unified detail view for books, imported resources, and concepts. Reuses the
 * existing relational model; introduces no second system.
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
 * Deterministic navigation target from a search hit or graph node. Reuses the
 * state-based navigation model without introducing a router.
 */
export type ResourceDestination =
  | { tab: 'course'; resourceId: string; lessonId?: string }
  | { tab: 'note'; noteId: string }
  | { tab: 'resource'; resourceId: string }
  | { tab: 'concept'; conceptId: string }
  | { tab: 'goals'; goalId?: string }
  | { tab: 'library' };

export type TimeRangeFilter = '7d' | '30d' | '90d' | 'all';

/** Daily activity point for deterministic charts without external libraries. */
export interface DailyActivityPoint {
  date: string;       // YYYY-MM-DD local
  label: string;      // e.g. 'Mon 04', '04 Oct'
  minutes: number;    // Study minutes
  reviews: number;    // Reviewed items (cards + questions)
}

/**
 * Learning goal: personal planning linked to real data.
 *
 * PROGRESS is never persisted: it derives on every read from the linked
 * resource (course/book), recorded practice work, or study sessions. The table
 * stores only user-defined intent: purpose, target, date, and status.
 */
export type GoalKind = 'course' | 'book' | 'practice' | 'study_time' | 'custom';
export type GoalStatus = 'active' | 'completed';

export interface LearningGoal {
  id: string;
  title: string;
  description?: string;
  /** Goal kind: determines how progress is measured. */
  kind: GoalKind;
  /** Linked resource (course or book). Optional for practice/study/custom. */
  resource_id?: string;
  /** Numeric target value (study minutes, practice-piece count). */
  target_value?: number;
  /** Optional target date (YYYY-MM-DD or ISO). */
  target_date?: string;
  status: GoalStatus;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface KPIMetrics {
  total_resources: number;
  completed_resources: number;
  total_study_hours: number;
  active_streak_days: number;
  pending_reviews: number;
  today: TodayStudySummary;
}
