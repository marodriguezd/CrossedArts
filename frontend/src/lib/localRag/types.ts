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
   * Verdadero cuando la coincidencia se apoya en CONTENIDO real (cuerpo de una
   * nota/lección, descripción de un recurso, trabajo práctico, o un vector
   * semántico) y no únicamente en metadatos como el título. Un acierto de solo
   * título nunca debe presentarse como fundamentación sólida.
   */
  substantive?: boolean;
  /**
   * Ruta de procedencia navegable, p. ej. `[Curso, Módulo, Lección]`.
   * Solo se rellena cuando la recuperación conoce el contexto REAL del
   * fragmento: nunca se reconstruye ni se adivina.
   */
  path?: string[];
  /** Recurso propietario del fragmento (curso, libro o recurso de la nota). */
  resourceId?: string;
  /** Lección de origen cuando el fragmento pertenece a una. */
  lessonId?: string;
}

export interface RetrievalResult {
  documents: RetrievedDocument[];
  hasContext: boolean;
  /**
   * Candidatos ACEPTADOS tras el umbral de aceptación y el filtro de ámbito,
   * ANTES de la diversificación y del recorte a `limit`. Es el tamaño real del
   * conjunto de candidatos considerados, no el número de resultados devueltos.
   */
  totalCandidates: number;
  /** Candidatos que sobreviven a la diversificación (≤2 fragmentos por fuente). */
  diversifiedCandidates: number;
  /**
   * Verdadero solo si al menos un documento devuelto se apoya en contenido real
   * (no en una coincidencia débil de título/metadatos). Cuando es falso, la
   * generación no debe afirmar una fundamentación sólida.
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
