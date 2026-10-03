import type { ParsedDocument, DocumentSection } from '../types.ts';
import { sanitizePlainText } from './text.ts';
import { computeBinarySha256 } from '../fingerprint.ts';

/**
 * Parsea un archivo Markdown (.md), extrayendo encabezados (# y ##)
 * como nombres de capítulos y organizando secciones estructurales.
 */
export async function parseMarkdownFile(
  file: { name: string; size: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  const rawTextContent = await file.text();
  const clean = sanitizePlainText(rawTextContent);
  const fingerprint = await computeBinarySha256(await file.arrayBuffer());

  if (!clean.length) {
    throw new Error(`El documento Markdown "${file.name}" está vacío o contiene sólo caracteres no válidos.`);
  }

  const defaultTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
  let docTitle = defaultTitle;

  const lines = clean.split('\n');
  const sections: DocumentSection[] = [];

  let currentHeading = '';
  let currentLines: string[] = [];
  let pageCounter = 1;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      // Si es el primer H1 y aún no hemos asignado un título personalizado
      if (headingMatch[1] === '#' && docTitle === defaultTitle) {
        docTitle = headingMatch[2].trim();
      }

      // Cerrar sección previa
      if (currentLines.length > 0) {
        const textContent = currentLines.join('\n').trim();
        if (textContent.length > 0) {
          sections.push({
            title: currentHeading || undefined,
            chapter: currentHeading || undefined,
            page: pageCounter++,
            content: textContent
          });
        }
        currentLines = [];
      }

      currentHeading = headingMatch[2].trim();
    } else {
      currentLines.push(line);
    }
  }

  // Guardar última sección pendiente
  if (currentLines.length > 0) {
    const textContent = currentLines.join('\n').trim();
    if (textContent.length > 0) {
      sections.push({
        title: currentHeading || undefined,
        chapter: currentHeading || undefined,
        page: pageCounter,
        content: textContent
      });
    }
  }

  // Si no había encabezados, tratar como texto uniforme
  if (sections.length === 0 && clean.length > 0) {
    sections.push({
      page: 1,
      content: clean
    });
  }

  const words = clean.split(/\s+/).filter(w => w.length > 0).length;

  return {
    title: docTitle || defaultTitle || file.name,
    fileType: 'md',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount: sections.length || 1,
    sections,
    rawText: clean,
    estimatedWords: words
  };
}
