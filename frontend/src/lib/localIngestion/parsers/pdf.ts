import type { ParsedDocument, DocumentSection } from '../types.ts';
import { DocumentExtractionError } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';
import { normalizeExtractedText } from '../textUtils.ts';

/**
 * PDF text extractor based on pdf.js (Mozilla), running locally.
 *
 * The previous scraper read the file as latin1 and looked for `( ... ) Tj`
 * literals inside the binary. That failed on real PDFs for two reasons:
 *
 *  1. Most streams are compressed with `/FlateDecode`; the regex never saw the
 *     text operators.
 *  2. Strings may arrive in hexadecimal (`<...> Tj`), with `TJ` arrays, fonts
 *     using non-standard `/Encoding`, ToUnicode CMaps, and so on.
 *
 * pdf.js solves all of that (decompression, CMaps, encodings, content-based
 * reading order) with no network and no canvas: only its text-extraction layer
 * is used. Text extraction needs no glyph rendering, so font/offscreen-canvas
 * support stays disabled.
 *
 * The PDF is never written to disk: it is handed over in memory as a `Uint8Array`.
 */

/** PDF header signature; it may sit up to 1024 bytes in when leading junk exists. */
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
 * Loads pdf.js lazily and memoized. The `legacy` build is the only one that
 * behaves the same on Node (tests) and in the browser: the modern build uses
 * `Promise.try`, absent on somewhat older runtimes, and its worker would break
 * the test runner.
 */
async function getPdfjs(): Promise<PdfJsModule> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs') as Promise<PdfJsModule>;
  }
  return pdfjsModulePromise;
}

/**
 * In the browser pdf.js needs a real worker; on Node it uses the "fake worker"
 * (main thread) and nothing needs configuring. The worker resolves from the
 * local bundle (`?url`), never from a CDN.
 */
async function ensureWorkerConfigured(pdfjs: PdfJsModule): Promise<void> {
  if (typeof window === 'undefined') return;
  const workerOptions = (pdfjs as any).GlobalWorkerOptions;
  if (!workerOptions || workerOptions.workerSrc) return;
  try {
    const workerModule: { default: string } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
    workerOptions.workerSrc = workerModule.default;
  } catch {
    // Without an explicit worker pdf.js degrades to main-thread execution.
  }
}

/** Maps pdf.js exceptions to typed errors carrying a user-facing message. */
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
 * Joins a page's text items honoring the line breaks pdf.js marks with
 * `hasEOL`. pdf.js delivers items in page content-stream order (the usual
 * reading order).
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

const MAX_BROWSER_PDF_BYTES = 100 * 1024 * 1024; // 100 MB browser memory limit

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
      // Local, deterministic execution: no remote resources and no canvas.
      disableFontFace: true,
      useSystemFonts: false,
      useWorkerFetch: false,
      isOffscreenCanvasSupported: false,
      // Silences warnings about missing standard fonts (they do not affect text).
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
 * Releases the loading task (and with it the worker and document structures).
 * `destroy()` lives on the loading task, not on the document proxy; a failed
 * release must never mask the real extraction result.
 */
async function safeDestroy(loadingTask: any): Promise<void> {
  try {
    await loadingTask?.destroy?.();
  } catch {
    /* no-op */
  }
}
