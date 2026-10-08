/**
 * Normalización de artefactos de aprendizaje para la galería visual del panel.
 *
 * Lógica pura y agnóstica al dominio: cursos, libros, recursos importados y
 * trabajo práctico se traducen a la MISMA forma (`GalleryItem`) para que la
 * interfaz no tenga una tarjeta distinta por cada tipo. Al vivir fuera de React
 * se prueba con node:test sin DOM.
 *
 * Semántica de progreso (deliberadamente explícita):
 *  - `measured`: el progreso es un dato real y granular (lecciones completadas de
 *    un curso, páginas leídas de un libro). Se puede dibujar una barra.
 *  - `status`: el modelo NO guarda un porcentaje. Solo existe un estado
 *    (NOT_STARTED / IN_PROGRESS / COMPLETED). La interfaz NO muestra un
 *    porcentaje inventado: muestra el estado. Ver docs/PROGRESS.md.
 */
import type { Book, Course, LearningResource, PracticeWork, ResourceStatus } from '../types/models.ts';
import { practiceWorkKindLabel } from './practiceWork.ts';
import { clampPercent } from './mountainPath.ts';

/** Categoría conceptual de un artefacto de aprendizaje en la galería. */
export type ArtifactKind = 'course' | 'book' | 'resource' | 'practice';

/** Cómo se obtiene el progreso de un artefacto (nunca se mezclan en silencio). */
export type GalleryProgressSource = 'measured' | 'status';

/** Elemento ya normalizado de la galería. */
export interface GalleryItem {
  id: string;
  title: string;
  /** Prefijo estable usado también para resolver la acción de apertura. */
  kind: ArtifactKind;
  /** Etiqueta de tipo ya traducida (p. ej. "Curso", "Libro", "Trabajo práctico"). */
  kindLabel: string;
  /** Categoría libre del recurso ("Programación", "Música"…). Puede faltar. */
  category?: string;
  /** Ruta de portada resuelta por el servicio de miniaturas. */
  coverPath?: string;
  /** Porcentaje de progreso propio (0..100). Solo significativo si es `measured`. */
  progress: number;
  /** Origen del progreso; la interfaz decide con esto si dibuja una barra o un estado. */
  progressSource?: GalleryProgressSource;
  status?: ResourceStatus;
  /** Metadato corto ("5/12 lecciones", "Pág. 40/300"). */
  meta?: string;
}

/** Etiquetas en español de cada categoría de artefacto. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  course: 'Curso',
  book: 'Libro',
  resource: 'Recurso',
  practice: 'Trabajo práctico'
};

/** Prefijo con el que se construye el id de cada artefacto normalizado. */
export const ARTIFACT_ID_PREFIX: Record<ArtifactKind, string> = {
  course: 'course:',
  book: 'book:',
  resource: 'resource:',
  practice: 'practice:'
};

/** Porcentaje de progreso de un curso (0 si no declara lecciones). */
export function coursePercent(course: Pick<Course, 'completed_lessons' | 'total_lessons'>): number {
  const total = course.total_lessons || 0;
  if (total <= 0) return 0;
  return clampPercent(Math.round(((course.completed_lessons || 0) / total) * 100));
}

/** Porcentaje de lectura de un libro, acotado a [0, 100]. */
export function bookPercent(book: Pick<Book, 'reading_percentage'>): number {
  return clampPercent(Math.round(book.reading_percentage || 0));
}

/**
 * Indicador GRUESO de estado para artefactos sin porcentaje propio.
 *
 * No es una medida de avance: 50 significa "en marcha", no "a mitad". Solo se usa
 * para ordenar y para el marcador textual; la galería nunca lo pinta como barra.
 */
export function statusPercent(status?: ResourceStatus): number {
  if (status === 'COMPLETED') return 100;
  if (status === 'IN_PROGRESS') return 50;
  return 0;
}

