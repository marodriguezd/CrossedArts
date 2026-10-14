import type {
  Book,
  Course,
  GraphNodeType,
  LearningGoal,
  Note,
  ResourceDestination,
} from '../types/models.ts';
import { practiceWorkKindLabel, practiceWorkStatusLabel } from './practiceWork.ts';
import { GOAL_KIND_LABELS, goalKindLabel } from './goals.ts';
import { resolveArtifactContextDestination } from './domainLogic.ts';

/**
 * Global command-palette logic (Ctrl+K / Cmd+K).
 *
 * This module is PURE: no SQLite, no DOM reads, no network, no React. All
 * palette smarts live here so it tests with `node:test` and no browser.
 *
 * Design call: results are NOT fetched with SQL per keystroke. The palette builds
 * an in-memory catalog (actions, plus the courses, books, and notes `useAppData`
 * already holds, plus flat lesson/concept indexes) and filters locally.
 * Consequences:
 *
 * - Zero network requests and zero queries per keystroke (Rule 1).
 * - Matches from the FIRST character, not the 2-char minimum imposed by
 *   `dao.searchKnowledge` (SQL `LIKE`).
 * - True relevance order, not the DAO's flat alphabetic order.
 * - Diacritic-insensitive: Spanish "Introduccion" must match without accents
 *   even when the user skips the accent.
 * - Also searches note/lesson BODIES, where the user remembers writing
 *   something. `dao.searchKnowledge` did (SQL `LIKE` over `note.content`);
 *   titles-only search would be a regression.
 * - Highlights the match with exact offsets over the original text.
 * - Subsequence fuzzy safety net: "itn" finds "introduccion".
 */

/** Visual/semantic grouping of a palette item. */
export type PaletteGroup =
  | 'accion'
  | 'meta'
  | 'curso'
  | 'libro'
  | 'recurso'
  | 'practica'
  | 'leccion'
  | 'nota'
  | 'concepto';

export interface PaletteItem {
  /** Stable unique id within the catalog. */
  id: string;
  group: PaletteGroup;
  title: string;
  subtitle?: string;
  /** Icon kind to show. `accion` covers navigation and utilities. */
  icon: GraphNodeType | 'accion';
  /**
   * Navigation target of an ENTITY, or `null` when the item is an ACTION (go to
   * a tab, review, export, switch theme), dispatched through its own callback.
   */
  destination: ResourceDestination | null;
  /** Extra aliases/synonyms that must also find it. */
  keywords?: string[];
  /**
   * Long text that is also searched: note body, lesson content. The field that
   * finds things by what was written, not just how they were titled.
   */
  body?: string;
  /**
   * Normalized form of `body`, filled by `buildPaletteCatalog`.
   *
   * Exists so bodies are NOT renormalized per keystroke: with 30 long lessons,
   * renormalizing on every key would be the palette's bottleneck.
   */
  bodyNormalized?: string;
}

/** Lesson index row (`dao.getLessonIndex`). */
export interface LessonIndexRow {
  lessonId: string;
  lessonTitle: string;
  lessonContent?: string;
  durationMinutes: number;
  moduleTitle: string;
  courseId: string;
  courseTitle: string;
}

/** Concept index row (`dao.getConceptIndex`). */
export interface ConceptIndexRow {
  conceptId: string;
  conceptName: string;
  conceptDescription?: string;
}
export interface ResourceIndexRow {
  resourceId: string;
  resourceTitle: string;
  resourceDescription?: string;
  resourceCategory?: string;
  resourceType: string;
}

/** Practice-work index row (`dao.getPracticeWorkIndex`). */
export interface PracticeWorkIndexRow {
  practiceId: string;
  practiceTitle: string;
  practiceDescription?: string;
  practiceKind: string;
  practiceStatus: string;
  resourceId?: string;
  lessonId?: string;
  conceptId?: string;
  contextTitle?: string;
}

export interface PaletteCatalogInput {
  courses: Course[];
  books: Book[];
  notes: Note[];
  lessons: LessonIndexRow[];
  concepts: ConceptIndexRow[];
  resources: ResourceIndexRow[];
  /** User practice work: evidence without its own view. */
  practiceWork: PracticeWorkIndexRow[];
  /** User learning goals (optional: legacy catalogs omit them). */
  goals?: readonly LearningGoal[];
  /** Pending review cards, used to label the review action. */
  pendingReviews: number;
  /** Resume target: next pending lesson, or null when none remains. */
  continueTarget: { courseId: string; lessonId: string; courseTitle: string; lessonTitle: string } | null;
  /** True when the current theme is dark. */
  isDarkTheme: boolean;
}

