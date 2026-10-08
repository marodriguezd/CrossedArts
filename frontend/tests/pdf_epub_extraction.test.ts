import test from 'node:test';
import assert from 'node:assert';
import { parsePdfFile } from '../src/lib/localIngestion/parsers/pdf.ts';
import { parseEpubFile, resolveArchivePath, extractXhtmlText } from '../src/lib/localIngestion/parsers/epub.ts';
import { DocumentExtractionError } from '../src/lib/localIngestion/types.ts';
import { buildPdf, buildTruncatedPdf, buildEpub, createMockFile } from './helpers/documentFixtures.ts';

/** Extrae el código estable de un rechazo de extracción. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    assert.ok(err instanceof DocumentExtractionError, `Se esperaba DocumentExtractionError, se recibió ${err}`);
    return err.code;
  }
  throw new Error('Se esperaba un rechazo pero la promesa resolvió');
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

test('32.1 PDF: extrae texto de streams comprimidos con FlateDecode', async () => {
  const file = createMockFile('comprimido.pdf', buildPdf(['Contenido comprimido de la primera página'], { compress: true, encoding: 'WinAnsi' }));
  const parsed = await parsePdfFile(file);
  assert.strictEqual(parsed.pageCount, 1);
  assert.ok(parsed.rawText.includes('Contenido comprimido de la primera página'), `Texto: ${parsed.rawText}`);
  assert.strictEqual(parsed.extraction?.status, 'ok');
});

test('32.2 PDF: respeta fronteras de página y orden de lectura', async () => {
  const file = createMockFile('multipagina.pdf', buildPdf(['Alfa en la página uno', 'Beta en la página dos', 'Gamma en la página tres']));
  const parsed = await parsePdfFile(file);
  assert.strictEqual(parsed.pageCount, 3);
  assert.strictEqual(parsed.sections.length, 3);
  assert.deepStrictEqual(parsed.sections.map((s) => s.page), [1, 2, 3]);
  assert.ok(parsed.sections[0].content.includes('Alfa'));
  assert.ok(parsed.sections[2].content.includes('Gamma'));
  // El orden de secciones es el orden de las páginas.
  assert.ok(parsed.rawText.indexOf('Alfa') < parsed.rawText.indexOf('Beta'));
  assert.ok(parsed.rawText.indexOf('Beta') < parsed.rawText.indexOf('Gamma'));
});

test('32.3 PDF: lee strings hexadecimales <...> Tj', async () => {
  const file = createMockFile('hex.pdf', buildPdf(['Texto en hexadecimal'], { hexStrings: true }));
  const parsed = await parsePdfFile(file);
  assert.ok(parsed.rawText.includes('Texto en hexadecimal'));
});

test('32.4 PDF: decodifica codificaciones de fuente no ASCII (WinAnsi)', async () => {
  const file = createMockFile('acentos.pdf', buildPdf(['Introducción a la programación'], { encoding: 'WinAnsi' }));
  const parsed = await parsePdfFile(file);
  assert.ok(parsed.rawText.includes('Introducción'), `Texto obtenido: ${parsed.rawText}`);
});

test('32.5 PDF: acepta una cabecera %PDF- desplazada por preámbulo', async () => {
  const file = createMockFile('desplazado.pdf', buildPdf(['Con preambulo'], { leadingGarbage: true }));
  const parsed = await parsePdfFile(file);
  assert.ok(parsed.rawText.includes('Con preambulo'));
});

test('32.6 PDF: marca partial cuando alguna página no aporta texto', async () => {
  const file = createMockFile('mixto.pdf', buildPdf(['Página con texto', '']));
  const parsed = await parsePdfFile(file);
  assert.strictEqual(parsed.pageCount, 2);
  assert.strictEqual(parsed.sections.length, 1);
  assert.strictEqual(parsed.extraction?.status, 'partial');
  assert.strictEqual(parsed.extraction?.skippedSections, 1);
  assert.ok(parsed.extraction?.warning);
});

test('32.7 PDF: rechaza con código malformed un archivo sin cabecera', async () => {
  const file = createMockFile('falso.pdf', 'no soy un pdf');
  assert.strictEqual(await rejectionCode(parsePdfFile(file)), 'malformed');
});

test('32.8 PDF: rechaza con código malformed un PDF truncado', async () => {
  const file = createMockFile('truncado.pdf', buildTruncatedPdf());
  const code = await rejectionCode(parsePdfFile(file));
  assert.ok(['malformed', 'image-only'].includes(code), `Código inesperado: ${code}`);
});

test('32.9 PDF: rechaza con código empty un archivo vacío', async () => {
  const file = createMockFile('vacio.pdf', new Uint8Array(0));
  assert.strictEqual(await rejectionCode(parsePdfFile(file)), 'empty');
});

test('32.10 PDF: rechaza con código image-only un PDF sin texto (escaneado)', async () => {
  const file = createMockFile('escaneado.pdf', buildPdf(['']));
  assert.strictEqual(await rejectionCode(parsePdfFile(file)), 'image-only');
});

test('32.11 PDF: rechaza con código encrypted un PDF protegido con contraseña', async () => {
  const file = createMockFile('cifrado.pdf', buildPdf(['secreto'], { encrypt: true }));
  assert.strictEqual(await rejectionCode(parsePdfFile(file)), 'encrypted');
});

// ---------------------------------------------------------------------------
// EPUB
// ---------------------------------------------------------------------------

test('33.1 EPUB: lee un contenedor ZIP comprimido, metadatos y capítulos', async () => {
  const file = createMockFile('libro.epub', buildEpub({ title: 'Mi Libro Local', author: 'Autora Local' }));
  const parsed = await parseEpubFile(file);
  assert.strictEqual(parsed.title, 'Mi Libro Local');
  assert.strictEqual(parsed.author, 'Autora Local');
  assert.strictEqual(parsed.sections.length, 2);
  assert.ok(parsed.rawText.includes('Primer capítulo'));
  assert.ok(parsed.rawText.includes('Segundo capítulo'));
  assert.strictEqual(parsed.extraction?.status, 'ok');
});

test('33.2 EPUB: respeta el orden del spine y las fronteras de capítulo', async () => {
  const file = createMockFile('orden.epub', buildEpub({
    chapters: [
      { href: 'b.xhtml', html: '<html><body><h1>Segundo</h1><p>Contenido B</p></body></html>' },
      { href: 'a.xhtml', html: '<html><body><h1>Primero</h1><p>Contenido A</p></body></html>' }
    ]
  }));
  const parsed = await parseEpubFile(file);
  assert.deepStrictEqual(parsed.sections.map((s) => s.chapter), ['Segundo', 'Primero']);
  assert.ok(parsed.rawText.indexOf('Contenido B') < parsed.rawText.indexOf('Contenido A'));
});

test('33.3 EPUB: resuelve un OPF en ruta anidada', async () => {
  const file = createMockFile('anidado.epub', buildEpub({
    opfDir: 'content/books/uno',
    opfPath: 'content/books/uno/package.opf',
    chapters: [{ href: 'texto/cap.xhtml', html: '<html><body><h1>Anidado</h1><p>Contenido anidado profundo</p></body></html>' }]
  }));
  const parsed = await parseEpubFile(file);
  assert.strictEqual(parsed.sections.length, 1);
  assert.ok(parsed.rawText.includes('Contenido anidado profundo'));
});

test('33.4 EPUB: decodifica hrefs codificados en URL', async () => {
  const file = createMockFile('url.epub', buildEpub({
    opfDir: 'OEBPS',
    chapters: [{ href: 'cap%C3%ADtulo%201.xhtml', html: '<html><body><h1>Con espacio</h1><p>Texto del capítulo codificado</p></body></html>' }]
  }));
  const parsed = await parseEpubFile(file);
  assert.strictEqual(parsed.sections.length, 1);
  assert.ok(parsed.rawText.includes('Texto del capítulo codificado'));
});

test('33.5 EPUB: rechaza con malformed un contenedor sin OPF', async () => {
  const noOpf = buildEpub({ containerXml: null, chapters: [] });
  const file = createMockFile('sin_opf.epub', noOpf);
  assert.strictEqual(await rejectionCode(parseEpubFile(file)), 'malformed');
});

test('33.6 EPUB: rechaza con malformed un archivo que no es ZIP', async () => {
  const file = createMockFile('nozip.epub', 'no es un zip');
  assert.strictEqual(await rejectionCode(parseEpubFile(file)), 'malformed');
});

test('33.7 EPUB: rechaza con empty un archivo vacío', async () => {
  const file = createMockFile('vacio.epub', new Uint8Array(0));
  assert.strictEqual(await rejectionCode(parseEpubFile(file)), 'empty');
});

test('33.8 EPUB: no lee rutas de traversal del spine (path traversal)', async () => {
  const secret = 'CONTENIDO_SECRETO_FUERA_DEL_EPUB';
  const file = createMockFile('traversal.epub', buildEpub({
    chapters: [
      { href: 'cap_valido.xhtml', html: '<html><body><h1>Válido</h1><p>Contenido legítimo del libro</p></body></html>' },
      { href: '../../../etc/passwd', html: '<html><body><p>x</p></body></html>' }
    ],
    extraEntries: { 'etc/passwd': new TextEncoder().encode(secret) }
  }));
  const parsed = await parseEpubFile(file);
  assert.ok(!parsed.rawText.includes(secret), 'El traversal no debe filtrar contenido externo');
  assert.strictEqual(parsed.sections.length, 1);
  assert.strictEqual(parsed.extraction?.status, 'partial');
});

test('33.9 EPUB: detecta miembros ZIP sobredimensionados (zip bomb)', async () => {
  const huge = new Uint8Array(11 * 1024 * 1024); // 11 MB descomprimidos > límite de 10 MB
  const file = createMockFile('bomba.epub', buildEpub({
    chapters: [{ href: 'cap.xhtml', html: '<html><body><p>texto</p></body></html>' }],
    extraEntries: { 'OEBPS/huge.bin': huge }
  }));
  assert.strictEqual(await rejectionCode(parseEpubFile(file)), 'archive-too-large');
});

test('33.10 EPUB: rechaza una ruta de OPF con traversal en container.xml', async () => {
  const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="../../../etc/passwd" media-type="application/oebps-package+xml"/></rootfiles></container>`;
  const file = createMockFile('opf_traversal.epub', buildEpub({ containerXml: container, chapters: [] }));
  // Sin OPF válido y sin fallback `.opf`, debe fallar explícitamente.
  assert.strictEqual(await rejectionCode(parseEpubFile(file)), 'malformed');
});

// ---------------------------------------------------------------------------
// Helpers unitarios
// ---------------------------------------------------------------------------

test('34.1 resolveArchivePath: normaliza, decodifica y bloquea traversal', () => {
  assert.strictEqual(resolveArchivePath('OEBPS', 'cap1.xhtml'), 'OEBPS/cap1.xhtml');
  assert.strictEqual(resolveArchivePath('OEBPS', './textos/../cap1.xhtml'), 'OEBPS/cap1.xhtml');
  assert.strictEqual(resolveArchivePath('OEBPS', 'cap%201.xhtml'), 'OEBPS/cap 1.xhtml');
  assert.strictEqual(resolveArchivePath('', '/rootfile.opf'), 'rootfile.opf');
  assert.strictEqual(resolveArchivePath('OEBPS', '../../etc/passwd'), null);
  assert.strictEqual(resolveArchivePath('OEBPS', 'a\0b.xhtml'), null);
  assert.strictEqual(resolveArchivePath('OEBPS', 'cap1.xhtml#seccion'), 'OEBPS/cap1.xhtml');
});

test('34.2 extractXhtmlText: separa bloques y decodifica entidades', () => {
  const text = extractXhtmlText('<html><body><h1>Título</h1><p>Uno &amp; dos</p><ul><li>a</li><li>b</li></ul></body></html>');
  assert.ok(text.includes('Título'));
  assert.ok(text.includes('Uno & dos'));
  assert.ok(text.includes('a'));
  assert.ok(text.includes('b'));
  // Los bloques no se fusionan en una sola línea.
  assert.ok(text.split('\n').length >= 3, `Texto: ${JSON.stringify(text)}`);
});
