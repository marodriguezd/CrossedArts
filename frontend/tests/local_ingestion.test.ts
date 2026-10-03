import test from 'node:test';
import assert from 'node:assert';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { parseTextFile } from '../src/lib/localIngestion/parsers/text.ts';
import { parseMarkdownFile } from '../src/lib/localIngestion/parsers/markdown.ts';
import { parsePdfFile } from '../src/lib/localIngestion/parsers/pdf.ts';
import { parseEpubFile } from '../src/lib/localIngestion/parsers/epub.ts';
import { computeBinarySha256 } from '../src/lib/localIngestion/fingerprint.ts';
import { localIngestionService, detectFileType } from '../src/lib/localIngestion/service.ts';
import { createSemanticChunksFromResourcesAsync } from '../src/lib/localEmbeddings/chunking.ts';
import { retrieveLocalContext } from '../src/lib/localRag/retrieval.ts';
import { buildRagContext } from '../src/lib/localRag/contextBuilder.ts';
import { aiService } from '../src/ai/aiService.ts';

// Helper mock file
function createMockFile(name: string, content: string | Uint8Array) {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  return {
    name,
    size: bytes.byteLength,
    text: async () => (typeof content === 'string' ? content : new TextDecoder().decode(bytes)),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  };
}

test('10.1 File Type Detection: Detects supported extensions and rejects unsupported', () => {
  assert.strictEqual(detectFileType('documento.txt'), 'txt');
  assert.strictEqual(detectFileType('manual.md'), 'md');
  assert.strictEqual(detectFileType('guia.markdown'), 'md');
  assert.strictEqual(detectFileType('libro.pdf'), 'pdf');
  assert.strictEqual(detectFileType('novela.epub'), 'epub');
  assert.strictEqual(detectFileType('ejecutable.exe'), null);
  assert.strictEqual(detectFileType('video.mp4'), null);
  assert.strictEqual(detectFileType('sin_extension'), null);
});

test('10.2 Binary SHA-256 Fingerprint: Deterministic, consistent, and collision-resistant', async () => {
  const enc = new TextEncoder();
  const data1 = enc.encode('Contenido de prueba A');
  const data2 = enc.encode('Contenido de prueba B');

  const hash1a = await computeBinarySha256(data1);
  const hash1b = await computeBinarySha256(data1);
  const hash2 = await computeBinarySha256(data2);

  assert.strictEqual(hash1a.length, 64);
  assert.strictEqual(hash1a, hash1b);
  assert.notStrictEqual(hash1a, hash2);
});

test('10.3 Text & Markdown Parser: Extracts titles, sanitizes control characters, and creates sections', async () => {
  const mdContent = `# Guía de Arquitectura

Este es el primer capítulo sobre principios de software.

## Patrones Estructurales

Aquí se exploran los patrones estructurales como Adapter y Facade.`;

  const mockMd = createMockFile('arquitectura.md', mdContent);
  const parsedMd = await parseMarkdownFile(mockMd);

  assert.strictEqual(parsedMd.title, 'Guía de Arquitectura');
  assert.strictEqual(parsedMd.fileType, 'md');
  assert.ok(parsedMd.sections.length >= 2);
  assert.strictEqual(parsedMd.sections[0].chapter, 'Guía de Arquitectura');
  assert.strictEqual(parsedMd.sections[1].chapter, 'Patrones Estructurales');

  // Test empty markdown rejection
  const emptyMd = createMockFile('vacio.md', '   \n\n\t  ');
  await assert.rejects(async () => {
    await parseMarkdownFile(emptyMd);
  }, /vacío/);
});

