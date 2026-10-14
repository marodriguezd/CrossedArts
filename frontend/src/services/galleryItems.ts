/**
 * Learning-artifact normalization for the dashboard visual gallery. Pure
 * domain-agnostic logic: courses, books, imported resources, and practice work
 * all map to ONE shape (`GalleryItem`) so the UI needs no per-type card. Kept
 * outside React for DOM-free node:test coverage. Deliberately explicit
 * progress semantics: `measured` is real granular data (completed lessons,
 * read pages) and may draw a bar; `status` stores NO percent, only a state
 * (NOT_STARTED / IN_PROGRESS / COMPLETED) — the UI shows the state, never an
 * invented percent. See docs/PROGRESS.md.
 */
import type { Book, Course, LearningResource, PracticeWork, ResourceStatus } from '../types/models.ts';
import { practiceWorkKindLabel } from './practiceWork.ts';
import { clampPercent } from './mountainPath.ts';

/** Conceptual category of a gallery learning artifact. */
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
export type ArtifactKind = 'course' | 'book' | 'resource' | 'practice';

/** How an artifact's progress is sourced (never silently mixed). */
export type GalleryProgressSource = 'measured' | 'status';

/** Normalized gallery item. */
export interface GalleryItem {
  id: string;
  title: string;
  /** Stable prefix also used to resolve the open action. */
  kind: ArtifactKind;
  /** Already translated kind label (e.g. course, book, practice work). */
  kindLabel: string;
  /** Free-form resource category. May be missing. */
  category?: string;
  /** Cover path resolved by the thumbnail service. */
  coverPath?: string;
  /** Own progress percent (0..100). Meaningful only when `measured`. */
  progress: number;
  /** Progress origin; the UI uses it to pick bar vs. state. */
  progressSource?: GalleryProgressSource;
  status?: ResourceStatus;
  /** Short metadata (lesson/page counts). */
  meta?: string;
}

/** Localized labels per artifact category. */
export const ARTIFACT_KIND_LABELS: Record<ArtifactKind, string> = {
  course: 'Curso',
  book: 'Libro',
  resource: 'Recurso',
  practice: 'Trabajo práctico'
};

/** Localized artifact-kind label. Defaults to Spanish (callers omit it). */
export function artifactKindLabel(kind: ArtifactKind, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `gallery.kind.${kind}`);
}

/** Prefix used to build each normalized artifact id. */
export const ARTIFACT_ID_PREFIX: Record<ArtifactKind, string> = {
  course: 'course:',
  book: 'book:',
  resource: 'resource:',
  practice: 'practice:'
};

/** Course progress percent (0 when no lessons declared). */
export function coursePercent(course: Pick<Course, 'completed_lessons' | 'total_lessons'>): number {
  const total = course.total_lessons || 0;
  if (total <= 0) return 0;
  return clampPercent(Math.round(((course.completed_lessons || 0) / total) * 100));
}

/** Book reading percent, clamped to [0, 100]. */
export function bookPercent(book: Pick<Book, 'reading_percentage'>): number {
  return clampPercent(Math.round(book.reading_percentage || 0));
}

/**
 * COARSE state indicator for artifacts without their own percent. Not a
 * progress measure: 50 means "underway", not "halfway". For sorting and text
 * badges only; the gallery never paints it as a bar.
 */
export function statusPercent(status?: ResourceStatus): number {
  if (status === 'COMPLETED') return 100;
  if (status === 'IN_PROGRESS') return 50;
  return 0;
}

/** Maps practice-work status to the shared status vocabulary. */
export function galleryStatusOfPracticeWork(status: PracticeWork['status']): ResourceStatus {
  if (status === 'DONE') return 'COMPLETED';
  if (status === 'IN_PROGRESS') return 'IN_PROGRESS';
  return 'NOT_STARTED';
}