/** Traduce el estado de un trabajo práctico al vocabulario de estado compartido. */
export function galleryStatusOfPracticeWork(status: PracticeWork['status']): ResourceStatus {
  if (status === 'DONE') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/**
 * Iniciales para la portada tipográfica cuando el recurso no tiene imagen.
 * Ignora artículos/palabras vacías y nunca devuelve más de dos caracteres.
 */
export function resourceInitials(title: string): string {
  const stopWords = new Set([
    'de', 'del', 'la', 'las', 'el', 'los', 'y', 'a', 'en', 'para', 'con',
    'the', 'of', 'and', 'to', 'in', 'for'
  ]);
  const words = title
    .split(/\s+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((word) => word.length > 0);

  const significant = words.filter((word) => !stopWords.has(word.toLowerCase()));
  const chosen = (significant.length > 0 ? significant : words).slice(0, 2);
  const initials = chosen.map((word) => word[0]).join('');
  return initials.toUpperCase() || '·';
}

/** Orden de atención: primero lo que está en progreso, al final lo completado. */
export function resourceStatusRank(status?: string): number {
  if (status === 'IN_PROGRESS') return 0;
  if (status === 'NOT_STARTED') return 1;
  return 2;
}

/** Fuentes adicionales que la galería sabe proyectar además de cursos y libros. */
export interface GallerySources {
  /** Recursos importados (documentos) que aún no son cursos ni libros. */
  resources?: LearningResource[];
  /** Trabajo práctico producido por el estudiante. */
  practiceWork?: PracticeWork[];
}

/**
 * Construye la lista normalizada de la galería a partir de TODAS las fuentes
 * soportadas. `id` lleva prefijo de tipo para no colisionar entre tablas distintas.
 *
 * Los recursos con `type` course/book se omiten cuando llegan por `resources`
 * (ya se proyectan desde `courses`/`books`): la galería nunca duplica una fila.
 */
export function buildGalleryItems(
  courses: Course[],
  books: Book[],
  sources: GallerySources = {}
): GalleryItem[] {
  const courseItems: GalleryItem[] = courses.map((course) => ({
    id: `${ARTIFACT_ID_PREFIX.course}${course.id}`,
    title: course.title,
    kind: 'course',
    kindLabel: ARTIFACT_KIND_LABELS.course,
    category: course.category,
    coverPath: course.cover_path,
    progress: coursePercent(course),
    progressSource: 'measured',
    status: course.status,
    meta: `${course.completed_lessons || 0}/${course.total_lessons || 0} lecciones`
  }));

  const bookItems: GalleryItem[] = books.map((book) => ({
    id: `${ARTIFACT_ID_PREFIX.book}${book.id}`,
    title: book.title,
    kind: 'book',
    kindLabel: ARTIFACT_KIND_LABELS.book,
    category: book.category,
    coverPath: book.cover_path,
    progress: bookPercent(book),
    progressSource: 'measured',
    status: book.status,
    meta:
      book.page_count != null
        ? `Pág. ${book.current_page || 0}/${book.page_count}`
        : book.author || ''
  }));

  const resourceItems: GalleryItem[] = (sources.resources || [])
    .filter((resource) => resource.type !== 'course' && resource.type !== 'book')
    .map((resource) => ({
      id: `${ARTIFACT_ID_PREFIX.resource}${resource.id}`,
      title: resource.title,
      kind: 'resource' as ArtifactKind,
      kindLabel: ARTIFACT_KIND_LABELS.resource,
      category: resource.category,
      coverPath: resource.cover_path,
      progress: statusPercent(resource.status),
      progressSource: 'status' as GalleryProgressSource,
      status: resource.status,
      meta: resource.category || 'Documento importado'
    }));

  const practiceItems: GalleryItem[] = (sources.practiceWork || []).map((work) => ({
    id: `${ARTIFACT_ID_PREFIX.practice}${work.id}`,
    title: work.title,
    kind: 'practice' as ArtifactKind,
    kindLabel: ARTIFACT_KIND_LABELS.practice,
    category: undefined,
    coverPath: undefined,
    progress: statusPercent(galleryStatusOfPracticeWork(work.status)),
    progressSource: 'status' as GalleryProgressSource,
    status: galleryStatusOfPracticeWork(work.status),
    meta: practiceWorkKindLabel(work.kind)
  }));

  return sortGalleryItems([...courseItems, ...bookItems, ...resourceItems, ...practiceItems]);
}

/**
 * Ordena por atención. El algoritmo es ESTABLE (decoración con el índice
 * original), así que los recursos con el mismo estado conservan el orden en que
 * llegaron.
 */
export function sortGalleryItems(items: GalleryItem[]): GalleryItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = resourceStatusRank(a.item.status) - resourceStatusRank(b.item.status);
      return rank !== 0 ? rank : a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Reparto del panel por propósito. Cada artefacto aparece en UNA sola sección:
 * las secciones no son filtros independientes, son una partición, así que la
 * misma fila nunca se muestra dos veces (evita la galería "inflada").
 */
export interface GallerySections {
  /** Cursos y libros con progreso medido, aún no completados. */
  continueLearning: GalleryItem[];
  /** Recursos importados (documentos) sin porcentaje propio. */
  resources: GalleryItem[];
  /** Trabajo práctico producido por el estudiante. */
  practice: GalleryItem[];
  /** Cursos y libros completados, mostrados en último lugar. */
  completed: GalleryItem[];
}

export function groupGalleryItems(items: GalleryItem[]): GallerySections {
  const sections: GallerySections = { continueLearning: [], resources: [], practice: [], completed: [] };
  for (const item of items) {
    if (item.kind === 'practice') {
      sections.practice.push(item);
    } else if (item.kind === 'resource') {
      sections.resources.push(item);
    } else if (item.status === 'COMPLETED') {
      sections.completed.push(item);
    } else {
      sections.continueLearning.push(item);
    }
  }
  return sections;
}
