export type RetrievedSourceType = 'course' | 'lesson' | 'book' | 'note' | 'flashcard' | 'concept' | 'practice';

export interface RetrievedDocument {
  id: string;
  sourceType: RetrievedSourceType;
  title: string;
  snippet: string;
  score: number;
  retrievalMode?: 'lexical' | 'semantic' | 'hybrid';
  page?: number;
  chapter?: string;
  /**
   * True when the match rests on real CONTENT (note/lesson body, resource
   * description, practice work, or a semantic vector), not metadata such as
   * the title alone. A title-only hit must never pose as solid grounding.
   */
  substantive?: boolean;
  /**
   * Navigable provenance path, e.g. `[Course, Module, Lesson]`. Only filled
   * when retrieval knows the fragment's REAL context: never reconstructed or
   * guessed.
   */
  path?: string[];
  /** Owning resource of the fragment (course, book, or the note's resource). */
  resourceId?: string;
  /** Source lesson when the fragment belongs to one. */
  lessonId?: string;
}

export interface RetrievalResult {
  documents: RetrievedDocument[];
  hasContext: boolean;
  /**
   * ACCEPTED candidates after the acceptance threshold and scope filter,
   * BEFORE diversification and truncation to `limit`. This is the real size of
   * the candidate set considered, not the number of returned results.
   */
  totalCandidates: number;
  /** Candidates surviving diversification (<=2 fragments per source). */
  diversifiedCandidates: number;
  /**
   * True only when at least one returned document rests on real content (not a
   * weak title/metadata match). When false, generation must not claim solid
   * grounding.
   */
  hasSubstantiveContext: boolean;
  modeUsed: 'lexical' | 'hybrid' | 'semantic';
  retrievalMode: 'lexical' | 'hybrid' | 'semantic';
}

export interface RetrievalScope {
  resourceId?: string;
  lessonId?: string;
}

export const THRESHOLDS = {
  MIN_LEXICAL_CANDIDATE: 0.5,
  MIN_SEMANTIC_SIMILARITY: 0.40,
  MIN_FINAL_ACCEPTANCE: 0.20,
  SCOPE_BOOST: 0.15
};
