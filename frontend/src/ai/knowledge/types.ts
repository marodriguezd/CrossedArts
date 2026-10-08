import type { SemanticSourceType } from '../../lib/localEmbeddings/chunking.ts';

/**
 * Tipos de artefacto indexables por el pipeline semántico.
 *
 * Se toma la definición canónica del troceado (`SemanticSourceType`) para que el
 * `KnowledgeDocument` sea asignable a la entrada de troceado sin conversión ni
 * `any`: la frontera semántica no admite tipos que el troceado no sepa manejar.
 * Los tipos declarativos que aún no se indexan (`module`, `transcript`,
 * `document`) quedan fuera del conjunto indexable.
 */
export type KnowledgeSourceType = SemanticSourceType;

/**
 * Representación canónica unificada y derivada de cualquier entidad de conocimiento
 * del dominio para indexación semántica, troceado, vectorización y recuperación RAG.
 *
 * Invariantes:
 * - Es una representación derivada sobre lectura, NUNCA fuente canónica de verdad.
 * - No duplica persistencia en SQLite.
 * - Preserva procedencia exacta y navegación hacia el artefacto original.
 * - `contentHash` es determinista (SHA-256) y permite invalidar vectores con granularidad exacta.
 */
export interface KnowledgeDocument {
  /** Identificador canónico del documento derivado (p. ej. `lesson_123` o `note_456`). */
  id: string;

  /** Tipo de artefacto de origen del dominio. */
  sourceType: KnowledgeSourceType;

  /** Identificador primario de la entidad de origen. */
  sourceId: string;

  /** Recurso propietario (curso o libro), si existe. */
  resourceId?: string;

  /** Módulo propietario, si pertenece a la jerarquía de un curso. */
  moduleId?: string;

  /** Lección propietaria, si pertenece a una lección. */
  lessonId?: string;

  /** Título descriptivo o ruta jerárquica del artefacto. */
  title: string;

  /** Encabezado estructurado del documento (categoría, metadatos clave). */
  headerText: string;

  /** Texto principal o cuerpo sustantivo del contenido. */
  bodyText: string;

  /** Texto completo combinado (encabezado + cuerpo). */
  text: string;

  /** Ruta de navegación jerárquica (p. ej. `['Curso React', 'Módulo 1', 'Hooks']`). */
  path?: string[];

  /** Página de origen cuando procede de un libro o documento paginado. */
  page?: number;

  /** Capítulo o sección de origen cuando aplica. */
  chapter?: string;

  /** Metadatos adicionales estructurados. */
  metadata?: Record<string, string | number | boolean | null>;

  /** Si el documento contiene cuerpo sustantivo o solo metadatos de título. */
  substantive: boolean;

  /** Hash criptográfico SHA-256 del contenido canónico del documento. */
  contentHash: string;
}

export interface DomainKnowledgeEntities {
  courses?: Array<{
    id: string;
    title: string;
    category?: string;
    description?: string | null;
    modules?: Array<{
      id: string;
      title: string;
      lessons?: Array<{
        id: string;
        title: string;
        content?: string | null;
        duration_minutes?: number;
      }>;
    }>;
  }>;
  books?: Array<{
    id: string;
    title: string;
    author?: string | null;
    category?: string;
    description?: string | null;
    reading_percentage?: number;
  }>;
  notes?: Array<{
    id: string;
    title: string;
    content?: string | null;
    tags?: string | null;
    resource_id?: string | null;
    lesson_id?: string | null;
  }>;
  flashcards?: Array<{
    id: string;
    front: string;
    back: string;
    resource_id?: string | null;
    lesson_id?: string | null;
  }>;
  concepts?: Array<{
    id: string;
    name: string;
    description?: string | null;
  }>;
  practiceWork?: Array<{
    id: string;
    title: string;
    description?: string | null;
    content?: string | null;
    notes?: string | null;
    kind?: string | null;
    resource_id?: string | null;
    lesson_id?: string | null;
  }>;
}
