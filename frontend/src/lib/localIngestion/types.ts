export type SupportedFileType = 'txt' | 'md' | 'pdf' | 'epub';

export interface DocumentSection {
  title?: string;
  page?: number;
  chapter?: string;
  content: string;
}

/**
 * Reasons a local extraction can fail. Exposed as a stable code (not text) so
 * the UI and tests can tell an encrypted PDF from a scanned one without
 * comparing Spanish strings.
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
 * Typed extraction error. `message` is in Spanish (UI text) and `code` is the
 * stable contract consumed by the ingestion service and the tests.
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
 * Explicit extraction state. `ok` means the WHOLE document contributed text;
 * `partial` means some pages/chapters were omitted (e.g. scanned pages inside a
 * mixed PDF). A document with extracted text never comes back without
 * `extraction`.
 */
export interface ExtractionInfo {
  status: 'ok' | 'partial';
  /** Pages (PDF) or chapters (EPUB) with no usable text. */
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
  targetId?: string; // id of the existing course, module, lesson, or book when associated
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

