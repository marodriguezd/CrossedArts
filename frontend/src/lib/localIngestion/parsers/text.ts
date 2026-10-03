import type { ParsedDocument, DocumentSection } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';

/**
 * Limpia y normaliza texto plano eliminando caracteres de control nulos
 * y preservando saltos de línea y párrafos.
 */
export function sanitizePlainText(input: string): string {
  return input
    .replace(/\0/g, '') // Eliminar null bytes
    .replace(/\r\n/g, '\n') // Normalizar saltos CRLF a LF
    .replace(/\r/g, '\n')
    .replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Eliminar caracteres de control no imprimibles
    .trim();
}

/**
 * Parsea un archivo .txt plano dividiéndolo en secciones lógicas o párrafos
 * si supera una longitud determinada.
 */
export async function parseTextFile(
  file: { name: string; size: number; text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  const rawTextContent = await file.text();
  const clean = sanitizePlainText(rawTextContent);
  const fingerprint = await computeBinarySha256(await file.arrayBuffer());

  if (!clean.length) {
    throw new Error(`El archivo de texto "${file.name}" está vacío o contiene sólo caracteres no válidos.`);
  }

  // Título derivado del nombre del archivo (sin extensión)
  const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();

  // Dividir en secciones acotadas por párrafos dobles
  const rawParagraphs = clean.split(/\n\s*\n+/);
  const sections: DocumentSection[] = [];
  
  let currentBlock = '';
  let approxPage = 1;

  for (const p of rawParagraphs) {
    const trimmedP = p.trim();
    if (!trimmedP) continue;

    if (currentBlock.length + trimmedP.length > 1500) {
      if (currentBlock) {
        sections.push({
          page: approxPage,
          content: currentBlock.trim()
        });
        approxPage++;
      }
      currentBlock = trimmedP;
    } else {
      currentBlock = currentBlock ? `${currentBlock}\n\n${trimmedP}` : trimmedP;
    }
  }

  if (currentBlock.trim()) {
    sections.push({
      page: approxPage,
      content: currentBlock.trim()
    });
  }

  const words = clean.split(/\s+/).filter(w => w.length > 0).length;

  return {
    title: title || file.name,
    fileType: 'txt',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount: sections.length || 1,
    sections,
    rawText: clean,
    estimatedWords: words
  };
}
