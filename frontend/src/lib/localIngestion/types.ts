export type SupportedFileType = 'txt' | 'md' | 'pdf' | 'epub';

export interface DocumentSection {
  title?: string;
  page?: number;
  chapter?: string;
  content: string;
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

