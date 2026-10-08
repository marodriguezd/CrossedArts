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
 * Extrae y valida la procedencia estricta de cada documento seleccionado para RAG.
 * Asegura que ninguna cita sea fabricada y que los enlaces de navegación apunten
 * a identificadores válidos en el grafo o SQLite.
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
