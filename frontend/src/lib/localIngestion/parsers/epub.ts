import { unzipSync, strFromU8 } from 'fflate';
import { parseDocument } from 'htmlparser2';
import type { ParsedDocument, DocumentSection } from '../types.ts';
import { DocumentExtractionError } from '../types.ts';
import { computeBinarySha256 } from '../fingerprint.ts';
import { normalizeExtractedText } from '../textUtils.ts';

/**
 * Extractor EPUB basado en el contenedor ZIP OCF real.
 *
 * El parser anterior leía el archivo completo como latin1 y buscaba
 * `<html>...</html>` en el binario: eso sólo funciona con EPUB sin comprimir y,
 * aun así, mezcla entradas y no respeta el orden del spine. Un EPUB estándar es
 * un ZIP cuyo contenido está comprimido con Deflate, por lo que el texto nunca
 * era legible como cadena.
 *
 * Aquí se hace lo correcto, todo en memoria y sin red:
 *   1. Se descomprime el ZIP con límites anti-bomba.
 *   2. Se lee `META-INF/container.xml` y se resuelve el OPF.
 *   3. Se parsea el OPF: metadatos, manifest y spine.
 *   4. Se recorre el spine y se extrae el texto de cada XHTML con un parser
 *      real (htmlparser2), respetando fronteras de capítulo.
 */

/** Límites anti-bomba (alineados con el extractor del backend). */
const MAX_ENTRIES = 5000;
const MAX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024; // 10 MB por entrada
const MAX_TOTAL_UNCOMPRESSED_BYTES = 100 * 1024 * 1024; // 100 MB en total

/** Nodo DOM mínimo (estructural) para no depender de los tipos de domhandler. */
interface DomNode {
  type: string;
  name?: string;
  attribs?: Record<string, string>;
  data?: string;
  children?: DomNode[];
}

/** Firma local de fichero ZIP: `PK\x03\x04` (también se acepta ZIP vacío). */
function hasZipMagic(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const isLocal = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  const isEmpty = bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x05 && bytes[3] === 0x06;
  return isLocal || isEmpty;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? '' : path.slice(0, idx);
}

/**
 * Resuelve un href relativo (o absoluto dentro del contenedor) contra el
 * directorio base y devuelve una ruta normalizada.
 *
 * Devuelve `null` si la ruta escapa de la raíz del archivo (`..`), contiene un
 * byte nulo o queda vacía. Nunca se confía en la ruta del archivo: sólo se usan
 * como claves exactas contra las entradas ya descomprimidas.
 */
export function resolveArchivePath(baseDir: string, href: string): string | null {
  const withoutFragment = href.split('#')[0].split('?')[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    // Href con porcentaje mal formado: se usa tal cual (puede ser válido).
    decoded = withoutFragment;
  }
  if (decoded.includes('\0')) return null;

  const isAbsolute = decoded.startsWith('/');
  const combined = isAbsolute
    ? decoded.slice(1)
    : `${baseDir ? `${baseDir}/` : ''}${decoded}`;

  const stack: string[] = [];
  for (const segment of combined.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (stack.length === 0) return null; // fuga fuera de la raíz
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.length === 0 ? null : stack.join('/');
}

function parseDom(source: string, xmlMode: boolean): DomNode {
  const options = xmlMode
    ? { xmlMode: true, decodeEntities: true }
    : { decodeEntities: true, recognizeSelfClosing: true };
  return parseDocument(source, options) as unknown as DomNode;
}

function findByTagName(nodes: readonly DomNode[] | undefined, tagName: string, out: DomNode[] = []): DomNode[] {
  if (!nodes) return out;
  for (const node of nodes) {
    if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
      if (node.name?.toLowerCase() === tagName.toLowerCase()) out.push(node);
      if (node.children) findByTagName(node.children, tagName, out);
    }
  }
  return out;
}

/** Texto plano de un elemento (recursivo, sin etiquetas). */
export function elementText(el: DomNode): string {
  let text = '';
  for (const child of el.children ?? []) {
    if (child.type === 'text') text += child.data ?? '';
    else if (child.type === 'tag' || child.type === 'script' || child.type === 'style') {
      const name = child.name?.toLowerCase();
      if (name === 'script' || name === 'style') continue;
      text += elementText(child);
    }
  }
  return text;
}

const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'div', 'dl', 'dd', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section', 'table',
  'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul'
]);

