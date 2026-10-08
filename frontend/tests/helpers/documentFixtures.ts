import { zipSync, strToU8, zlibSync } from 'fflate';

/**
 * Fixtures reales para los tests de ingestión.
 *
 * Los tests anteriores usaban "PDFs" que no eran PDFs de verdad (sin xref,
 * sin tabla de objetos), de modo que sólo el scraper a mano los aceptaba. Aquí
 * se construyen documentos sintácticamente válidos —con tabla xref, streams
 * comprimidos con FlateDecode, codificaciones y EPUB ZIP reales— para ejercitar
 * el parser del mismo modo que lo haría un archivo del usuario.
 */

export interface MockFile {
  name: string;
  size: number;
  text: () => Promise<string>;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

export function createMockFile(name: string, content: string | Uint8Array): MockFile {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.byteLength,
    text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

function latin1Bytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

export interface BuildPdfOptions {
  /** Comprime los streams de contenido con /FlateDecode. */
  compress?: boolean;
  /** Marca el documento como cifrado (Standard security handler). */
  encrypt?: boolean;
  /** Codificación de fuente: `WinAnsi` para acentos. */
  encoding?: 'Standard' | 'WinAnsi';
  /** Escribe el texto como string hexadecimal `<...> Tj`. */
  hexStrings?: boolean;
  /** Añade basura antes de la cabecera %PDF- (cabecera desplazada). */
  leadingGarbage?: boolean;
  /** Páginas sin ningún operador de texto (simula un escaneo). */
  imageOnly?: boolean;
}

/**
 * Construye un PDF 1.4 mínimo pero sintácticamente correcto, con tabla xref
 * válida. Cada elemento de `pages` es el texto de una página.
 */
export function buildPdf(pages: string[], options: BuildPdfOptions = {}): Uint8Array {
  const { compress = false, encrypt = false, encoding = 'Standard', hexStrings = false } = options;
  const objects: string[] = [];
  const count = Math.max(pages.length, 1);

  const kids = Array.from({ length: count }, (_, i) => `${3 + i * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Catalog /Pages 2 0 R >>`);
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${count} >>`);

  const contentNumbers: number[] = [];
  let nextNumber = 3;
  for (let i = 0; i < count; i++) {
    nextNumber++; // página
    contentNumbers.push(nextNumber);
    nextNumber++; // contenido
  }
  const fontNumber = nextNumber;

  for (let i = 0; i < count; i++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentNumbers[i]} 0 R /Resources << /Font << /F1 ${fontNumber} 0 R >> >> >>`
    );
    const text = pages[i] ?? '';
    let operators: string;
    if (options.imageOnly || text === '') {
      // Una página con contenido gráfico pero sin operadores de texto.
      operators = '0 0 1 rg 10 10 100 100 re f';
    } else if (hexStrings) {
      const hex = Array.from(text, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
      operators = `BT /F1 12 Tf 72 720 Td <${hex}> Tj ET`;
    } else {
      operators = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    }

    if (compress) {
      const deflated = zlibSync(latin1Bytes(operators));
      let binary = '';
      for (const byte of deflated) binary += String.fromCharCode(byte);
      objects.push(`<< /Length ${deflated.length} /Filter /FlateDecode >>\nstream\n${binary}\nendstream`);
    } else {
      objects.push(`<< /Length ${operators.length} >>\nstream\n${operators}\nendstream`);
    }
  }

  const fontEncoding = encoding === 'WinAnsi' ? '/Encoding /WinAnsiEncoding' : '';
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica ${fontEncoding} >>`);

  let encryptRef = '';
  if (encrypt) {
    objects.push(`<< /Filter /Standard /V 1 /R 2 /O <${'aa'.repeat(32)}> /U <${'bb'.repeat(32)}> /P -1 >>`);
    encryptRef = ` /Encrypt ${objects.length} 0 R`;
  }

  // El basurero previo desplaza todas las posiciones absolutas del archivo, así
  // que se genera primero para que la tabla xref siga siendo correcta.
  const prefix = options.leadingGarbage ? '% basura de preambulo\n'.repeat(5) : '';

  let output = `${prefix}%PDF-1.4\n`;
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(output.length);
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${encryptRef} >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return latin1Bytes(output);
}

/** PDF truncado a la mitad: cabecera válida, estructura destruida. */
export function buildTruncatedPdf(): Uint8Array {
  const full = buildPdf(['Contenido que se corta a la mitad']);
  return full.slice(0, Math.floor(full.length / 2));
}

export interface BuildEpubOptions {
  /** Directorio que contiene el OPF (p. ej. `OEBPS`). */
  opfDir?: string;
  /** Ruta del OPF relativa a la raíz (por defecto `${opfDir}/content.opf`). */
  opfPath?: string;
  title?: string;
  author?: string;
  /** Capítulos en orden de spine: [{ href, html }]. */
  chapters?: Array<{ href: string; html: string }>;
  /** Contenido de META-INF/container.xml; `null` para omitirlo. */
  containerXml?: string | null;
  /** Entradas ZIP extra que se añaden tal cual (tests de abuso). */
  extraEntries?: Record<string, Uint8Array>;
}

/**
 * Construye un EPUB (contenedor ZIP OCF) real y comprimido.
 */
export function buildEpub(options: BuildEpubOptions = {}): Uint8Array {
  const opfDir = options.opfDir ?? 'OEBPS';
  const opfPath = options.opfPath ?? `${opfDir}/content.opf`;
  const title = options.title ?? 'Libro de Prueba';
  const author = options.author ?? 'Autor de Prueba';
  const chapters = options.chapters ?? [
    { href: 'cap1.xhtml', html: '<html><head><title>Uno</title></head><body><h1>Capítulo Uno</h1><p>Primer capítulo con contenido suficiente para ser útil.</p></body></html>' },
    { href: 'cap2.xhtml', html: '<html><body><h1>Capítulo Dos</h1><p>Segundo capítulo del libro de pruebas locales.</p></body></html>' }
  ];

  const files: Record<string, Uint8Array> = {};

  const container =
    options.containerXml === null
      ? null
      : options.containerXml ??
        `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  if (container) files['META-INF/container.xml'] = strToU8(container);

  const manifestItems = chapters
    .map((c, i) => `<item id="chap${i + 1}" href="${c.href}" media-type="application/xhtml+xml"/>`)
    .join('\n    ');
  const spineItems = chapters.map((_, i) => `<itemref idref="chap${i + 1}"/>`).join('\n    ');

  files[opfPath] = strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>${title}</dc:title>
    <dc:creator>${author}</dc:creator>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`);

  for (const chapter of chapters) {
    // El href del manifest puede venir percent-encoded; la entrada ZIP real usa
    // el nombre ya decodificado (es lo que hace un EPUB de verdad).
    const resolved = resolveForFixture(opfDir, decodeHref(chapter.href));
    files[resolved] = strToU8(chapter.html);
  }

  for (const [key, value] of Object.entries(options.extraEntries ?? {})) {
    files[key] = value;
  }

  // mimetype sin comprimir en primera posición, como exige la especificación OCF.
  const mimetype = strToU8('application/epub+zip');
  return zipSync({ 'mimetype': [mimetype, { level: 0 }], ...files });
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function resolveForFixture(baseDir: string, href: string): string {
  const parts = `${baseDir}/${href}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') stack.pop();
    else stack.push(part);
  }
  return stack.join('/');
}