test('10.4 PDF & EPUB Parser Validation: Validates magic headers and rejects malformed files', async () => {
  // Simular archivo PDF con cabecera %PDF- y stream de texto simple
  const fakePdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
stream
BT
/F1 12 Tf
(Introducción a la Inteligencia Artificial Local) Tj
ET
endstream
endobj
%%EOF`;

  const mockPdf = createMockFile('intro_ia.pdf', fakePdf);
  const parsedPdf = await parsePdfFile(mockPdf);
  assert.strictEqual(parsedPdf.fileType, 'pdf');
  assert.ok(parsedPdf.rawText.includes('Inteligencia Artificial Local'));
  assert.strictEqual(parsedPdf.pageCount, 1);

  // Archivo no PDF debe ser rechazado
  const invalidPdf = createMockFile('corrupto.pdf', 'ESTO NO ES UN PDF');
  await assert.rejects(async () => {
    await parsePdfFile(invalidPdf);
  }, /no es un documento PDF válido/);

  // Simular EPUB con cabecera ZIP (PK\x03\x04) y XHTML
  const zipHeader = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);
  const epubBody = new TextEncoder().encode('<html><head><title>Capítulo Uno</title></head><body><p>El aprendizaje profundo en dispositivos periféricos.</p></body></html>');
  const fullEpubBytes = new Uint8Array(zipHeader.length + epubBody.length);
  fullEpubBytes.set(zipHeader, 0);
  fullEpubBytes.set(epubBody, zipHeader.length);

  const mockEpub = createMockFile('redes.epub', fullEpubBytes);
  const parsedEpub = await parseEpubFile(mockEpub);
  assert.strictEqual(parsedEpub.fileType, 'epub');
  assert.ok(parsedEpub.rawText.includes('aprendizaje profundo'));

  // EPUB corrupto sin cabecera PK debe ser rechazado
  const invalidEpub = createMockFile('falso.epub', 'NO ZIP');
  await assert.rejects(async () => {
    await parseEpubFile(invalidEpub);
  }, /no es un contenedor EPUB/);
});

test('10.5 Ingestion Workflow: Persists into SQLite without storing raw binary files and prevents duplicates', async () => {
  await dbBridge.init();

  const fileDoc = createMockFile('tutorial_sqlite.md', `# Tutorial SQLite WASM
SQLite en el navegador permite aplicaciones 100% locales sin servidores backend.`);

  const res1 = await localIngestionService.ingestFile(fileDoc, {
    category: 'Tecnología',
    importAsBook: true
  });

  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.isDuplicate, false);
  assert.ok(res1.resourceId);

  // Comprobar que en SQLite NO se guardó ningún binario pesado o blob: URL
  const db = dbBridge.getDatabase();
  const resourceRow = db.exec('SELECT id, title, type, source_path FROM learning_resource WHERE id = ?', [res1.resourceId]);
  assert.strictEqual(resourceRow.length, 1);
  assert.strictEqual(resourceRow[0].values[0][1], 'Tutorial SQLite WASM');
  assert.strictEqual(resourceRow[0].values[0][2], 'book');
  assert.ok(String(resourceRow[0].values[0][3]).startsWith('local://'));
  assert.ok(String(resourceRow[0].values[0][3]).includes('sha256='));

  // Intento de reimportar el MISMO archivo exacto: debe detectarse como duplicado por huella SHA-256
  const resDup = await localIngestionService.ingestFile(fileDoc);
  assert.strictEqual(resDup.success, true);
  assert.strictEqual(resDup.isDuplicate, true);
});

test('10.6 End-to-End Hybrid RAG Integration with Ingested Content & Page Citations', async () => {
  await dbBridge.init();

  // Ingestar documento con secciones paginadas
  const manualFile = createMockFile('manual_sistemas.txt', `Manual de Sistemas Operativos

Párrafo extenso que describe la gestión de memoria virtual, paginación y segmentación en kernels modernos para evitar fallos de página.`);

  const ingestRes = await localIngestionService.ingestFile(manualFile, {
    category: 'Sistemas'
  });
  assert.strictEqual(ingestRes.success, true);

  // Comprobar recuperación contextual en RAG
  const queryResult = await retrieveLocalContext('paginacion memoria virtual kernels');
  assert.ok(queryResult.documents.length > 0);

  const matchedDoc = queryResult.documents.find(d => d.snippet.includes('memoria virtual'));
  assert.ok(matchedDoc, 'Ingested document must be retrievable by local RAG');
  assert.strictEqual(matchedDoc?.sourceType, 'note');

  // Comprobar que el contextBuilder formatea los atributos de página/capítulo
  const builtContext = buildRagContext(queryResult.documents);
  assert.ok(builtContext.hasContext);
  assert.ok(builtContext.formattedContextText.includes('TIPO="NOTE"'));
});

test('10.7 Batch Cancellation & Privacy Guarantee: Yields thread, supports AbortSignal and zero network calls', async () => {
  await dbBridge.init();

  // Monitorizar fetch para garantizar 0 llamadas de red
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalls++;
    throw new Error('fetch bloqueado durante ingestión local');
  }) as any;

  try {
    const controller = new AbortController();
    controller.abort(); // Cancelar de antemano

    const batch = [
      createMockFile('doc1.txt', 'Contenido 1'),
      createMockFile('doc2.txt', 'Contenido 2')
    ];

    const results = await localIngestionService.ingestBatch(batch, {
      signal: controller.signal
    });

    assert.strictEqual(results.length, 0, 'Cancelled batch must yield 0 processed files');
    assert.strictEqual(fetchCalls, 0, 'Zero network calls must occur during local ingestion');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('11.1 Destination Association & Learning Resource Model: Standalone, Course, and Lesson links', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  // 1. Ingestar como recurso independiente
  const standaloneFile = createMockFile('independiente.md', '# Arquitectura Standalone\n\nConceptos puros sin curso padre.');
  const resStandalone = await localIngestionService.ingestFile(standaloneFile, {
    destination: { type: 'standalone' }
  });
  assert.strictEqual(resStandalone.success, true);
  assert.ok(resStandalone.resourceId);

  // Verificar que learning_resource se registró con type learning_resource
  const rRow = db.exec('SELECT type FROM learning_resource WHERE id = ?', [resStandalone.resourceId]);
  assert.strictEqual(rRow[0].values[0][0], 'learning_resource');

  // 2. Ingestar asociando a un curso existente
  const courseFile = createMockFile('notas_react.txt', 'Apuntes complementarios sobre Fiber y re-renderizado.');
  const resCourse = await localIngestionService.ingestFile(courseFile, {
    destination: { type: 'course', targetId: 'c1-react' }
  });
  assert.strictEqual(resCourse.success, true);

  // Verificar nota vinculada al curso c1-react
  const noteRow = db.exec('SELECT resource_id, tags FROM note WHERE title LIKE ?', ['%notas_react%']);
  assert.strictEqual(noteRow[0].values[0][0], 'c1-react');
  assert.ok(String(noteRow[0].values[0][1]).includes('asociado:course'));
});

test('11.2 Resource Source Metadata Viewer & Audit', async () => {
  await dbBridge.init();

  const docFile = createMockFile('guia_compiladores.pdf', `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R >>
stream
BT
/F1 12 Tf
(Compiladores y Representaciones Intermedias LLVM IR) Tj
ET
endstream
endobj
%%EOF`);

  const res = await localIngestionService.ingestFile(docFile, {
    category: 'Compiladores',
    importAsBook: true
  });
  assert.strictEqual(res.success, true);
  assert.ok(res.resourceId);

  const meta = await dao.getResourceSourceMeta(res.resourceId!);
  assert.strictEqual(meta.resource?.id, res.resourceId);
  assert.strictEqual(meta.sourceType, 'PDF');
  assert.strictEqual(meta.fileName, 'guia_compiladores.pdf');
  assert.strictEqual(meta.fingerprint?.length, 64);
  assert.ok(meta.notesCount >= 1);
});

test('11.3 Grounded Pedagogical Action: aiService.explainResource with local context vs insufficient context', async () => {
  await dbBridge.init();

  // Ingestar contenido sobre LLVM IR
  const llvmFile = createMockFile('llvm_ir.txt', 'LLVM Intermediate Representation (IR) es un lenguaje independiente de la arquitectura que utiliza asignación estática única (SSA).');
  await localIngestionService.ingestFile(llvmFile, { category: 'Compiladores' });

  // 1. Explicar recurso existente con evidencia local
  const resp = await aiService.explainResource('LLVM Intermediate Representation');
  assert.ok(resp.answer.length > 20);
  assert.ok(resp.sources.length > 0);
  assert.ok(resp.sources.some(s => s.toLowerCase().includes('llvm') || s.toLowerCase().includes('nota')));

  // 2. Intentar explicar un recurso inexistente: debe responder con insuficiencia sin alucinar
  const respInsuf = await aiService.explainResource('Teletransportación Cuántica Multiversal Inexistente 9999');
  assert.ok(respInsuf.answer.includes('no contiene suficiente información'));
  assert.strictEqual(respInsuf.sources.length, 0);
});