const SKIPPED_TAGS = new Set(['script', 'style', 'head', 'title', 'template', 'noscript']);

/**
 * Extrae el texto visible de un documento XHTML respetando las fronteras de
 * bloque (párrafos, títulos, ítems de lista) mediante un parser HTML real, no
 * con expresiones regulares sobre el marcado.
 */
export function extractXhtmlText(xhtml: string): string {
  const root = parseDom(xhtml, false);
  const parts: string[] = [];

  const walk = (nodes: readonly DomNode[] | undefined): void => {
    for (const node of nodes ?? []) {
      if (node.type === 'text') {
        parts.push(node.data ?? '');
        continue;
      }
      if (node.type !== 'tag') continue;
      const name = node.name?.toLowerCase() ?? '';
      if (SKIPPED_TAGS.has(name)) continue;
      if (name === 'br') {
        parts.push('\n');
        continue;
      }
      const isBlock = BLOCK_TAGS.has(name);
      if (isBlock) parts.push('\n');
      walk(node.children);
      if (isBlock) parts.push('\n');
    }
  };

  walk(root.children);
  return normalizeExtractedText(parts.join(''));
}

interface UnzipResult {
  entries: Record<string, Uint8Array>;
}

/**
 * Descomprime el contenedor aplicando los límites anti-bomba. Lanza
 * `archive-too-large` cuando se supera el número de entradas o el tamaño.
 */
export function unzipWithLimits(bytes: Uint8Array, fileName: string): UnzipResult {
  let count = 0;
  let total = 0;
  let exceeded = false;

  const entries = unzipSync(bytes, {
    filter: (info) => {
      count += 1;
      total += info.originalSize ?? 0;
      if (
        count > MAX_ENTRIES ||
        (info.originalSize ?? 0) > MAX_ENTRY_UNCOMPRESSED_BYTES ||
        total > MAX_TOTAL_UNCOMPRESSED_BYTES
      ) {
        exceeded = true;
        return false;
      }
      return true;
    }
  });

  if (exceeded) {
    throw new DocumentExtractionError(
      'archive-too-large',
      `El EPUB "${fileName}" supera los límites de seguridad de importación (demasiadas entradas o demasiado grande descomprimido).`
    );
  }
  return { entries };
}

const MAX_BROWSER_EPUB_BYTES = 100 * 1024 * 1024; // 100 MB límite en navegador

export async function parseEpubFile(
  file: { name: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> }
): Promise<ParsedDocument> {
  if (file.size > MAX_BROWSER_EPUB_BYTES) {
    throw new DocumentExtractionError(
      'file-too-large',
      `El documento EPUB "${file.name}" (${(file.size / (1024 * 1024)).toFixed(1)} MB) supera el límite de memoria del navegador (100 MB).`
    );
  }

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const fingerprint = await computeBinarySha256(buffer);

  if (bytes.byteLength === 0) {
    throw new DocumentExtractionError('empty', `El archivo "${file.name}" está vacío.`);
  }

  if (bytes.byteLength > MAX_BROWSER_EPUB_BYTES) {
    throw new DocumentExtractionError(
      'file-too-large',
      `El documento EPUB "${file.name}" (${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MB) supera el límite de memoria del navegador (100 MB).`
    );
  }

  if (!hasZipMagic(bytes)) {
    throw new DocumentExtractionError(
      'malformed',
      `El archivo "${file.name}" no es un contenedor EPUB/ZIP válido (firma PK ausente).`
    );
  }

  let entries: Record<string, Uint8Array>;
  try {
    ({ entries } = unzipWithLimits(bytes, file.name));
  } catch (err) {
    if (err instanceof DocumentExtractionError) throw err;
    throw new DocumentExtractionError(
      'malformed',
      `No se pudo descomprimir el EPUB "${file.name}": el contenedor ZIP está dañado.`
    );
  }

  const opfPath = resolveOpfPath(entries, file.name);
  const opf = parseOpf(strFromU8(entries[opfPath]), opfPath, file.name);

  const sections: DocumentSection[] = [];
  let overallText = '';
  let skippedSections = 0;

  for (const href of opf.spine) {
    const resolved = resolveArchivePath(dirname(opfPath), href);
    const entryBytes = resolved ? entries[resolved] : undefined;
    if (!entryBytes) {
      skippedSections += 1;
      continue;
    }
    const html = strFromU8(entryBytes);
    const content = extractXhtmlText(html);
    if (!content) {
      skippedSections += 1;
      continue;
    }
    const chapterTitle = extractChapterTitle(html, sections.length + 1);
    sections.push({
      chapter: chapterTitle,
      title: chapterTitle,
      page: sections.length + 1,
      content
    });
    overallText += (overallText ? '\n\n' : '') + content;
  }

  if (sections.length === 0 || !overallText.trim()) {
    throw new DocumentExtractionError(
      'image-only',
      `No se pudo extraer texto utilizable del EPUB "${file.name}". El libro puede contener sólo imágenes o su spine estar vacío.`
    );
  }

  return {
    title: opf.title || file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim() || file.name,
    author: opf.author,
    fileType: 'epub',
    fileName: file.name,
    fileSizeBytes: file.size,
    fingerprint,
    pageCount: sections.length,
    sections,
    rawText: overallText,
    estimatedWords: overallText.split(/\s+/).filter((w) => w.length > 0).length,
    extraction: {
      status: skippedSections === 0 ? 'ok' : 'partial',
      skippedSections,
      warning:
        skippedSections > 0
          ? `${skippedSections} capítulo(s) no aportaron texto o no pudieron resolverse.`
          : undefined
    }
  };
}

