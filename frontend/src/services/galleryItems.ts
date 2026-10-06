/**
 * Normalización de recursos de aprendizaje para la galería visual del panel.
 *
 * Lógica pura y agnóstica al dominio: cursos y libros se traducen a la MISMA
 * forma (`GalleryItem`) para que la interfaz no tenga una tarjeta distinta por
 * cada tipo. Al vivir fuera de React se prueba con node:test sin DOM.
 */
import type { Book, Course, ResourceStatus } from '../types/models.ts';

/** Elemento ya normalizado de la galería. */
export interface GalleryItem {
  id: string;
  title: string;
  /** Etiqueta de tipo ya traducida (p. ej. "Curso", "Libro"). */
  kindLabel: string;
  /** Categoría libre del recurso ("Programación", "Música"…). Puede faltar. */
  category?: string;
  /** Ruta de portada resuelta por el servicio de miniaturas. */
  coverPath?: string;
  /** Porcentaje de progreso propio (0..100). */
  progress: number;
  status?: ResourceStatus;
  /** Metadato corto ("5/12 lecciones", "Pág. 40/300"). */
  meta?: string;
}

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

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
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

/**
 * Construye la lista normalizada de la galería a partir de cursos y libros.
 * `id` lleva prefijo de tipo para no colisionar entre tablas distintas.
 */
export function buildGalleryItems(
  courses: Course[],
  books: Book[]
): GalleryItem[] {
  const courseItems: GalleryItem[] = courses.map((course) => ({
    id: `course:${course.id}`,
    title: course.title,
    kindLabel: 'Curso',
    category: course.category,
    coverPath: course.cover_path,
    progress: coursePercent(course),
    status: course.status,
    meta: `${course.completed_lessons || 0}/${course.total_lessons || 0} lecciones`
  }));

  const bookItems: GalleryItem[] = books.map((book) => ({
    id: `book:${book.id}`,
    title: book.title,
    kindLabel: 'Libro',
    category: book.category,
    coverPath: book.cover_path,
    progress: bookPercent(book),
    status: book.status,
    meta:
      book.page_count != null
        ? `Pág. ${book.current_page || 0}/${book.page_count}`
        : book.author || ''
  }));

  return sortGalleryItems([...courseItems, ...bookItems]);
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