/**
 * Cover initials for imageless resources. Skips stop words and never returns
 * more than two chars.
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

/** Attention order: in-progress first, completed last. */
export function resourceStatusRank(status?: string): number {
  if (status === 'IN_PROGRESS') return 0;
  if (status === 'NOT_STARTED') return 1;
  return 2;
}

/** Extra sources the gallery can project beyond courses and books. */
export interface GallerySources {
  /** Imported resources (documents) not yet courses or books. */
  resources?: LearningResource[];
  /** Learner-produced practice work. */
  practiceWork?: PracticeWork[];
}

/**
 * Builds the normalized gallery list from ALL supported sources. `id` carries
 * a kind prefix to avoid cross-table collisions. Resources typed course/book
 * arriving via `resources` are skipped (already projected from
 * `courses`/`books`): the gallery never duplicates a row.
 */
export function buildGalleryItems(
  courses: Course[],
  books: Book[],
  sources: GallerySources = {},
  lang: LanguageCode = 'es'
): GalleryItem[] {
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);
  const courseItems: GalleryItem[] = courses.map((course) => ({
    id: `${ARTIFACT_ID_PREFIX.course}${course.id}`,
    title: course.title,
    kind: 'course',
    kindLabel: tr('gallery.kind.course'),
    category: course.category,
    coverPath: course.cover_path,
    progress: coursePercent(course),
    progressSource: 'measured',
    status: course.status,
    meta: tr('gallery.meta.lessons', { done: course.completed_lessons || 0, total: course.total_lessons || 0 })
  }));

  const bookItems: GalleryItem[] = books.map((book) => ({
    id: `${ARTIFACT_ID_PREFIX.book}${book.id}`,
    title: book.title,
    kind: 'book',
    kindLabel: tr('gallery.kind.book'),
    category: book.category,
    coverPath: book.cover_path,
    progress: bookPercent(book),
    progressSource: 'measured',
    status: book.status,
    meta:
      book.page_count != null
        ? tr('gallery.meta.pages', { cur: book.current_page || 0, total: book.page_count })
        : book.author || ''
  }));

  const resourceItems: GalleryItem[] = (sources.resources || [])
    .filter((resource) => resource.type !== 'course' && resource.type !== 'book')
    .map((resource) => ({
      id: `${ARTIFACT_ID_PREFIX.resource}${resource.id}`,
      title: resource.title,
      kind: 'resource' as ArtifactKind,
      kindLabel: tr('gallery.kind.resource'),
      category: resource.category,
      coverPath: resource.cover_path,
      progress: statusPercent(resource.status),
      progressSource: 'status' as GalleryProgressSource,
      status: resource.status,
      meta: resource.category || tr('gallery.meta.importedDoc')
    }));

  const practiceItems: GalleryItem[] = (sources.practiceWork || []).map((work) => ({
    id: `${ARTIFACT_ID_PREFIX.practice}${work.id}`,
    title: work.title,
    kind: 'practice' as ArtifactKind,
    kindLabel: tr('gallery.kind.practice'),
    category: undefined,
    coverPath: undefined,
    progress: statusPercent(galleryStatusOfPracticeWork(work.status)),
    progressSource: 'status' as GalleryProgressSource,
    status: galleryStatusOfPracticeWork(work.status),
    meta: practiceWorkKindLabel(work.kind, lang)
  }));

  return sortGalleryItems([...courseItems, ...bookItems, ...resourceItems, ...practiceItems]);
}

/**
 * Sorts by attention. The algorithm is STABLE (index decoration), so resources
 * sharing a state keep arrival order.
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
 * Panel split by purpose. Each artifact appears in ONE section only: sections
 * are a partition, not independent filters, so no row ever shows twice
 * (avoids the "bloated" gallery).
 */
export interface GallerySections {
  /** Courses and books with measured progress, not yet completed. */
  continueLearning: GalleryItem[];
  /** Imported resources (documents) with no progress percent of their own. */
  resources: GalleryItem[];
  /** Learner-produced practice work. */
  practice: GalleryItem[];
  /** Completed courses and books, shown last. */
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
