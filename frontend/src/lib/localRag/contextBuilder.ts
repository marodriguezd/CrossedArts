import type { RetrievedDocument } from './retrieval.ts';

/**
 * Cita de proveniencia de una fuente recuperada: identifica el artefacto de
 * origen y, cuando existe, su ruta navegable (p. ej. Curso › Módulo › Lección).
 *
 * `navigate` es `null` cuando NO hay un destino determinista conocido: en ese
 * caso la UI muestra la fuente sin enlace en lugar de fingir una navegación.
 */
export interface RagSourceCitation {
  /** Identificador estable dentro del mensaje (para claves de React). */
  key: string;
  title: string;
  sourceType: RetrievedDocument['sourceType'];
  /** Ruta de procedencia conocida (no se reconstruye ni se adivina). */
  path?: string[];
  page?: number;
  chapter?: string;
  /** Recuperación léxica, semántica o híbrida de ESTE fragmento. */
  retrievalMode?: 'lexical' | 'semantic' | 'hybrid';
  /** Destino determinista para abrir el origen desde la interfaz. */
  navigate: { kind: 'resource' | 'lesson' | 'note' | 'concept'; id: string } | null;
}

export interface BuiltRagContext {
  formattedContextText: string;
  sourceTitles: string[];
  /** Citas estructuradas de las fuentes REALMENTE recuperadas. */
  citations: RagSourceCitation[];
  hasContext: boolean;
}

export const MAX_SOURCES = 5;
export const MAX_CHARS_PER_SOURCE = 400;
export const MAX_TOTAL_CONTEXT_CHARS = 1800;

/**
 * Resuelve el destino de navegación de un fragmento recuperado a partir de la
 * procedencia que la recuperación conserva. Determinista y conservador: si el
 * artefacto no tiene destino conocido, devuelve `null`.
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
      // Una tarjeta no es un destino propio: se abre su recurso si lo tiene.
      return doc.resourceId ? { kind: 'resource', id: doc.resourceId } : null;
    default:
      return null;
  }
}

/** Construye la cita estructurada de un fragmento recuperado. */
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
 * Empaqueta documentos recuperados en un bloque de contexto estructurado
 * legible y comprensible para el modelo local, incluyendo identificadores de origen
 * y límites estrictos de longitud para evitar desbordamiento del contexto o inyecciones.
 */
export function buildRagContext(documents: RetrievedDocument[]): BuiltRagContext {
  if (!documents.length) {
    return {
      formattedContextText: '',
      sourceTitles: [],
      citations: [],
      hasContext: false
    };
  }

  const sourceTitles: string[] = [];
  const citations: RagSourceCitation[] = [];
  const sections: string[] = [];
  let totalChars = 0;

  const boundedDocs = documents.slice(0, MAX_SOURCES);

  for (let i = 0; i < boundedDocs.length; i++) {
    const doc = boundedDocs[i];
    sourceTitles.push(doc.title);
    citations.push(buildSourceCitation(doc, i));
    
    // Truncar contenido de cada fuente
    let safeSnippet = doc.snippet;
    if (safeSnippet.length > MAX_CHARS_PER_SOURCE) {
      safeSnippet = safeSnippet.slice(0, MAX_CHARS_PER_SOURCE) + '... [truncado]';
    }

    const pageAttr = doc.page ? ` PAGINA="${doc.page}"` : '';
    const chapterAttr = doc.chapter ? ` CAPITULO="${doc.chapter}"` : '';
    const section = `<<<DATOS_FUENTE_${i + 1} TIPO="${doc.sourceType.toUpperCase()}" TITULO="${doc.title}"${pageAttr}${chapterAttr}>>>\n${safeSnippet}\n<<<FIN_FUENTE_${i + 1}>>>`;
    
    if (totalChars + section.length > MAX_TOTAL_CONTEXT_CHARS) {
      sections.push(`[... Fuentes adicionales omitidas por límite de contexto ...]`);
      break;
    }

    sections.push(section);
    totalChars += section.length;
  }

  return {
    formattedContextText: sections.join('\n\n'),
    sourceTitles,
    citations,
    hasContext: true
  };
}
