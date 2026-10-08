export type SupportedFileType = 'txt' | 'md' | 'pdf' | 'epub';

export interface DocumentSection {
  title?: string;
  page?: number;
  chapter?: string;
  content: string;
}

/**
 * Motivos por los que una extracción local puede fracasar. Se exponen como
 * código estable (no como texto) para que la UI y los tests puedan distinguir
 * un PDF cifrado de uno escaneado sin comparar cadenas en español.
 */
export type ExtractionFailureCode =
  | 'malformed'
  | 'encrypted'
  | 'empty'
  | 'image-only'
  | 'unsupported'
  | 'archive-too-large'
  | 'file-too-large'
  | 'unsafe-path';

/**
 * Error tipado de extracción. `message` está en español (texto de UI) y `code`
 * es el contrato estable que consumen el servicio de ingesta y los tests.
 */
export class DocumentExtractionError extends Error {
  readonly code: ExtractionFailureCode;
  constructor(code: ExtractionFailureCode, message: string) {
    super(message);
    this.name = 'DocumentExtractionError';
    this.code = code;
  }
}

/**
 * Estado explícito de la extracción. `ok` implica que TODO el documento aportó
 * texto; `partial` que algunas páginas/capítulos se omitieron (p. ej. páginas
 * escaneadas dentro de un PDF mixto). Nunca se devuelve un documento sin
 * `extraction` cuando se obtuvo texto.
 */
export interface ExtractionInfo {
  status: 'ok' | 'partial';
  /** Páginas (PDF) o capítulos (EPUB) sin texto aprovechable. */
  skippedSections: number;
  warning?: string;
}

export interface ParsedDocument {
  title: string;
  author?: string;
  fileType: SupportedFileType;
  fileName: string;
  fileSizeBytes: number;
  fingerprint: string;
  pageCount?: number;
  sections: DocumentSection[];
  rawText: string;
  estimatedWords?: number;
  extraction?: ExtractionInfo;
}

export type ResourceDestinationType = 'standalone' | 'course' | 'module' | 'lesson' | 'book';

export interface ResourceDestination {
  type: ResourceDestinationType;
  targetId?: string; // id del curso, módulo, lección o libro existente si se asocia
  targetTitle?: string;
}

export interface IngestionOptions {
  category?: string;
  importAsBook?: boolean;
  destination?: ResourceDestination;
  enableSemanticIndexing?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: IngestionProgress) => void;
}

export interface IngestionProgress {
  stage: 'reading' | 'hashing' | 'parsing' | 'saving' | 'completed' | 'failed';
  fileName: string;
  currentFileIndex: number;
  totalFiles: number;
  message: string;
}

export interface IngestionResult {
  success: boolean;
  resourceId?: string;
  fingerprint: string;
  title: string;
  fileType: SupportedFileType;
  pageCount?: number;
  sectionsCount: number;
  isDuplicate?: boolean;
  existingResourceId?: string;
  destination?: ResourceDestination;
  error?: string;
}

