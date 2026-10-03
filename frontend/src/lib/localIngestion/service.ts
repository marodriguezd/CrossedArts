import type {
  SupportedFileType,
  ParsedDocument,
  IngestionOptions,
  IngestionResult
} from './types.ts';
import { parseTextFile } from './parsers/text.ts';
import { parseMarkdownFile } from './parsers/markdown.ts';
import { parsePdfFile } from './parsers/pdf.ts';
import { parseEpubFile } from './parsers/epub.ts';
import { computeFileFingerprint } from './fingerprint.ts';
import { dao } from '../../db/dao.ts';
import { dbBridge } from '../../db/sqliteBridge.ts';
import { localEmbeddingEngine } from '../localEmbeddings/engine.ts';

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
  /**
   * Determina si un documento ya fue importado comparando el fingerprint SHA-256 en SQLite.
   * Devuelve el ID del recurso existente si lo encuentra.
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
   * Parsea un archivo individual soportado en memoria.
   */
  async parseFile(
    file: File | { name: string; size: number; text?: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }
  ): Promise<ParsedDocument> {
    const fileType = detectFileType(file.name);
    if (!fileType) {
      throw new Error(`Tipo de archivo no soportado para "${file.name}". Formatos admitidos: .txt, .md, .pdf, .epub`);
    }

    switch (fileType) {
      case 'txt':
        return parseTextFile(file as any);
      case 'md':
        return parseMarkdownFile(file as any);
      case 'pdf':
        return parsePdfFile(file as any);
      case 'epub':
        return parseEpubFile(file as any);
    }
  }

  /**
   * Ingesta y almacena un archivo en el SQLite local de CrossedArts,
   * indexándolo opcionalmente si el motor de embeddings está activo.
   */
  async ingestFile(
    file: File | { name: string; size: number; text?: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> },
    options: IngestionOptions = {}
  ): Promise<IngestionResult> {
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

    // 1. Huella digital
    options.onProgress?.({
      stage: 'hashing',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Calculando huella SHA-256 de ${file.name}...`
    });

    const fingerprint = await computeFileFingerprint(file);

    // Detección de duplicados
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

    // 2. Parseo
    options.onProgress?.({
      stage: 'parsing',
      fileName: file.name,
      currentFileIndex: 1,
      totalFiles: 1,
      message: `Extrayendo texto y metadatos de ${file.name}...`
    });

    const parsed = await this.parseFile(file);

    if (options.signal?.aborted) {
      throw new Error('La importación fue cancelada.');
    }

    // 3. Persistencia en SQLite
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

    // 4. Indexación semántica automática incremental en segundo plano solo si fue solicitada explícitamente o el motor ya está en ejecución
    if (options.enableSemanticIndexing && localEmbeddingEngine.getStatus() === 'ready') {
      try {
        const { createSemanticChunksFromResourcesAsync } = await import('../localEmbeddings/chunking.ts');
        const allRes = await dao.getAllLearningResources();
        const chunks = await createSemanticChunksFromResourcesAsync(allRes);
        await localEmbeddingEngine.indexChunks(chunks);
      } catch (err) {
        console.warn('Indexación semántica en segundo plano diferida:', err);
      }
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
   * Ingesta un lote de archivos secuencialmente, cediendo el hilo del navegador
   * entre archivos para mantener la interfaz de usuario fluida y sensible.
   */
  async ingestBatch(
    files: Array<File | { name: string; size: number; text?: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> }>,
    options: IngestionOptions = {}
  ): Promise<IngestionResult[]> {
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

      // Ceder el control al event loop entre archivos grandes
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return results;
  }
}

export const localIngestionService = new LocalIngestionService();
