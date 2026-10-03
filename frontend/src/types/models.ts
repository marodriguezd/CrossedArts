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
  order_index: number;
  duration_minutes: number;
  lesson_type: LessonType;
  media_url?: string;
  is_completed: boolean;
}

export interface LearningSession {
  id: string;
  resource_id: string;
  started_at: string;
  ended_at?: string;
  duration_minutes: number;
  inactive_seconds: number;
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

export interface Flashcard {
  id: string;
  resource_id?: string;
  front: string;
  back: string;
  repetition_count: number;
  interval_days: number;
  ease_factor: number;
  due_date: string;
  last_reviewed?: string;
}

export interface ConceptNode {
  id: string;
  name: string;
  description?: string;
}

export interface ConceptEdge {
  id: string;
  source_id: string;
  target_id: string;
  connection_type: string;
  weight: number;
}

export interface KPIMetrics {
  total_resources: number;
  completed_resources: number;
  total_study_hours: number;
  active_streak_days: number;
  pending_reviews: number;
}