/* -------------------------------------------------------------------------- */
/* Normalization and ranking                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Normalize text while keeping the map to the ORIGINAL indexes.
 *
 * Why normalizing is not enough: `"Introduccion"` is 12 chars in NFC and 13 in
 * NFD, because the accent decomposes into `o` + combining mark. Any `indexOf`
 * over the normalized form returns offsets that do NOT match the original text,
 * and highlighting would split words mid-way. Space collapsing shifts too.
 *
 * `origin[i]` is the original-text index of the char that produced
 * `normalized[i]`. That is what highlights without guessing.
 */
export function normalizeWithMap(text: string): { normalized: string; origin: number[] } {
  if (!text) return { normalized: '', origin: [] };

  let normalized = '';
  const origin: number[] = [];
  let previousWasSpace = false;

  for (let index = 0; index < text.length; index++) {
    // Normalize char by char: one original char can yield several normalized
    // ones (rare cases like ligatures), all mapped to the same origin index.
    const folded = text[index]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    for (const piece of folded) {
      if (/\s/.test(piece)) {
        // Collapse space runs; drop leading ones.
        if (previousWasSpace || normalized.length === 0) continue;
        normalized += ' ';
        origin.push(index);
        previousWasSpace = true;
        continue;
      }
      normalized += piece;
      origin.push(index);
      previousWasSpace = false;
    }
  }

  // Trailing-space text must not leave a tail that breaks search.
  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    origin.pop();
  }

  return { normalized, origin };
}

/**
 * Normalize a query or text for case/accent/extra-space-insensitive comparison.
 *
 * Delegates to `normalizeWithMap` so needle and haystack ALWAYS share one
 * transform: any divergence would shift the highlighted ranges.
 */
export function normalizePaletteQuery(query: string): string {
  if (!query) return '';
  return normalizeWithMap(query).normalized;
}

/** Match-tier scores. Higher is better. */
export const PALETTE_SCORE = {
  exact: 1000,
  prefix: 800,
  wordStart: 600,
  substring: 400,
  subtitle: 200,
  keyword: 151,
  keywordPrefix: 150,
  keywordInner: 149,
  /** Body match: the note or lesson mentions it. */
  body: 120,
  /** Dense-subsequence fuzzy match: "int" ~ "introduccion". */
  fuzzy: 100,
  fuzzyMid: 90,
  fuzzyLow: 80
} as const;

/**
 * Minimum query length for fuzzy matches.
 *
 * Without this floor, any trigram would match half the library and flood the
 * list with noise. Fuzzy hits also rank last, so they only surface when
 * nothing better matches.
 */
export const PALETTE_FUZZY_MIN_LENGTH = 3;

/** Characters that mark a word start. */
const WORD_SEPARATORS = new Set([' ', '-', ':', '>', ',', '.', '/', '(', '¡']);

/** Title tier, keeping the BEST across all occurrences. */
function bestTitleTier(haystack: string, needle: string): number | null {
  if (!haystack || !needle) return null;
  if (haystack === needle) return PALETTE_SCORE.exact;
  if (haystack.startsWith(needle)) return PALETTE_SCORE.prefix;

  let best: number | null = null;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    // Scan ALL occurrences: with plain `indexOf`, a term first seen inside a
    // word and later at another word start would rank as `substring` when
    // `wordStart` applies.
    const tier =
      at === 0
        ? PALETTE_SCORE.prefix
        : WORD_SEPARATORS.has(haystack.charAt(at - 1))
          ? PALETTE_SCORE.wordStart
          : PALETTE_SCORE.substring;
    if (best === null || tier > best) best = tier;
    from = at + 1;
  }
  return best;
}

/**
 * Subsequence fuzzy match over title and subtitle.
 *
 * Scores by DENSITY: "int" inside "introduccion" spans almost the whole
 * range and scores high; "itn" covers one in three chars and scores low. This
 * safety net ranks the relevant ahead of the merely possible.
 */
function fuzzyScoreFor(item: PaletteItem, normalizedQuery: string): number | null {
  if (normalizedQuery.length < PALETTE_FUZZY_MIN_LENGTH) return null;

  let best: number | null = null;
  for (const raw of [item.title, item.subtitle]) {
    if (!raw) continue;
    const haystack = normalizeWithMap(raw).normalized;
    if (haystack.length < normalizedQuery.length) continue;

    let cursor = 0;
    let firstAt = -1;
    let lastAt = -1;
    for (let i = 0; i < haystack.length && cursor < normalizedQuery.length; i++) {
      if (haystack[i] !== normalizedQuery[cursor]) continue;
      if (firstAt < 0) firstAt = i;
      lastAt = i;
      cursor++;
    }
    if (cursor < normalizedQuery.length) continue;

    const span = lastAt - firstAt + 1;
    const density = span === 0 ? 1 : normalizedQuery.length / span;
    const score =
      density >= 0.75 ? PALETTE_SCORE.fuzzy : density >= 0.4 ? PALETTE_SCORE.fuzzyMid : PALETTE_SCORE.fuzzyLow;
    if (best === null || score > best) best = score;
  }

  return best;
}

