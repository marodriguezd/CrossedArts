/**
 * localMediaService.ts
 * Servicio en memoria para descubrimiento, coincidencia y reproducción de medios locales
 * utilizando la File System Access API del navegador sin persistir URLs temporales ni handles en SQLite.
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
 * Normaliza nombres de archivo eliminando extensiones, caracteres especiales y separadores.
 * Por ejemplo: "01. Introducción al Virtual DOM y Fiber" -> "01 introduccion al virtual dom y fiber"
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
    .replace(/[\u0300-\u036f]/g, '') // Eliminar tildes/acentos
    .toLowerCase()
    .replace(/[-_.]+/g, ' ')
    .replace(/[^\w\s]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Comprueba si la extensión del archivo es compatible con reproducción en el navegador.
 */
export function isSupportedMedia(fileName: string): boolean {
  const dotIndex = fileName.lastIndexOf('.');
  if (dotIndex === -1) return false;
  const ext = fileName.slice(dotIndex).toLowerCase();
  return SUPPORTED_MEDIA_EXTENSIONS.has(ext);
}

export type MatchTier = 'EXACT_PATH' | 'EXACT_NAME' | 'STEM_MATCH' | 'TITLE_FALLBACK';

export interface MatchResultItem {
  file: DiscoveredMediaFile;
  tier: MatchTier;
}

/**
 * Emparejamiento determinista entre archivos descubiertos y lecciones por niveles de fuerza.
 * Niveles jerárquicos:
 * 1. EXACT_PATH: Coincidencia exacta de ruta relativa normalizada (máxima fuerza).
 * 2. EXACT_NAME: Coincidencia exacta de nombre de archivo con extensión.
 * 3. STEM_MATCH: Coincidencia de tallo normalizado derivado del nombre de archivo.
 * 4. TITLE_FALLBACK: Coincidencia de tallo normalizado derivado del título de la lección (mínima fuerza).
 *
 * Reglas de desempate y ambigüedad:
 * - Un nivel superior siempre prevalece sobre niveles inferiores.
 * - Si existen múltiples candidatos dentro del mismo nivel más fuerte, se declara ambigüedad y no se asigna.
 * - No se admiten falsos positivos cuando la normalización produce nombres vacíos o no relacionados.
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

  // Índices para búsqueda determinista
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

      // Nivel 1: EXACT_PATH
      if (filesByRelativePath.has(cleanUrl)) {
        bestCandidates = [filesByRelativePath.get(cleanUrl)!];
        bestTier = 'EXACT_PATH';
      }

      // Nivel 2: EXACT_NAME (si no hubo coincidencia de ruta exacta)
      if (!bestTier && filesByExactName.has(filenameFromUrl)) {
        bestCandidates = filesByExactName.get(filenameFromUrl)!;
        bestTier = 'EXACT_NAME';
      }

      // Nivel 3: STEM_MATCH de media_url
      if (!bestTier && urlStem && filesByStem.has(urlStem)) {
        bestCandidates = filesByStem.get(urlStem)!;
        bestTier = 'STEM_MATCH';
      }
    }

    // Nivel 4: TITLE_FALLBACK (solo si no hubo candidato previo y el título tiene tallo significativo)
    if (!bestTier && lesson.title) {
      const titleStem = normalizeMediaStem(lesson.title);
      // Evitar falsos positivos si el tallo resultante es demasiado corto (<3 caracteres)
      if (titleStem && titleStem.length >= 3 && filesByStem.has(titleStem)) {
        bestCandidates = filesByStem.get(titleStem)!;
        bestTier = 'TITLE_FALLBACK';
      }
    }

    // Evaluación final del conjunto de mejores candidatos
    if (bestCandidates.length === 1) {
      const matched = bestCandidates[0];
      matchedMap.set(lesson.id, matched);
      assignedFilePaths.add(matched.relativePath);
    } else if (bestCandidates.length > 1) {
      // Ambigüedad en el mismo nivel: no adivinar
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
  private individualFileMap = new Map<string, File>(); // lessonId -> File (asociación individual)
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
   * Asocia un archivo individual seleccionado por el usuario a una lección específica.
   * Valida la extensión, no persiste en SQLite y actualiza el mapa de reproducción en memoria.
   */
  public associateIndividualFile(lessonId: string, file: File): { success: boolean; error?: string } {
    if (!isSupportedMedia(file.name)) {
      const ext = file.name.slice(file.name.lastIndexOf('.'));
      return {
        success: false,
        error: `Formato no soportado ("${ext || 'sin extensión'}"). Formatos permitidos: ${Array.from(SUPPORTED_MEDIA_EXTENSIONS).join(', ')}.`
      };
    }

    // Revocar URL previa de la lección si existiera
    this.revokePlaybackUrl(lessonId);

    // Guardar referencia en memoria
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
   * Abre el selector nativo de directorio, escanea recursivamente los archivos multimedia
   * y los empareja contra las lecciones proporcionadas.
   */
  public async pickAndScanDirectory(lessons: MatchCandidate[]): Promise<MediaScanReport> {
    if (!this.isSupported()) {
      throw new Error('La File System Access API no está soportada en este navegador.');
    }

    // @ts-ignore
    const dirHandle: FileSystemDirectoryHandle = await window.showDirectoryPicker();
    this.activeDirectoryHandle = dirHandle;

    // Liberar URLs de objeto activas de sesiones previas
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
   * Re-empareja los archivos en memoria ya descubiertos con una nueva lista de lecciones.
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
   * Genera o retorna una URL efímera de reproducción (URL.createObjectURL) para la lección.
   */
  public async getPlaybackUrl(lessonId: string): Promise<string | null> {
    if (this.activeObjectUrls.has(lessonId)) {
      return this.activeObjectUrls.get(lessonId)!;
    }

    // 1. Prioridad: archivo asociado individualmente para esta sesión
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

    // 2. Archivo emparejado por escaneo de carpeta
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
   * Revoca una URL de objeto específica cuando el usuario cambia de lección o desmonta.
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
   * Revoca todas las URLs de objeto efímeras activas.
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
   * Escaneo recursivo asíncrono de carpetas.
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
        // Evitar directorios ocultos o metadatos del SO
        if (!entry.name.startsWith('.')) {
          await this.scanDirectoryRecursive(entry as FileSystemDirectoryHandle, entryPath);
        }
      }
    }
  }
}

export const localMediaService = new LocalMediaService();
