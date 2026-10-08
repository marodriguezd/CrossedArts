import type { ParsedDocument, DocumentSection } from '../types.ts';
import { DocumentExtractionError } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';
import { normalizeExtractedText } from '../textUtils.ts';

/**
 * Extractor de texto PDF basado en pdf.js (Mozilla), ejecutado en local.
 *
 * El scraper anterior leía el archivo en latin1 y buscaba literales `( ... ) Tj`
 * dentro del binario. Eso fallaba con los PDF reales por dos motivos:
 *
 *  1. La mayoría de los streams están comprimidos con `/FlateDecode`; el regex
 *     nunca veía los operadores de texto.
 *  2. Los strings pueden venir en hexadecimal (`<...> Tj`), con `TJ` arrays,
 *     fuentes con `/Encoding` no estándar, ToUnicode CMaps, etc.
 *
 * pdf.js resuelve todo eso (descompresión, CMaps, codificaciones, orden de
 * lectura por contenido) sin red y sin canvas: sólo se usa su capa de
 * extracción de texto. La extracción de texto no necesita renderizar glifos,
 * por lo que se desactiva el soporte de fuentes/offscreen canvas.
 *
 * El PDF no se escribe nunca en disco: se entrega en memoria como `Uint8Array`.
 */

/** Firma de cabecera PDF; puede estar desplazada hasta 1024 bytes si hay basura previa. */
function findPdfMagic(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length - 4, 1024);
  for (let offset = 0; offset <= limit; offset++) {
    if (
      bytes[offset] === 0x25 && // %
      bytes[offset + 1] === 0x50 && // P
      bytes[offset + 2] === 0x44 && // D
      bytes[offset + 3] === 0x46 && // F
      bytes[offset + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

type PdfJsModule = typeof import('pdfjs-dist');

let pdfjsModulePromise: Promise<PdfJsModule> | null = null;

/**
 * Carga pdf.js en diferido y memoria. El build `legacy` es el único que
 * funciona igual en Node (tests) y navegador: el build moderno usa
 * `Promise.try`, ausente en runtimes algo antiguos, y su worker rompería el
 * runner de tests.
 */
async function getPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsModule>;
  }
  return pdfjsModulePromise;
}

/**
 * En el navegador pdf.js necesita un worker real; en Node usa el "fake worker"
 * (hilo principal) y no hay que configurar nada. El worker se resuelve desde el
 * bundle local (`?url`), nunca desde una CDN.
 */
async function ensureWorkerConfigured(pdfjs: PdfJsModule): Promise<void> {
  if (typeof window === 'undefined') return;
  const workerOptions = (pdfjs as any).GlobalWorkerOptions;
  if (!workerOptions || workerOptions.workerSrc) return;
  try {
    const workerModule: { default: string } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    workerOptions.workerSrc = workerModule.default;
  } catch {
    // Sin worker explícito pdf.js degrada a ejecución en el hilo principal.
  }
}

/** Traduce las excepciones de pdf.js a errores tipados con mensaje en español. */
function mapPdfError(err: unknown, fileName: string): DocumentExtractionError {
  const name = (err as { name?: string })?.name ?? '';
  switch (name) {
    case 'PasswordException':
      return new DocumentExtractionError(
        'encrypted',
        `El PDF "${fileName}" está protegido con contraseña y no puede procesarse sin ella.`
      );
    case 'InvalidPDFException':
      return new DocumentExtractionError(
        'malformed',
        `El archivo "${fileName}" no es un PDF válido o está dañado.`
      );
    default: {
      const detail = (err as { message?: string })?.message;
      return new DocumentExtractionError(
        'malformed',
        `No se pudo leer el PDF "${fileName}"${detail ? `: ${detail}` : '.'}`
      );
    }
  }
}

/**
 * Une los items de texto de una página respetando los saltos de línea que
 * pdf.js marca con `hasEOL`. pdf.js entrega los items en el orden del flujo de
 * contenido de la página (el orden de lectura habitual).
 */
export function joinTextItems(items: ReadonlyArray<{ str?: string; hasEOL?: boolean }>): string {
  const parts: string[] = [];
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    parts.push(item.str);
    if (item.hasEOL) parts.push('\n');
  }
  return normalizeExtractedText(parts.join(''));
}

