/**
 * In-memory service for discovering, matching, and playing local media through
 * the browser File System Access API. Temporary URLs and handles are never
 * persisted to SQLite (AGENTS.md invariant 5).
 */

export interface DiscoveredMediaFile {
  name: string;
  relativePath: string;
  fileHandle: FileSystemFileHandle;
}

export interface MediaScanReport {
  directoryName: string;
  totalDiscovered: number;
  matchedCount: number;
  unmatchedCount: number;
  ambiguousMatches: string[];
}

export interface MatchCandidate {
  id: string;
  title: string;
  media_url?: string;
}

export const SUPPORTED_MEDIA_EXTENSIONS = new Set([
  '.mp4',
  '.webm',
  '.ogg',
  '.mov',
  '.m4v',
  '.mp3',
  '.wav',
  '.m4a'
]);

/**
 * Normalizes file names by dropping extensions, special characters, and
 * separators.
 * For example: "01. Introducción al Virtual DOM y Fiber" -> "01 introduccion al virtual dom y fiber"
 * "01-virtual-dom-fiber.mp4" -> "01 virtual dom fiber"
 */
export function normalizeMediaStem(name: string): string {
  if (!name) return '';
  let baseName = name;
  const lastDotIndex = name.lastIndexOf('.');
  if (lastDotIndex > 0) {
    const ext = name.slice(lastDotIndex).toLowerCase();
    if (SUPPORTED_MEDIA_EXTENSIONS.has(ext)) {
      baseName = name.slice(0, lastDotIndex);
    }
  }

  return baseName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Strip tildes/accents
    .toLowerCase()
    .replace(/[-_.]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function isSupportedMedia(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = fileName.slice(dotIndex).toLowerCase();
  return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

export type MatchTier = 'EXACT_PATH' | 'EXACT_NAME' | 'STEM_MATCH' | 'TITLE_FALLBACK';

/**
 * Deterministic matching between discovered files and lessons by strength tiers.
 * Hierarchical tiers:
 * 1. EXACT_PATH: exact match on the normalized relative path (strongest).
 * 2. EXACT_NAME: exact match on the file name including extension.
 * 3. STEM_MATCH: match on the normalized stem derived from the file name.
 * 4. TITLE_FALLBACK: match on the normalized stem derived from the lesson title (weakest).
 *
 * Tiebreak and ambiguity rules:
 * - A higher tier always prevails over lower tiers.
 * - Multiple candidates within the same strongest tier declare ambiguity and
 *   no assignment happens.
 * - No false positives are admitted when normalization yields empty or
 *   unrelated names.
 */
export function matchFilesToLessons(
  files: DiscoveredMediaFile[],
  lessons: MatchCandidate[]
): {
  matchedMap: Map<string, DiscoveredMediaFile>;
  matchedCount: number;
  unmatchedFiles: DiscoveredMediaFile[];
  ambiguousLessons: string[];
} {
  const matchedMap = new Map<string, DiscoveredMediaFile>();
  const ambiguousLessons: string[] = [];
  const assignedFilePaths = new Set<string>();

  // Indexes for deterministic lookup
  const filesByRelativePath = new Map<string, DiscoveredMediaFile>();
  const filesByExactName = new Map<string, DiscoveredMediaFile[]>();
  const filesByStem = new Map<string, DiscoveredMediaFile[]>();

  for (const file of files) {
    const relLower = file.relativePath.toLowerCase().replace(/\\/g, '/');
    const exactLower = file.name.toLowerCase();
    const normStem = normalizeMediaStem(file.name);

    filesByRelativePath.set(relLower, file);

    if (!filesByExactName.has(exactLower)) filesByExactName.set(exactLower, []);
    filesByExactName.get(exactLower)!.push(file);

    if (normStem) {
      if (!filesByStem.has(normStem)) filesByStem.set(normStem, []);
      filesByStem.get(normStem)!.push(file);
    }
  }

  for (const lesson of lessons) {
    let bestCandidates: DiscoveredMediaFile[] = [];
    let bestTier: MatchTier | null = null;

    if (lesson.media_url) {
      const cleanUrl = lesson.media_url.trim().toLowerCase().replace(/\\/g, '/');
      const filenameFromUrl = cleanUrl.split('/').pop() || cleanUrl;
      const urlStem = normalizeMediaStem(filenameFromUrl);

      // Tier 1: EXACT_PATH
      if (filesByRelativePath.has(cleanUrl)) {
        bestCandidates = [filesByRelativePath.get(cleanUrl)!];
        bestTier = 'EXACT_PATH';
      }

      // Tier 2: EXACT_NAME (when no exact path match occurred)
      if (!bestTier && filesByExactName.has(filenameFromUrl)) {
        bestCandidates = filesByExactName.get(filenameFromUrl)!;
        bestTier = 'EXACT_NAME';
      }

      // Tier 3: STEM_MATCH from media_url
      if (!bestTier && urlStem && filesByStem.has(urlStem)) {
        bestCandidates = filesByStem.get(urlStem)!;
        bestTier = 'STEM_MATCH';
      }
    }

    // Tier 4: TITLE_FALLBACK (only without a prior candidate and when the title has a meaningful stem)
    if (!bestTier && lesson.title) {
      const titleStem = normalizeMediaStem(lesson.title);
      // Avoid false positives when the resulting stem is too short (<3 chars)
      if (titleStem && titleStem.length >= 3 && filesByStem.has(titleStem)) {
        bestCandidates = filesByStem.get(titleStem)!;
        bestTier = 'TITLE_FALLBACK';
      }
    }

    // Final evaluation of the best-candidate set
    if (bestCandidates.length === 1) {
      const matched = bestCandidates[0];
      matchedMap.set(lesson.id, matched);
      assignedFilePaths.add(matched.relativePath);
    } else if (bestCandidates.length > 1) {
      // Ambiguity within one tier: never guess
      ambiguousLessons.push(lesson.title || lesson.id);
    }
  }

  const unmatchedFiles = files.filter(f => !assignedFilePaths.has(f.relativePath));

  return {
    matchedMap,
    matchedCount: matchedMap.size,
    unmatchedFiles,
    ambiguousLessons
  };
}

class LocalMediaService {
  private activeDirectoryHandle: FileSystemDirectoryHandle | null = null;
  private discoveredFiles: DiscoveredMediaFile[] = [];
  private lessonFileMap = new Map<string, DiscoveredMediaFile>();
  private individualFileMap = new Map<string, File>(); // lessonId -> File (individual association)
  private activeObjectUrls = new Map<string, string>(); // lessonId -> objectUrl
  private lastReport: MediaScanReport | null = null;

  public isSupported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  }

  public getDirectoryName(): string | null {
    return this.activeDirectoryHandle ? this.activeDirectoryHandle.name : null;
  }

  public getLastReport(): MediaScanReport | null {
    return this.lastReport;
  }

  public hasActiveFolder(): boolean {
    return this.activeDirectoryHandle !== null;
  }

  public getDiscoveredFilesCount(): number {
    return this.discoveredFiles.length;
  }

  /**
   * Associates a user-selected individual file with one specific lesson. It
   * validates the extension, persists nothing to SQLite, and updates the
   * in-memory playback map.
   */
  public associateIndividualFile(lessonId: string, file: File): { success: boolean; error?: string } {
    if (!isSupportedMedia(file.name)) {
      const ext = file.name.slice(file.name.lastIndexOf('.'));
      return {
        success: false,
        error: `Formato no soportado ("${ext || 'sin extensión'}"). Formatos permitidos: ${Array.from(SUPPORTED_MEDIA_EXTENSIONS).join(', ')}.`
      };
    }

    // Revoke the lesson's previous URL when present
    this.revokePlaybackUrl(lessonId);

    // Store the reference in memory
    this.individualFileMap.set(lessonId, file);
    return { success: true };
  }

  public hasIndividualFile(lessonId: string): boolean {
    return this.individualFileMap.has(lessonId);
  }

  public clearIndividualFile(lessonId: string): void {
    this.revokePlaybackUrl(lessonId);
    this.individualFileMap.delete(lessonId);
  }

  /**
   * Opens the native directory picker, recursively scans media files, and
   * matches them against the provided lessons.
   */
  public async pickAndScanDirectory(lessons: MatchCandidate[]): Promise<MediaScanReport> {
    if (!this.isSupported()) {
      throw new Error('La File System Access API no está soportada en este navegador.');
    }

    // @ts-ignore
    const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker();
    this.activeDirectoryHandle = dirHandle;

    // Release object URLs still active from previous sessions
    this.revokeAllObjectUrls();

    this.discoveredFiles = [];
    await this.scanDirectoryRecursive(dirHandle, '');

    const { matchedMap, matchedCount, unmatchedFiles, ambiguousLessons } = matchFilesToLessons(
      this.discoveredFiles,
      lessons
    );

    this.lessonFileMap = matchedMap;

    const report: MediaScanReport = {
      directoryName: dirHandle.name,
      totalDiscovered: this.discoveredFiles.length,
      matchedCount,
      unmatchedCount: unmatchedFiles.length,
      ambiguousMatches: ambiguousLessons
    };

    this.lastReport = report;
    return report;
  }

  /**
   * Re-matches already discovered in-memory files against a new lesson list.
   */
  public remapLessons(lessons: MatchCandidate[]): MediaScanReport | null {
    if (!this.activeDirectoryHandle || this.discoveredFiles.length === 0) return null;

    const { matchedMap, matchedCount, unmatchedFiles, ambiguousLessons } = matchFilesToLessons(
      this.discoveredFiles,
      lessons
    );

    this.lessonFileMap = matchedMap;
    const report: MediaScanReport = {
      directoryName: this.activeDirectoryHandle.name,
      totalDiscovered: this.discoveredFiles.length,
      matchedCount,
      unmatchedCount: unmatchedFiles.length,
      ambiguousMatches: ambiguousLessons
    };
    this.lastReport = report;
    return report;
  }

  /**
   * Returns a cached `blob:` URL, creating one on first use. Callers must
   * release it on lesson change or view exit (AGENTS.md invariant 5).
   */
  public async getPlaybackUrl(lessonId: string): Promise<string | null> {
    if (this.activeObjectUrls.has(lessonId)) {
      return this.activeObjectUrls.get(lessonId)!;
    }

    // 1. Priority: file associated individually for this session
    if (this.individualFileMap.has(lessonId)) {
      const file = this.individualFileMap.get(lessonId)!;
      try {
        const objectUrl = URL.createObjectURL(file);
        this.activeObjectUrls.set(lessonId, objectUrl);
        return objectUrl;
      } catch (err) {
        console.warn(`Error al crear object URL para archivo individual en lección ${lessonId}:`, err);
        return null;
      }
    }

    // 2. File matched by folder scan
    const fileEntry = this.lessonFileMap.get(lessonId);
    if (!fileEntry) return null;

    try {
      const file: File = await fileEntry.fileHandle.getFile();
      const objectUrl = URL.createObjectURL(file);
      this.activeObjectUrls.set(lessonId, objectUrl);
      return objectUrl;
    } catch (err) {
      console.warn(`Error al leer archivo local para la lección ${lessonId}:`, err);
      return null;
    }
  }

  /**
   * Revokes one specific object URL when the user switches lessons or unmounts.
   */
  public revokePlaybackUrl(lessonId: string): void {
    const url = this.activeObjectUrls.get(lessonId);
    if (url) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn('Error revocando object URL:', err);
      }
      this.activeObjectUrls.delete(lessonId);
    }
  }

  /**
   * Revokes every active ephemeral object URL.
   */
  public revokeAllObjectUrls(): void {
    for (const [lessonId, url] of this.activeObjectUrls.entries()) {
      try {
        URL.revokeObjectURL(url);
      } catch (err) {
        console.warn(`Error revocando object URL para lección ${lessonId}:`, err);
      }
    }
    this.activeObjectUrls.clear();
  }

  /**
   * Asynchronous recursive folder scan.
   */
  private async scanDirectoryRecursive(
    dirHandle: FileSystemDirectoryHandle,
    currentPath: string
  ): Promise<void> {
    // @ts-ignore
    for await (const entry of dirHandle.values()) {
      const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      if (entry.kind === 'file') {
        if (isSupportedMedia(entry.name)) {
          this.discoveredFiles.push({
            name: entry.name,
            relativePath: entryPath,
            fileHandle: entry as FileSystemFileHandle
          });
        }
      } else if (entry.kind === 'directory') {
        // Skip hidden directories and OS metadata
        if (!entry.name.startsWith('.')) {
          await this.scanDirectoryRecursive(entry as FileSystemDirectoryHandle, entryPath);
        }
      }
    }
  }
}

export const localMediaService = new LocalMediaService();