/** Localiza el OPF a partir de `META-INF/container.xml`, con respaldo heurístico. */
function resolveOpfPath(entries: Record<string, Uint8Array>, fileName: string): string {
  const containerKey = Object.keys(entries).find((k) => k.toLowerCase() === 'meta-inf/container.xml');
  if (containerKey) {
    const root = parseDom(strFromU8(entries[containerKey]), true);
    for (const rootfile of findByTagName(root.children, 'rootfile')) {
      const fullPath = rootfile.attribs?.['full-path'];
      if (fullPath) {
        const resolved = resolveArchivePath('', fullPath);
        if (resolved && entries[resolved]) return resolved;
      }
    }
  }

  // Respaldo: primer `.opf` del archivo (por orden de entrada determinista).
  const fallback = Object.keys(entries)
    .filter((k) => k.toLowerCase().endsWith('.opf'))
    .sort()[0];
  if (fallback) return fallback;

  throw new DocumentExtractionError(
    'malformed',
    `El EPUB "${fileName}" no declara un paquete OPF (META-INF/container.xml ausente o sin rootfile).`
  );
}

interface OpfDocument {
  title?: string;
  author?: string;
  spine: string[];
}

/** Parsea el OPF y devuelve metadatos + la lista ordenada de hrefs del spine. */
function parseOpf(xml: string, opfPath: string, fileName: string): OpfDocument {
  const root = parseDom(xml, true);
  const manifest = findByTagName(root.children, 'item');
  const spineItems = findByTagName(root.children, 'itemref');

  const hrefById = new Map<string, string>();
  for (const item of manifest) {
    const id = item.attribs?.id;
    const href = item.attribs?.href;
    if (id && href) hrefById.set(id, href);
  }

  const spine: string[] = [];
  for (const itemref of spineItems) {
    const idref = itemref.attribs?.idref;
    const href = idref ? hrefById.get(idref) : undefined;
    if (href) spine.push(href);
  }

  if (spine.length === 0) {
    throw new DocumentExtractionError(
      'malformed',
      `El EPUB "${fileName}" no tiene un spine de lectura válido en ${opfPath}.`
    );
  }

  const titleEl = findByTagName(root.children, 'dc:title')[0];
  const creatorEl = findByTagName(root.children, 'dc:creator')[0];

  return {
    title: titleEl ? elementText(titleEl).trim() : undefined,
    author: creatorEl ? elementText(creatorEl).trim() || undefined : undefined,
    spine
  };
}

/** Título del capítulo: primer h1/h2/h3 o `<title>`, con respaldo numerado. */
function extractChapterTitle(html: string, index: number): string {
  const root = parseDom(html, false);
  for (const tag of ['h1', 'h2', 'h3']) {
    const el = findByTagName(root.children, tag)[0];
    const text = el ? elementText(el).trim() : '';
    if (text) return text;
  }
  const titleEl = findByTagName(root.children, 'title')[0];
  const titleText = titleEl ? elementText(titleEl).trim() : '';
  return titleText || `Sección ${index}`;
}
