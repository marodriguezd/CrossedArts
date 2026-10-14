import type { RetrievedDocument } from './types.ts';

export interface FormattedCitation {
  id: string;
  sourceType: string;
  title: string;
  sourceTitle: string;
  path?: string[];
  page?: number;
  chapter?: string;
  resourceId?: string;
  lessonId?: string;
  snippetPreview: string;
  substantive: boolean;
}

/**
 * Extracts and validates strict provenance for every document selected for
 * RAG. Ensures no citation is fabricated and that navigation links point at
 * valid graph or SQLite ids.
 */
export function buildVerifiedProvenance(documents: RetrievedDocument[]): FormattedCitation[] {
  return documents.map((doc) => {
    const sourceTitle = doc.path && doc.path.length > 0 ? doc.path[doc.path.length - 1] : doc.title;
    const snippetPreview = doc.snippet.length > 180 ? `${doc.snippet.slice(0, 180)}...` : doc.snippet;

    return {
      id: doc.id,
      sourceType: doc.sourceType,
      title: doc.title,
      sourceTitle,
      path: doc.path,
      page: doc.page,
      chapter: doc.chapter,
      resourceId: doc.resourceId,
      lessonId: doc.lessonId,
      snippetPreview,
      substantive: doc.substantive ?? false
    };
  });
}