/**
 * Scores an item against an ALREADY normalized query.
 * Returns `null` when the item does not match at all.
 *
 * Tiers are mutually exclusive per keyword: the strongest available match wins
 * and they evaluate in order. Title outranks everything else.
 */
export function scorePaletteItem(item: PaletteItem, normalizedQuery: string): number | null {
  if (!normalizedQuery) return 0;

  const titleTier = bestTitleTier(normalizeWithMap(item.title).normalized, normalizedQuery);
  if (titleTier !== null) return titleTier;

  if (item.subtitle) {
    const subtitle = normalizeWithMap(item.subtitle).normalized;
    if (subtitle.includes(normalizedQuery)) return PALETTE_SCORE.subtitle;
  }

  if (item.keywords) {
    for (const keyword of item.keywords) {
      const normalizedKeyword = normalizeWithMap(keyword).normalized;
      if (!normalizedKeyword) continue;
      if (normalizedKeyword === normalizedQuery) return PALETTE_SCORE.keyword;
      if (normalizedKeyword.startsWith(normalizedQuery)) return PALETTE_SCORE.keywordPrefix;
      if (normalizedKeyword.includes(normalizedQuery)) return PALETTE_SCORE.keywordInner;
    }
  }

  if (item.bodyNormalized && item.bodyNormalized.includes(normalizedQuery)) return PALETTE_SCORE.body;

  return fuzzyScoreFor(item, normalizedQuery);
}

/* -------------------------------------------------------------------------- */
/* Match highlighting                                                          */
/* -------------------------------------------------------------------------- */

export interface TextRange {
  start: number;
  end: number;
}

/**
 * Finds all CONTIGUOUS query occurrences in a text and returns ranges as
 * ORIGINAL-TEXT indexes, not normalized-form offsets.
 *
 * Only contiguous matches are highlighted. Fuzzy matches are located by
 * subsequence, so they form no markable span without inventing intermediate
 * chars; they stand out by ranking last.
 */
export function matchRangesInText(text: string, normalizedQuery: string): TextRange[] {
  if (!text || !normalizedQuery) return [];
  const { normalized, origin } = normalizeWithMap(text);
  const ranges: TextRange[] = [];

  let from = 0;
  for (;;) {
    const at = normalized.indexOf(normalizedQuery, from);
    if (at < 0) break;
    const lastIndex = at + normalizedQuery.length - 1;
    if (origin[at] !== undefined && origin[lastIndex] !== undefined) {
      ranges.push({ start: origin[at], end: origin[lastIndex] + 1 });
    }
    from = at + 1;
  }
  return ranges;
}

/** Renderable text segment, flagged as match or not. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Splits text into alternating segments so matches can be wrapped in `<mark>`.
 * Segments contain exactly the input text: renderers must never rewrite content.
 */
