import type { ParsedDocument, DocumentSection } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';

/**
 * Extractor de texto puro para PDF sin dependencias pesadas de canvas o node.
 * Extrae streams de texto plano delimitados por BT ... ET y operadores Tj / TJ,
 * reconociendo saltos de página delimitados por /Type /Page.
 */
export async function parsePdfFile(
  file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  const buffer = await file.arrayBuffer();
  const fingerprint = await computeBinarySha256(buffer);
  const bytes = new Uint8Array(buffer);

  // Comprobar cabecera mágica de PDF (%PDF-)
  const magic = String.fromCharCode(...bytes.slice(0, 5));
  if (magic !== '%PDF-') {
    throw new Error(`El archivo "${file.name}" no es un documento PDF válido (cabecera ausente).`);
  }

  const decoder = new TextDecoder('latin1');
  const fullContent = decoder.decode(bytes);

  // Extraer bloques de página o streams de texto
  // Buscamos streams que contengan operadores de texto PDF (BT ... ET)
  const streamRegex = /stream[\r\n]+([\s\S]*?)[\r\n]+endstream/g;
  let match: RegExpExecArray | null;

  const extractedPages: DocumentSection[] = [];
  let pageCounter = 1;
  let overallText = '';

  // Dividir aproximadamente por páginas si existen objetos /Page
  const pageMatches = fullContent.split(/\/Type\s*\/Page\b/);
  const rawPageCount = Math.max(pageMatches.length - 1, 1);

  // Intentar decodificar operadores de texto en streams
  while ((match = streamRegex.exec(fullContent)) !== null) {
    const rawStream = match[1];
    
    // Extraer strings entre paréntesis en operadores Tj o arreglos TJ
    // Ejemplo: (Texto) Tj  o  [(T) 10 (exto)] TJ
    const textPieces: string[] = [];
    const textOpRegex = /(?:\((.*?)\)\s*Tj|\[(.*?)\]\s*TJ)/g;
    let opMatch: RegExpExecArray | null;

    while ((opMatch = textOpRegex.exec(rawStream)) !== null) {
      if (opMatch[1] !== undefined) {
        textPieces.push(unescapePdfString(opMatch[1]));
      } else if (opMatch[2] !== undefined) {
        // En un arreglo TJ, buscar todos los fragmentos ( ... )
        const tjPartRegex = /\((.*?)\)/g;
        let partMatch: RegExpExecArray | null;
        while ((partMatch = tjPartRegex.exec(opMatch[2])) !== null) {
          textPieces.push(unescapePdfString(partMatch[1]));
        }
      }
    }

    if (textPieces.length > 0) {
      const pageText = textPieces.join(' ').replace(/\s+/g, ' ').trim();
      if (pageText.length > 20) {
        extractedPages.push({
          page: pageCounter++,
          content: pageText
        });
        overallText += (overallText ? '\n\n' : '') + pageText;
      }
    }
  }

  // Si los streams estaban comprimidos (FlateDecode) o no tenían texto simple Tj,
  // extraer cadenas de texto legibles del archivo como fallback de emergencia
  if (extractedPages.length === 0) {
    const fallbackText = extractAsciiStrings(fullContent);
    if (fallbackText.length >= 30) {
      extractedPages.push({
        page: 1,
        content: fallbackText
      });
      overallText = fallbackText;
    }
  }

  if (extractedPages.length === 0 || !overallText.trim()) {
    throw new Error(`No se pudo extraer texto legible del PDF "${file.name}". Puede contener solo imágenes escaneadas o estar protegido por contraseña.`);
  }

  const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();

  const words = overallText.split(/\s+/).filter(w => w.length > 0).length;

  return {
    title: title || file.name,
    fileType: 'pdf',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount: Math.max(extractedPages.length, rawPageCount),
    sections: extractedPages,
    rawText: overallText,
    estimatedWords: words
  };
}

function unescapePdfString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractAsciiStrings(content: string): string {
  const matches = content.match(/[\x20-\x7E\xA0-\xFF]{4,}/g) || [];
  return matches
    .filter(m => !m.startsWith('/') && !m.startsWith('%') && !m.includes('obj') && !m.includes('endobj'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}
