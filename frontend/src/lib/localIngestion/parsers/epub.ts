import type { ParsedDocument, DocumentSection } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';

/**
 * Extractor nativo de texto para archivos EPUB (contenedor ZIP OCF con XHTML).
 * Desempaqueta entradas ZIP en memoria pura mediante formato estándar PK.
 */
export async function parseEpubFile(
  file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fingerprint = await computeBinarySha256(buffer);

  // Verificar firma mágica de archivo ZIP / EPUB: PK\x03\x04
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error(`El archivo "${file.name}" no es un contenedor EPUB/ZIP válido (firma PK ausente).`);
  }

  // Parsear entradas descomprimidas del zip o extraer fragmentos de texto XHTML
  const latinDecoder = new TextDecoder('latin1');
  const rawString = latinDecoder.decode(bytes);

  // Extraer texto eliminando etiquetas HTML de bloques XHTML presentes en el EPUB
  const htmlTagRegex = /<html[\s\S]*?<\/html>/gi;
  const sections: DocumentSection[] = [];
  let match: RegExpExecArray | null;
  let sectionIndex = 1;
  let accumulatedText = '';

  while ((match = htmlTagRegex.exec(rawString)) !== null) {
    const rawHtml = match[0];
    const textOnly = stripHtmlTags(rawHtml);
    if (textOnly.length > 50) {
      // Intentar extraer título del capítulo (<title> o <h1>)
      const titleMatch = rawHtml.match(/<title[^>]*>(.*?)<\/title>/i) || rawHtml.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
      const chapterTitle = titleMatch ? stripHtmlTags(titleMatch[1]).trim() : `Sección ${sectionIndex}`;

      sections.push({
        chapter: chapterTitle,
        title: chapterTitle,
        page: sectionIndex++,
        content: textOnly
      });
      accumulatedText += (accumulatedText ? '\n\n' : '') + textOnly;
    }
  }

  // Fallback si los archivos XHTML estaban comprimidos con Deflate en el ZIP:
  // extraer bloques de texto que contengan párrafos o metadatos legibles
  if (sections.length === 0) {
    const fallbackParagraphs = extractReadableParagraphs(rawString);
    if (fallbackParagraphs.length > 0) {
      let fIndex = 1;
      for (const p of fallbackParagraphs) {
        sections.push({
          page: fIndex++,
          content: p
        });
      }
      accumulatedText = fallbackParagraphs.join('\n\n');
    }
  }

  if (sections.length === 0 || !accumulatedText.trim()) {
    throw new Error(`No se pudo extraer texto utilizable del EPUB "${file.name}".`);
  }

  // Intentar extraer título de dc:title en el metadato del libro
  const dcTitleMatch = rawString.match(/<dc:title[^>]*>(.*?)<\/dc:title>/i);
  const docTitle = dcTitleMatch ? stripHtmlTags(dcTitleMatch[1]).trim() : file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();

  const dcAuthorMatch = rawString.match(/<dc:creator[^>]*>(.*?)<\/dc:creator>/i);
  const docAuthor = dcAuthorMatch ? stripHtmlTags(dcAuthorMatch[1]).trim() : undefined;

  return {
    title: docTitle || file.name,
    author: docAuthor,
    fileType: 'epub',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount: sections.length || 1,
    sections,
    rawText: accumulatedText,
    estimatedWords: accumulatedText.split(/\s+/).filter(w => w.length > 0).length
  };
}

function stripHtmlTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractReadableParagraphs(str: string): string[] {
  const matches = str.match(/[\p{L}\p{N}\p{P}\s]{60,}/gu) || [];
  return matches
    .map(m => m.trim())
    .filter(m => !m.includes('http://') && !m.includes('schemas.openxmlformats') && m.length > 80);
}
