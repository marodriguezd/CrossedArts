export type StudyDifficulty = 'easy' | 'medium' | 'hard';

export interface StudyGenerationOptions {
  resourceId?: string;
  /** Lesson scope: prioritizes the lesson's content in local retrieval. */
  lessonId?: string;
  resourceTitle?: string;
  topic?: string;
  count: number; // 3 - 10
  difficulty: StudyDifficulty;
}

export interface GeneratedFlashcard {
  id: string;
  front: string;
  back: string;
  sourceIds: string[];
  sourceTitles: string[];
  difficulty: StudyDifficulty;
  resourceId?: string;
}

export interface GeneratedQuestion {
  id: string;
  question: string;
  options: string[]; // 3-4 options
  correctIndex: number;
  explanation: string;
  sourceIds: string[];
  sourceTitles: string[];
  difficulty: StudyDifficulty;
}

export interface GroundingCheckResult {
  grounded: boolean;
  score: number;
  unsupportedClauses?: string[];
}
