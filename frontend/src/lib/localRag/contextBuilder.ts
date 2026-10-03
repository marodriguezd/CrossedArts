import type { RetrievedDocument } from './retrieval.ts';

export interface BuiltRagContext {
  formattedContextText: string;
  sourceTitles: string[];
  hasContext: boolean;
}

export const MAX_SOURCES = 5;
export const MAX_CHARS_PER_SOURCE = 400;
export const MAX_TOTAL_CONTEXT_CHARS = 1800;

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
      hasContext: false
    };
  }

  const sourceTitles: string[] = [];
  const sections: string[] = [];
  let totalChars = 0;

  const boundedDocs = documents.slice(0, MAX_SOURCES);

  for (let i = 0; i < boundedDocs.length; i++) {
    const doc = boundedDocs[i];
    sourceTitles.push(doc.title);
    
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
    hasContext: true
  };
}
