import type { SemanticSourceType } from '../../lib/localEmbeddings/chunking.ts';

/**
 * Artifact types indexable by the semantic pipeline.
 *
 * The canonical chunking definition (`SemanticSourceType`) is reused so a
 * `KnowledgeDocument` is assignable to the chunking input with no conversion or
 * `any`: the semantic boundary admits no type chunking cannot handle.
 * Declarative types not indexed yet (`module`, `transcript`, `document`) stay
 * outside the indexable set.
 */
export type KnowledgeSourceType = SemanticSourceType;

/**
 * Unified, derived canonical representation of any domain knowledge entity for
 * semantic indexing, chunking, vectorization, and RAG retrieval.
 *
 * Invariants:
 * - It is a read-time derived representation, NEVER the canonical source of truth.
 * - It duplicates no SQLite persistence.
 * - It preserves exact provenance and navigation back to the original artifact.
 * - `contentHash` is deterministic (SHA-256) and allows invalidating vectors at
 *   exact granularity.
 */
export interface KnowledgeDocument {
  /** Canonical id of the derived document (e.g. `lesson_123` or `note_456`). */
  id: string;

  /** Domain source artifact type. */
  sourceType: KnowledgeSourceType;

  /** Primary id of the source entity. */
  sourceId: string;

  /** Owning resource (course or book), when present. */
  resourceId?: string;

  /** Owning module, when it belongs to a course hierarchy. */
  moduleId?: string;

  /** Owning lesson, when it belongs to a lesson. */
  lessonId?: string;

  /** Descriptive title or hierarchical path of the artifact. */
  title: string;

  /** Structured document header (category, key metadata). */
  headerText: string;

  /** Main text or substantive body of the content. */
  bodyText: string;

  /** Combined full text (header + body). */
  text: string;

  /** Hierarchical navigation path (e.g. `['React Course', 'Module 1', 'Hooks']`). */
  path?: string[];

  /** Source page when it comes from a book or paginated document. */
  page?: number;

  /** Source chapter or section when applicable. */
  chapter?: string;

  /** Additional structured metadata. */
  metadata?: Record<string, string | number | boolean | null>;

  /** Whether the document carries a substantive body or title metadata only. */
  substantive: boolean;

  /** SHA-256 cryptographic hash of the document's canonical content. */
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