export function segmentForHighlight(text: string, ranges: TextRange[]): HighlightSegment[] {
  if (!text) return [];
  if (!ranges.length) return [{ text, match: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;

  for (const range of [...ranges].sort((a, b) => a.start - b.start)) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (end <= start) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}

/**
 * Extracts the matching body fragment, answering "why does this match?"
 * inline. Trims with left context and marks clipping with honest ellipses.
 */
export function bodySnippet(body: string, normalizedQuery: string, maxLength = 80): string {
  if (!body || !normalizedQuery) return '';
  const ranges = matchRangesInText(body, normalizedQuery);
  if (!ranges.length) return body.slice(0, maxLength).trim();

  const at = ranges[0].start;
  const left = Math.max(0, at - Math.floor((maxLength - (ranges[0].end - at)) / 2));
  const slice = body.slice(left, left + maxLength).replace(/\s+/g, ' ').trim();
  return `${left > 0 ? '…' : ''}${slice}${left + maxLength < body.length ? '…' : ''}`;
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                     */
/* -------------------------------------------------------------------------- */

/** Human label per group, reused by the UI. */
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string> = {
  accion: 'Acciones',
  meta: 'Metas',
  curso: 'Cursos',
  libro: 'Libros',
  recurso: 'Recursos',
  practica: 'Trabajo práctico',
  leccion: 'Lecciones',
  nota: 'Notas',
  concepto: 'Conceptos'
};

const NAV_ACTION_STRINGS: Record<string, { titleKey: string; subtitleKey: string }> = {
  'accion:dashboard': { titleKey: 'palette.nav.dashboard', subtitleKey: 'palette.nav.dashboardSub' },
  'accion:focus': { titleKey: 'palette.nav.focus', subtitleKey: 'palette.nav.focusSub' },
  'accion:analytics': { titleKey: 'palette.nav.analytics', subtitleKey: 'palette.nav.analyticsSub' },
  'accion:goals': { titleKey: 'palette.nav.goals', subtitleKey: 'palette.nav.goalsSub' },
  'accion:library': { titleKey: 'palette.nav.library', subtitleKey: 'palette.nav.librarySub' },
  'accion:graph': { titleKey: 'palette.nav.graph', subtitleKey: 'palette.nav.graphSub' },
  'accion:notes': { titleKey: 'palette.nav.notes', subtitleKey: 'palette.nav.notesSub' },
  'accion:settings': { titleKey: 'palette.nav.settings', subtitleKey: 'palette.nav.settingsSub' }
};

/** Navigation actions with localized title/subtitle (Spanish when omitted). */
export function navigationActions(lang: LanguageCode = 'es'): PaletteItem[] {
  return NAVIGATION_ACTIONS.map(action => {
    const keys = NAV_ACTION_STRINGS[action.id];
    if (!keys) return { ...action };
    return {
      ...action,
      title: translateKey(lang, keys.titleKey),
      subtitle: translateKey(lang, keys.subtitleKey)
    };
  });
}

/** Localized palette group label. Defaults to Spanish (callers omit it). */
export function paletteGroupLabel(group: PaletteGroup, lang: LanguageCode = 'es'): string {
  return translateKey(lang, `palette.group.${group}`);
}

/** Fixed group order in the palette: predictable at-a-glance view. */
const GROUP_ORDER: PaletteGroup[] = [
  'accion',
  'meta',
  'curso',
  'libro',
  'recurso',
  'practica',
  'leccion',
  'nota',
  'concepto'
];

/**
 * Maps a navigation ACTION id to the top-level tab the app already exposes
 * via `handleNavigateTab`.
 *
 * `ResourceDestination` models an ENTITY destination (course, note, concept),
 * not a UI tab. Navigation actions need the top-level tabs held in `App.tsx`
 * state (`currentTab`), so they dispatch by id rather than destination.
 *
 * Returns `null` for non-navigation actions (continue, review, export, theme
 * switch, AI tutor, folder scan), which use their own callback.
 */
export function resolveActionTab(actionId: string): string | null {
  switch (actionId) {
    case 'accion:dashboard':
      return 'dashboard';
    case 'accion:focus':
      return 'focus';
    case 'accion:analytics':
      return 'analytics';
    case 'accion:goals':
      return 'goals';
    case 'accion:library':
      return 'library';
    case 'accion:graph':
      return 'graph';
    case 'accion:notes':
      return 'notes';
    case 'accion:settings':
      return 'settings';
    default:
      return null;
  }
}

/** Static navigation actions. The destination resolves by id. */
const NAVIGATION_ACTIONS: PaletteItem[] = [
  {
    id: 'accion:dashboard',
    group: 'accion',
    title: 'Ir al Dashboard',
    subtitle: 'Métricas, racha y accesos directos',
    icon: 'accion',
    destination: null,
    keywords: ['inicio', 'home', 'kpi', 'racha', 'metricas', 'resumen']
  },
  {
    id: 'accion:focus',
    group: 'accion',
    title: 'Ir a Hoy',
    subtitle: 'Qué hacer ahora, derivado de tus datos',
    icon: 'accion',
    destination: null,
    keywords: ['hoy', 'focus', 'enfoque', 'siguiente', 'recomendar', 'pendiente', 'dia']
  },
  {
    id: 'accion:analytics',
    group: 'accion',
    title: 'Ir a Análisis',
    subtitle: 'Tiempo, constancia y progreso real',
    icon: 'accion',
    destination: null,
    keywords: ['analitica', 'estadisticas', 'metricas', 'grafico', 'tendencia', 'progreso']
  },
  {
    id: 'accion:goals',
    group: 'accion',
    title: 'Ir a Metas',
    subtitle: 'Objetivos de aprendizaje con progreso medido',
    icon: 'accion',
    destination: null,
    keywords: ['metas', 'objetivos', 'goals', 'planificacion', 'fecha', 'cumplir']
  },
  {
    id: 'accion:library',
    group: 'accion',
    title: 'Ir a la Biblioteca',
    subtitle: 'Catálogo de cursos, libros y recursos',
    icon: 'accion',
    destination: null,
    keywords: ['catalogo', 'recursos', 'cursos', 'libros']
  },
  {
    id: 'accion:graph',
    group: 'accion',
    title: 'Abrir el Grafo de conocimiento',
    subtitle: 'Relaciones entre cursos, notas y conceptos',
    icon: 'accion',
    destination: null,
    keywords: ['grafo', 'red', 'conexiones', 'mapa', 'relaciones']
  },
  {
    id: 'accion:notes',
    group: 'accion',
    title: 'Ir a Notas',
    subtitle: 'Todas las notas de estudio',
    icon: 'accion',
    destination: null,
    keywords: ['notas', 'apuntes', 'markdown']
  },
  {
    id: 'accion:settings',
    group: 'accion',
    title: 'Ir a Ajustes',
    subtitle: 'Copias de seguridad, IA local e índice semántico',
    icon: 'accion',
    destination: null,
    keywords: ['ajustes', 'configuracion', 'preferencias', 'backup', 'respaldo']
  }
];

/**
 * Indexed body cap, in characters.
 *
 * The body is used for content search, not reading: 4000 chars covers any term
 * a user remembers while bounding catalog memory and normalization cost. This
 * limit is deliberate, not an oversight.
 */
export const PALETTE_BODY_MAX_CHARS = 4000;

/**
 * Builds an item's `body` / `bodyNormalized` pair.
 *
 * Normalizing here instead of per keystroke keeps the palette instant: the
 * catalog is built when data changes, not on every keypress.
 */
function buildBody(text: string | undefined): { body?: string; bodyNormalized?: string } {
  if (!text) return {};
  const body = text.slice(0, PALETTE_BODY_MAX_CHARS);
  if (!body.trim()) return {};
  return { body, bodyNormalized: normalizeWithMap(body).normalized };
}

/**
 * Builds the full palette catalog deterministically.
 *
 * Each entity collection is sorted by title then id BEFORE appending, so the
 * catalog never depends on fetch order: two loads returning the same rows in
 * different order produce exactly the same palette, which keeps ranking testable.
 */
export function buildPaletteCatalog(input: PaletteCatalogInput, lang: LanguageCode = 'es'): PaletteItem[] {
  const items: PaletteItem[] = navigationActions(lang);
  const tr = (key: string, params?: Record<string, string | number | null | undefined>): string =>
    translateKey(lang, key, params);

  // Each collection uses ITS own accessors: lesson and concept rows expose
  // `lessonTitle` / `conceptName`, not `title`.
  const byTextThenId = <T,>(getText: (item: T) => string, getId: (item: T) => string) => (a: T, b: T) =>
    getText(a).localeCompare(getText(b)) || getId(a).localeCompare(getId(b));
  const byCourse = byTextThenId<Course>(course => course.title, course => course.id);
  const byBook = byTextThenId<Book>(book => book.title, book => book.id);
  const byNote = byTextThenId<Note>(note => note.title, note => note.id);
  const byLesson = byTextThenId<LessonIndexRow>(lesson => lesson.lessonTitle, lesson => lesson.lessonId);
  const byConcept = byTextThenId<ConceptIndexRow>(
    concept => concept.conceptName,
    concept => concept.conceptId
  );

  // Contextual action: only shown while a real pending lesson exists.
  if (input.continueTarget) {
    items.push({
      id: 'accion:continue',
      group: 'accion',
      title: tr('palette.continue'),
      subtitle: `${input.continueTarget.lessonTitle} · ${input.continueTarget.courseTitle}`,
      icon: 'accion',
      destination: {
        tab: 'course',
        resourceId: input.continueTarget.courseId,
        lessonId: input.continueTarget.lessonId
      },
      keywords: ['seguir', 'retomar', 'progreso', 'pendiente', 'continuar']
    });
  }

  items.push({
    id: 'accion:review',
    group: 'accion',
    title: tr('palette.review'),
    subtitle:
      input.pendingReviews > 0
        ? tr(`palette.reviewDue.${input.pendingReviews === 1 ? 'one' : 'other'}`, { n: input.pendingReviews })
        : tr('palette.reviewEmpty'),
    icon: 'accion',
    destination: null,
    keywords: ['sm2', 'supermemo', 'flashcards', 'tarjetas', 'repaso', 'practica', 'espaciado']
  });

  items.push({
    id: 'accion:ai',
    group: 'accion',
    title: tr('palette.tutor'),
    subtitle: tr('palette.tutorSub'),
    icon: 'accion',
    destination: null,
    keywords: ['ia', 'asistente', 'tutor', 'preguntar', 'rag', 'llm']
  });

  items.push({
    id: 'accion:mount-folder',
    group: 'accion',
    title: tr('palette.scan'),
    subtitle: tr('palette.scanSub'),
    icon: 'accion',
    destination: null,
    keywords: ['carpeta', 'disco', 'video', 'medios', 'scan', 'importar', 'fsa']
  });

  items.push({
    id: 'accion:backup',
    group: 'accion',
    title: tr('palette.backup'),
    subtitle: tr('palette.backupSub'),
    icon: 'accion',
    destination: null,
    keywords: ['backup', 'respaldo', 'exportar', 'sqlite', 'descargar', 'copia']
  });

  items.push({
    id: 'accion:theme',
    group: 'accion',
    title: input.isDarkTheme ? tr('palette.themeLight') : tr('palette.themeDark'),
    subtitle: tr('palette.themeSub'),
    icon: 'accion',
    destination: null,
    keywords: ['tema', 'claro', 'oscuro', 'carbon', 'crema', 'apariencia', 'dark', 'light']
  });

  for (const course of [...input.courses].sort(byCourse)) {
    items.push({
      id: `curso:${course.id}`,
      group: 'curso',
      title: course.title,
      subtitle: course.description || course.category || tr('palette.courseFallback'),
      icon: 'course',
      destination: { tab: 'course', resourceId: course.id },
      keywords: [course.category, course.instructor ?? '', 'curso'],
      ...buildBody(course.description)
    });
  }

  for (const book of [...input.books].sort(byBook)) {
    items.push({
      id: `libro:${book.id}`,
      group: 'libro',
      title: book.title,
      subtitle: book.author || book.description || tr('palette.bookFallback'),
      icon: 'book',
      destination: { tab: 'resource', resourceId: book.id },
      keywords: [book.author ?? '', book.category, 'libro', 'leer'],
      // Same body indexed for courses. A book with a relevant synopsis was
      // invisible to users searching in their own words.
      ...buildBody(book.description)
    });
  }

  for (const lesson of [...input.lessons].sort(byLesson)) {
    items.push({
      id: `leccion:${lesson.lessonId}`,
      group: 'leccion',
      title: lesson.lessonTitle,
      subtitle: `${lesson.courseTitle} > ${lesson.moduleTitle}`,
      icon: 'lesson',
      destination: { tab: 'course', resourceId: lesson.courseId, lessonId: lesson.lessonId },
      keywords: [lesson.courseTitle, lesson.moduleTitle, 'leccion'],
      // Lesson content is the densest part of the library: without it, the
      // palette would only find lessons by title.
      ...buildBody(lesson.lessonContent)
    });
  }

  for (const note of [...input.notes].sort(byNote)) {
    const context = note.lesson_id
      ? tr('palette.noteLesson')
      : note.resource_id
        ? tr('palette.noteResource')
        : tr('palette.noteGeneral');
    const body = buildBody(note.content);
    items.push({
      id: `nota:${note.id}`,
      group: 'nota',
      title: note.title,
      // The subtitle is a short SUMMARY, not the full body: a 4000-char note
      // in the subtitle is CSS-truncated yet still costs 4000 DOM text nodes,
      // and would bury the `body` tier built for beyond-summary matches.
      subtitle: body.body ? body.body.slice(0, 80) : context,
      icon: 'note',
      destination: { tab: 'note', noteId: note.id },
      keywords: [context, 'nota', ...(note.tags || [])],
      ...body
    });
  }

  // Courses and books already have their own collections; the rest of
  // `learning_resource` goes here: user-imported PDF, EPUB, Markdown, and text.
  // They were unreachable from Ctrl+K despite Library search, graph nodes,
  // and their own ResourceDetail view.
  const byResource = byTextThenId<ResourceIndexRow>(r => r.resourceTitle, r => r.resourceId);
  for (const resource of [...input.resources].sort(byResource)) {
    items.push({
      id: `recurso:${resource.resourceId}`,
      group: 'recurso',
      title: resource.resourceTitle,
      subtitle: resource.resourceCategory || tr('gallery.meta.importedDoc'),
      icon: 'resource',
      destination: { tab: 'resource', resourceId: resource.resourceId },
      keywords: [resource.resourceType, resource.resourceCategory ?? '', 'recurso', 'documento', 'importado'],
      ...buildBody(resource.resourceDescription)
    });
  }

  // Practice work: user-produced evidence. Searchable by title and
  // description; its target is its origin context (resource, lesson, or
  // concept) since it has no dedicated view. Same decision as the graph.
  const byPractice = byTextThenId<PracticeWorkIndexRow>(p => p.practiceTitle, p => p.practiceId);
  for (const work of [...input.practiceWork].sort(byPractice)) {
    const kindLabel = practiceWorkKindLabel(work.practiceKind, lang);
    items.push({
      id: `practica:${work.practiceId}`,
      group: 'practica',
      title: work.practiceTitle,
      subtitle: work.contextTitle
        ? `${kindLabel} · ${work.contextTitle}`
        : `${kindLabel} · ${practiceWorkStatusLabel(work.practiceStatus, lang)}`,
      icon: 'practice',
      destination: resolveArtifactContextDestination({
        resourceId: work.resourceId,
        lessonId: work.lessonId,
        conceptId: work.conceptId
      }),
      keywords: [kindLabel, work.contextTitle ?? '', 'practica', 'trabajo', 'evidencia', 'proyecto'],
      ...buildBody(work.practiceDescription)
    });
  }

  for (const concept of [...input.concepts].sort(byConcept)) {
    items.push({
      id: `concepto:${concept.conceptId}`,
      group: 'concepto',
      title: concept.conceptName,
      subtitle: concept.conceptDescription || tr('graph.node.concept'),
      icon: 'concept',
      destination: { tab: 'concept', conceptId: concept.conceptId },
      keywords: ['concepto', 'idea', 'definicion']
      // No body on purpose: the concept description already IS its subtitle, and
      // the `subtitle` tier scores above `body`. Indexing it too would store
      // the same text twice for no gain.
    });
  }

  // Learning goals: searchable by title, description, and kind; their target
  // is the Goals view with that goal selected (deterministic target for an
  // entity without its own page).
  const byGoal = byTextThenId<LearningGoal>(goal => goal.title, goal => goal.id);
  for (const goal of [...(input.goals ?? [])].sort(byGoal)) {
    const kindLabel = goalKindLabel(goal.kind, lang);
    items.push({
      id: `meta:${goal.id}`,
      group: 'meta',
      title: goal.title,
      subtitle: goal.status === 'completed'
        ? `${kindLabel} · ${tr('goals.deadline.completed')}`
        : `${kindLabel} · ${tr('palette.goalActive')}${goal.target_date ? ` · ${tr('palette.goalTarget', { date: goal.target_date.slice(0, 10) })}` : ''}`,
      icon: 'accion',
      destination: { tab: 'goals', goalId: goal.id },
      keywords: ['meta', 'objetivo', 'goal', 'planificacion', kindLabel, goal.kind, goal.status],
      ...buildBody(goal.description)
    });
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* Filtering                                                                   */
/* -------------------------------------------------------------------------- */

/** Hard cap on shown results. */
export const PALETTE_RESULT_LIMIT = 30;

/**
 * Filters and sorts the catalog.
 *
 * Without a query returns the DEFAULT VIEW: actions first, then entities in
 * stable order, so opening the palette never dumps hundreds of rows at once.
 *
 * With a query returns relevance-sorted results. The tiebreak (title then id)
 * is explicit: the same input always yields the same list, which ranking tests
 * require.
 */
export function filterPaletteItems(
  items: PaletteItem[],
  query: string,
  limit: number = PALETTE_RESULT_LIMIT
): PaletteItem[] {
  return matchPaletteItems(items, query, limit).map(match => match.item);
}

/** One match, with everything the UI needs to explain it. */
export interface PaletteMatch {
  item: PaletteItem;
  score: number;
  /** Title text actually shown. */
  title: string;
  /** Ranges to highlight in that title, as original-text indexes. */
  titleRanges: TextRange[];
  /** Subtitle text actually shown: the context, or the matching body fragment. */
  subtitle: string;
  /** Ranges to highlight in that subtitle. */
  subtitleRanges: TextRange[];
  /** True when the body matched, not the title or subtitle. */
  matchedBody: boolean;
}

/** Threshold at or below which a match counts as coming from the body. */
const BODY_SCORE_CEILING = PALETTE_SCORE.body;

/**
 * Searches and SORTS, RETURNING match context.
 *
 * This is the function the component consumes. `filterPaletteItems` wraps it
 * for callers needing only the item list.
 *
 * With an empty query returns the default view (actions first, no highlight).
 * With a query returns results with highlight, body snippet, and the
 * content-match flag: without that, users cannot tell why a row appears.
 */
export function matchPaletteItems(
  items: PaletteItem[],
  query: string,
  limit: number = PALETTE_RESULT_LIMIT
): PaletteMatch[] {
  const normalizedQuery = normalizePaletteQuery(query);
  const safeLimit = Math.max(1, limit);

  if (!normalizedQuery) {
    const actions = items.filter(item => item.group === 'accion');
    const entities = items.filter(item => item.group !== 'accion');
    return [...actions, ...entities].slice(0, safeLimit).map(item => ({
      item,
      score: 0,
      title: item.title,
      titleRanges: [],
      subtitle: item.subtitle ?? '',
      subtitleRanges: [],
      matchedBody: false
    }));
  }

  const scored: Array<{ item: PaletteItem; score: number; matchedBody: boolean }> = [];
  for (const item of items) {
    const score = scorePaletteItem(item, normalizedQuery);
    if (score !== null) {
      scored.push({ item, score, matchedBody: score <= BODY_SCORE_CEILING });
    }
  }

  scored.sort(
    (a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title) || a.item.id.localeCompare(b.item.id)
  );

  return scored.slice(0, safeLimit).map(({ item, score, matchedBody }) => {
    // On a body hit, the subtitle is replaced by the matching fragment: the
    // only way users understand why the row appears. On a title hit, the
    // original context is kept.
    const subtitle = matchedBody && item.body ? bodySnippet(item.body, normalizedQuery) : (item.subtitle ?? '');
    return {
      item,
      score,
      matchedBody,
      title: item.title,
      titleRanges: matchRangesInText(item.title, normalizedQuery),
      subtitle,
      subtitleRanges: matchRangesInText(subtitle, normalizedQuery)
    };
  });
}

/**
 * Groups results while preserving relevance order within each group.
 * Empty groups are skipped and group order is fixed.
 */
export function groupPaletteItems<T extends PaletteItem | PaletteMatch>(
  items: T[],
  lang: LanguageCode = 'es'
): Array<{ group: PaletteGroup; label: string; items: T[] }> {
  // Accepts both bare items and full matches, so list-only callers skip
  // wrapping and highlight callers skip unwrapping.
  const groupOf = (entry: T): PaletteGroup => ('item' in entry ? (entry as PaletteMatch).item.group : (entry as PaletteItem).group);

  const result: Array<{ group: PaletteGroup; label: string; items: T[] }> = [];
  for (const group of GROUP_ORDER) {
    const groupItems = items.filter(item => groupOf(item) === group);
    if (groupItems.length) result.push({ group, label: paletteGroupLabel(group, lang), items: groupItems });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Keyboard selection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Moves the selection index with wraparound at both ends.
 *
 * Pure and empty-list tolerant because the result is recomputed on every
 * arrow press, when the list length may have changed.
 */
export function movePaletteSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (!Number.isFinite(current) || current < 0) return delta > 0 ? 0 : length - 1;
  const next = (current + delta) % length;
  return next < 0 ? next + length : next;
}

/* -------------------------------------------------------------------------- */
/* Global hotkey                                                               */
/* -------------------------------------------------------------------------- */

/** Minimal keyboard-event shape needed by the hotkey detector. */
export interface PaletteHotkeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Detects the palette open/close hotkey: `Ctrl+K` or `Cmd+K`.
 *
 * Requires exactly one modifier (ctrl XOR meta) to avoid firing with both,
 * and excludes `alt` and `shift` because triple-modifier combos are reserved
 * by the OS and the browser.
 *
 * Deliberately ignores the focused element: `Ctrl+K` is a modified combo and
 * never collides with typing shortcuts.
 */
export function isPaletteHotkey(event: PaletteHotkeyEvent): boolean {
  if (!event || typeof event.key !== 'string') return false;
  if (event.key.toLowerCase() !== 'k') return false;
  if (event.altKey || event.shiftKey) return false;
  return (event.ctrlKey ? 1 : 0) + (event.metaKey ? 1 : 0) === 1;
}

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Navigation callbacks the app already exposes for its views. Declared here
 * so `navigateToDestination` stays testable without React.
 */
export interface PaletteNavigation {
  openCourse: (courseId: string) => void;
  openLesson: (lessonId: string) => void;
  openNote: (noteId: string) => void;
  openConcept: (conceptId: string) => void;
  openResource: (resourceId: string) => void;
  openLibrary: () => void;
  /** Opens the Goals view, optionally with one goal selected. */
  openGoals?: (goalId?: string) => void;
}

/**
 * Runs a `ResourceDestination` against the existing navigation handlers.
 *
 * Covers all five type variants. The subtle case is lessons: when the target
 * carries `lessonId`, it routes to `openLesson`, which already resolves the
 * course and opens the exact lesson. `Library.tsx` dropped that `lessonId`
 * and opened only the course; the palette uses the full destination.
 */
export function navigateToDestination(destination: ResourceDestination, navigation: PaletteNavigation): void {
  switch (destination.tab) {
    case 'course':
      if (destination.lessonId) navigation.openLesson(destination.lessonId);
      else navigation.openCourse(destination.resourceId);
      return;
    case 'note':
      navigation.openNote(destination.noteId);
      return;
    case 'concept':
      navigation.openConcept(destination.conceptId);
      return;
    case 'resource':
      navigation.openResource(destination.resourceId);
      return;
    case 'goals':
      navigation.openGoals?.(destination.goalId);
      return;
    case 'library':
      navigation.openLibrary();
      return;
    default:
      return;
  }
}