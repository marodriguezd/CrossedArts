import type { RetrievedDocument } from './retrieval.ts';

/**
 * Provenance citation of a retrieved source: it identifies the source artifact
 * and, when present, its navigable path (e.g. Course › Module › Lesson).
 *
 * `navigate` is `null` when NO deterministic destination is known: the UI then
 * shows the source without a link instead of faking navigation.
 */
export interface RagSourceCitation {
  /** Stable id within the message (for React keys). */
  key: string;
  title: string;
  sourceType: RetrievedDocument['sourceType'];
  /** Known provenance path (never reconstructed or guessed). */
  path?: string[];
  page?: number;
  chapter?: string;
  /** Lexical, semantic, or hybrid retrieval for THIS chunk. */
  retrievalMode?: 'lexical' | 'semantic' | 'hybrid';
  /** Deterministic destination for opening the origin from the UI. */
  navigate: { kind: 'resource' | 'lesson' | 'note' | 'concept'; id: string } | null;
}

export interface BuiltRagContext {
  formattedContextText: string;
  sourceTitles: string[];
  /** Structured citations of the sources ACTUALLY retrieved. */
  citations: RagSourceCitation[];
  hasContext: boolean;
  /**
   * True only when at least one source rests on real content rather than a weak
   * title/metadata match. Generation must not claim solid grounding when false.
   */
  hasSubstantiveContext: boolean;
}

export const MAX_SOURCES = 5;
export const MAX_CHARS_PER_SOURCE = 400;
export const MAX_TOTAL_CONTEXT_CHARS = 1800;

/**
 * Marker appended to the end of the context when a source did not fit the
 * total limit. It is not a source: it never appears in `citations` or
 * `sourceTitles`.
 */
export const OMITTED_SOURCES_MARKER = '[... Fuentes adicionales omitidas por límite de contexto ...]';

/**
 * Resolves the navigation destination of a retrieved chunk from the provenance
 * retrieval preserves. Deterministic and conservative: when the artifact has no
 * known destination it returns `null`.
 */
export function resolveCitationNavigate(doc: RetrievedDocument): RagSourceCitation['navigate'] {
  switch (doc.sourceType) {
    case 'course':
    case 'book':
      return doc.resourceId ? { kind: 'resource', id: doc.resourceId } : doc.id ? { kind: 'resource', id: doc.id } : null;
    case 'lesson':
      if (doc.lessonId) return { kind: 'lesson', id: doc.lessonId };
      return doc.id ? { kind: 'lesson', id: doc.id } : null;
    case 'note':
      return { kind: 'note', id: doc.id };
    case 'concept':
      return { kind: 'concept', id: doc.id };
    case 'flashcard':
      // A card is not a destination of its own: its resource opens when present.
      return doc.resourceId ? { kind: 'resource', id: doc.resourceId } : null;
    case 'practice':
      // Practice work opens through its known parent (lesson or resource).
      // Without a deterministic link, navigation is never faked.
      if (doc.lessonId) return { kind: 'lesson', id: doc.lessonId };
      return doc.resourceId ? { kind: 'resource', id: doc.resourceId } : null;
    default:
      return null;
  }
}

/** Builds the structured citation of a retrieved chunk. */
export function buildSourceCitation(doc: RetrievedDocument, index: number): RagSourceCitation {
  return {
    key: `${doc.sourceType}:${doc.id}:${index}`,
    title: doc.title,
    sourceType: doc.sourceType,
    path: doc.path,
    page: doc.page,
    chapter: doc.chapter,
    retrievalMode: doc.retrievalMode,
    navigate: resolveCitationNavigate(doc)
  };
}

/**
 * Packs retrieved documents into a structured context block that is readable
 * and understandable for the local model, including source identifiers and
 * strict length limits to prevent context overflow or injections.
 */
export function buildRagContext(documents: RetrievedDocument[]): BuiltRagContext {
  if (!documents.length) {
    return {
      formattedContextText: '',
      sourceTitles: [],
      citations: [],
      hasContext: false,
      hasSubstantiveContext: false
    };
  }

  const sourceTitles: string[] = [];
  const citations: RagSourceCitation[] = [];
  const sections: string[] = [];
  /** Documents ACTUALLY visible to the model, in order. */
  const includedDocs: RetrievedDocument[] = [];
  let totalChars = 0;

  const boundedDocs = documents.slice(0, MAX_SOURCES);

  for (let i = 0; i < boundedDocs.length; i++) {
    const doc = boundedDocs[i];

    let safeSnippet = doc.snippet;
    if (safeSnippet.length > MAX_CHARS_PER_SOURCE) {
      safeSnippet = safeSnippet.slice(0, MAX_CHARS_PER_SOURCE) + '... [truncado]';
    }

    const pageAttr = doc.page ? ` PAGINA="${doc.page}"` : '';
    const chapterAttr = doc.chapter ? ` CAPITULO="${doc.chapter}"` : '';
    const section = `<<<DATOS_FUENTE_${i + 1} TIPO="${doc.sourceType.toUpperCase()}" TITULO="${doc.title}"${pageAttr}${chapterAttr}>>>\n${safeSnippet}\n<<<FIN_FUENTE_${i + 1}>>>`;

    // PROVENANCE CONTRACT: the section is built and its inclusion decided
    // BEFORE registering a title or citation. A source that does not fit the
    // total context limit is NOT visible to the model and therefore cannot
    // appear as a citation or source title: citations describe exactly the
    // delivered context, no more and no less.
    if (totalChars + section.length > MAX_TOTAL_CONTEXT_CHARS) {
      sections.push(OMITTED_SOURCES_MARKER);
      break;
    }

    sections.push(section);
    totalChars += section.length;
    includedDocs.push(doc);
    sourceTitles.push(doc.title);
    citations.push(buildSourceCitation(doc, i));
  }

  return {
    formattedContextText: sections.join('\n\n'),
    sourceTitles,
    citations,
    // `hasContext` describes what the model really sees: when no section fit,
    // the visible context is only the omission marker and there is no retrieved
    // material to back the answer.
    hasContext: includedDocs.length > 0,
    // Only sources truly included in the context count: a limit-truncated
    // source must not inflate the grounding signal.
    hasSubstantiveContext: includedDocs.some((doc) => doc.substantive === true)
  };
}