const MAX_BROWSER_PDF_BYTES = 100 * 1024 * 1024; // 100 MB límite de memoria en navegador

export async function parsePdfFile(
  file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  if (file.size > MAX_BROWSER_PDF_BYTES) {
    throw new DocumentExtractionError(
      'file-too-large',
      `El documento PDF "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) supera el límite de memoria del navegador (100 MB).`
    );
  }

  const buffer = await file.arrayBuffer();
  const fingerprint = await computeBinarySha256(buffer);
  const bytes = new Uint8Array(buffer);

  if (bytes.byteLength === 0) {
    throw new DocumentExtractionError('empty', `El archivo "${file.name}" está vacío.`);
  }

  if (bytes.byteLength > MAX_BROWSER_PDF_BYTES) {
    throw new DocumentExtractionError(
      'file-too-large',
      `El documento PDF "${file.name}" (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB) supera el límite de memoria del navegador (100 MB).`
    );
  }

  if (!findPdfMagic(bytes)) {
    throw new DocumentExtractionError(
      'malformed',
      `El archivo "${file.name}" no es un documento PDF válido (cabecera %PDF- ausente).`
    );
  }

  const pdfjs = await getPdfjs();
  await ensureWorkerConfigured(pdfjs);

  let doc: any;
  let loadingTask: any;
  try {
    loadingTask = pdfjs.getDocument({
      data: bytes,
      // Ejecución local y determinista: sin recursos remotos ni canvas.
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      // Silencia avisos de fuentes estándar ausentes (no afectan al texto).
      verbosity: 0
    });
    doc = await loadingTask.promise;
  } catch (err) {
    await safeDestroy(loadingTask);
    throw mapPdfError(err, file.name);
  }

  const pageCount: number = doc.numPages ?? 0;
  if (pageCount === 0) {
    await safeDestroy(loadingTask);
    throw new DocumentExtractionError('empty', `El PDF "${file.name}" no contiene páginas.`);
  }

  const sections: DocumentSection[] = [];
  let overallText = '';

  try {
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = joinTextItems(textContent.items as any);
      if (pageText.trim().length > 0) {
        sections.push({ page: pageNumber, content: pageText });
        overallText += (overallText ? '\n\n' : '') + pageText;
      }
      page.cleanup?.();
    }
  } catch (err) {
    await safeDestroy(loadingTask);
    throw mapPdfError(err, file.name);
  } finally {
    await safeDestroy(loadingTask);
  }

  if (!overallText.trim()) {
    throw new DocumentExtractionError(
      'image-only',
      `No se pudo extraer texto legible del PDF "${file.name}". Puede contener sólo imágenes escaneadas y requerir OCR (no disponible sin conexión) o estar cifrado.`
    );
  }

  const skippedSections = pageCount - sections.length;
  const title = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
  const words = overallText.split(/\s+/).filter((w) => w.length > 0).length;

  return {
    title: title || file.name,
    fileType: 'pdf',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount,
    sections,
    rawText: overallText,
    estimatedWords: words,
    extraction: {
      status: skippedSections === 0 ? 'ok' : 'partial',
      skippedSections,
      warning:
        skippedSections > 0
          ? `${skippedSections} de ${pageCount} páginas no aportaron texto (probablemente escaneadas).`
          : undefined
    }
  };
}

/**
 * Libera el loading task (y con él el worker y las estructuras del documento).
 * `destroy()` vive en el loading task, no en el proxy del documento; una
 * liberación fallida nunca debe enmascarar el resultado real de la extracción.
 */
async function safeDestroy(loadingTask: any): Promise<void> {
  try {
    await loadingTask?.destroy?.();
  } catch {
    /* no-op */
  }
}
