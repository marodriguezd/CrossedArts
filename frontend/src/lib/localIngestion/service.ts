import type {
  SupportedFileType,
  ParsedDocument,
  IngestionOptions,
  IngestionResult,
  IngestionSource
} from './types.ts';
import { parseTextFile } from './parsers/text.ts';
import { parseMarkdownFile } from './parsers/markdown.ts';
import { parsePdfFile } from './parsers/pdf.ts';
import { parseEpubFile } from './parsers/epub.ts';
import { resolveSourceFingerprint } from './fingerprint.ts';
import { dao } from '../../db/dao.ts';
import { dbBridge } from '../../db/sqliteBridge.ts';

export interface IngestionDeps {
  /**
   * Requests ONE semantic pass. Injected so a whole batch coalesces into a
   * single canonical reindex instead of one full-library pass per file.
   */
  requestIndexing: () => void;
}

type FileLike = File | IngestionSource;

/**
 * Normalizes any accepted input into one memoizing source.
 *
 * The wrap is what makes "read once, hash once" possible: the service, the
 * duplicate check and the parser all go through the same object.
 */
function toSource(file: FileLike): IngestionSource {
  const candidate = file as IngestionSource & { text?: () => Promise<string> };
  return {
    name: file.name,
    size: file.size,
    text: typeof candidate.text === 'function' ? () => candidate.text!() : undefined,
    arrayBuffer: () => file.arrayBuffer(),
    bufferedBytes: candidate.bufferedBytes,
    cachedFingerprint: candidate.cachedFingerprint
  };
}

/**
 * Copies the memo back onto the caller's source, so a second attempt at the same
 * object (a retry, a re-import) does not read or hash the bytes again.
 */
function adoptMemo(from: IngestionSource, to: FileLike): void {
  if (from === (to as unknown as IngestionSource)) return;
  try {
    const target = to as IngestionSource;
    if (from.bufferedBytes) target.bufferedBytes = from.bufferedBytes;
    if (from.cachedFingerprint) target.cachedFingerprint = from.cachedFingerprint;
  } catch {
    /* frozen source: the memo stays local, correctness is unaffected */
  }
}

async function requestCanonicalIndexing(): Promise<void> {
  try {
    const { localAiRuntime } = await import('../../services/localAiRuntime.ts');
    localAiRuntime.scheduleIndexing('local');
  } catch (err) {
    // Importing content must never depend on the embedding engine: the content
    // is already saved and lexical retrieval keeps working meanwhile.
    console.warn('Indexación semántica diferida:', err);
  }
}

const DEFAULT_DEPS: IngestionDeps = {
  requestIndexing: () => { void requestCanonicalIndexing(); }
};

export function getFileExtension(filename: string): string {
  const parts = filename.split('.');
  return parts.length > 1 ? parts.pop()!.toLowerCase() : '';
}

export function detectFileType(filename: string): SupportedFileType | null {
  const ext = getFileExtension(filename);
  if (ext === 'txt') return 'txt';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'epub') return 'epub';
  return null;
}

export class LocalIngestionService {
  private readonly deps: IngestionDeps;

  constructor(deps: IngestionDeps = DEFAULT_DEPS) {
    this.deps = deps;
  }

  /**
   * Detects whether a document was already imported by comparing its SHA-256
   * fingerprint (stored on `learning_resource.source_path`, or in note tags).
   * Returns the existing resource id when found.
   */
  async findExistingResourceByFingerprint(fingerprint: string): Promise<string | null> {
    try {
      const db = dbBridge.getDatabase();
      const resResource = db.exec(
        'SELECT id FROM learning_resource WHERE source_path LIKE ?',
        [`%${fingerprint}%`]
      );
      if (resResource.length && resResource[0].values.length > 0) {
        return resResource[0].values[0][0] as string;
      }

      const resNote = db.exec(
        'SELECT resource_id FROM note WHERE tags LIKE ? AND resource_id IS NOT NULL',
        [`%${fingerprint}%`]
      );
      if (resNote.length && resNote[0].values.length > 0) {
        return resNote[0].values[0][0] as string;
      }
      return null;
    } catch {
      return null;
    }
  }

  async isFingerprintImported(fingerprint: string): Promise<boolean> {
    const existing = await this.findExistingResourceByFingerprint(fingerprint);
    return existing !== null;
  }

  /**
   * Parses one supported file in memory.
   */
  async parseFile(file: FileLike): Promise<ParsedDocument> {
    const fileType = detectFileType(file.name);
    if (!fileType) {
      throw new Error(`Tipo de archivo no soportado para "${file.name}". Formatos admitidos: .txt, .md, .pdf, .epub`);
    }

    const source = toSource(file);

    switch (fileType) {
      case 'txt':
        return parseTextFile(source as IngestionSource & { text: () => Promise<string> });
      case 'md':
        return parseMarkdownFile(source as IngestionSource & { text: () => Promise<string> });
      case 'pdf':
        return parsePdfFile(source);
      case 'epub':
        return parseEpubFile(source);
    }
  }

  /**
   * Ingests and stores a file in CrossedArts' local SQLite, optionally
   * indexing it when the embeddings engine is running.
   */
  async ingestFile(file: FileLike, options: IngestionOptions = {}): Promise<IngestionResult> {
    if (options.signal?.aborted) {
      throw new Error('La importación fue cancelada por el usuario.');
    }

    const fileType = detectFileType(file.name);
    if (!fileType) {
      return {
        success: false,
        fingerprint: '',
        title: file.name,
        fileType: 'txt',
        sectionsCount: 0,
        error: `Formato no soportado para "${file.name}". Admite: .txt, .md, .pdf, .epub`
      };
    }

    // 1. Fingerprint
    options.onProgress?.({
      stage: 'hashing',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Calculando huella SHA-256 de ${file.name}...`
    });

    // One source for the whole pipeline: bytes and digest are computed here and
    // reused by the parser, instead of reading and hashing the file twice.
    const source = toSource(file);
    const fingerprint = await resolveSourceFingerprint(source);
    adoptMemo(source, file);

    // Duplicate detection
    const existingResourceId = await this.findExistingResourceByFingerprint(fingerprint);
    if (existingResourceId) {
      return {
        success: true,
        fingerprint,
        title: file.name,
        fileType,
        sectionsCount: 0,
        isDuplicate: true,
        existingResourceId
      };
    }

    if (options.signal?.aborted) {
      throw new Error('La importación fue cancelada.');
    }

    // 2. Parsing
    options.onProgress?.({
      stage: 'parsing',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Extrayendo texto y metadatos de ${file.name}...`
    });

    const parsed = await this.parseFile(source);

    if (options.signal?.aborted) {
      throw new Error('La importación fue cancelada.');
    }

    // 3. SQLite persistence
    options.onProgress?.({
      stage: 'saving',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Guardando en la base de datos local SQLite...`
    });

    const resourceId = await dao.importDocument({
      title: parsed.title,
      author: parsed.author,
      fileType: parsed.fileType,
      fileName: parsed.fileName,
      fingerprint: parsed.fingerprint,
      category: options.category || (parsed.fileType === 'pdf' || parsed.fileType === 'epub' ? 'Lecturas' : 'Documentos'),
      pageCount: parsed.pageCount,
      sections: parsed.sections,
      importAsBook: options.importAsBook ?? (parsed.fileType === 'pdf' || parsed.fileType === 'epub'),
      destination: options.destination
    });

    // 4. Schedule ONE canonical semantic pass. It used to rebuild and re-embed
    //    the WHOLE library after every single file: importing N documents meant
    //    N full passes. Indexing never blocks the import and never fails it.
    if (options.enableSemanticIndexing) {
      this.deps.requestIndexing();
    }

    options.onProgress?.({
      stage: 'completed',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Documento "${parsed.title}" importado con éxito.`
    });

    return {
      success: true,
      resourceId,
      fingerprint: parsed.fingerprint,
      title: parsed.title,
      fileType: parsed.fileType,
      pageCount: parsed.pageCount,
      sectionsCount: parsed.sections.length,
      isDuplicate: false
    };
  }

  /**
   * Ingests a batch of files sequentially, yielding the browser thread
   * between files so the UI stays responsive.
   */
  async ingestBatch(files: FileLike[], options: IngestionOptions = {}): Promise<IngestionResult[]> {
    const results: IngestionResult[] = [];
    const totalFiles = files.length;

    for (let i = 0; i < totalFiles; i++) {
      if (options.signal?.aborted) {
        break;
      }

      const file = files[i];
      options.onProgress?.({
        stage: 'reading',
        fileName: file.name,
        currentFileIndex: i + 1,
        totalFiles,
        message: `Procesando archivo ${i + 1} de ${totalFiles}: ${file.name}`
      });

      try {
        const res = await this.ingestFile(file, {
          ...options,
          // Indexing is requested once, after the batch: per-file scheduling
          // multiplied a full-library pass by the number of files.
          enableSemanticIndexing: false,
          onProgress: (p) => {
            options.onProgress?.({
              ...p,
              currentFileIndex: i + 1,
              totalFiles
            });
          }
        });
        results.push(res);
      } catch (err: any) {
        results.push({
          success: false,
          fingerprint: '',
          title: file.name,
          fileType: detectFileType(file.name) || 'txt',
          sectionsCount: 0,
          error: err?.message || 'Error desconocido al procesar el archivo'
        });
      }

      // Yield to the event loop between large files
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    if (options.enableSemanticIndexing && results.some((r) => r.success && !r.isDuplicate)) {
      this.deps.requestIndexing();
    }

    return results;
  }
}

export const localIngestionService = new LocalIngestionService();
