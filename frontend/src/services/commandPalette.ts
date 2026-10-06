import type {
  Book,
  Course,
  GraphNodeType,
  Note,
  ResourceDestination,
} from '../types/models.ts';
import { practiceWorkKindLabel, practiceWorkStatusLabel } from './practiceWork.ts';
import { resolveArtifactContextDestination } from './domainLogic.ts';

/**
 * Lógica de la paleta de comandos global (Ctrl+K / Cmd+K).
 *
 * Este módulo es PURO: no toca SQLite, no lee el DOM, no accede a la red y no
 * depende de React. Toda la inteligencia de la paleta vive aquí para poder
 * probarse con `node:test` sin navegador.
 *
 * Decisión de diseño: los resultados NO se buscan con SQL en cada pulsación.
 * La paleta construye un catálogo en memoria (acciones, más los cursos, libros
 * y notas que `useAppData` ya tiene en memoria, más un índice plano de lecciones
 * y de conceptos) y filtra localmente. Consecuencias:
 *
 * - Cero peticiones de red y cero consultas por pulsación (Regla 1).
 * - Coincidencia desde el PRIMER carácter, en lugar del mínimo de 2 caracteres
 *   que impone `dao.searchKnowledge` (SQL `LIKE`).
 * - Orden por relevancia real, no el orden alfabético plano del DAO.
 * - Insensible a diacríticos: en español "Introducción" debe encontrar
 *   "Introduccion" aunque el usuario no escriba la tilde.
 * - Busca también en el CUERPO de notas y lecciones, que es donde el usuario
 *   recuerda haber escrito algo. `dao.searchKnowledge` sí lo hacía (SQL `LIKE`
 *   sobre `note.content`); buscar solo en títulos sería una regresión.
 * - Resalta la coincidencia con offsets exactos sobre el texto original.
 * - Red de seguridad difusa por subsecuencia: "itn" encuentra "Introducción".
 */

/** Agrupación visual y semántica de un elemento de la paleta. */
export type PaletteGroup =
  | 'accion'
  | 'curso'
  | 'libro'
  | 'recurso'
  | 'practica'
  | 'leccion'
  | 'nota'
  | 'concepto';

export interface PaletteItem {
  /** Identificador estable y único dentro del catálogo. */
  id: string;
  group: PaletteGroup;
  title: string;
  subtitle?: string;
  /** Tipo de icono a mostrar. `accion` cubre navegación y utilidades. */
  icon: GraphNodeType | 'accion';
  /**
   * Destino de navegación de una ENTIDAD, o `null` cuando el elemento es una
   * ACCIÓN (navegar a una pestaña, repasar, exportar, cambiar tema), que se
   * despacha mediante su propio callback.
   */
  destination: ResourceDestination | null;
  /** Alias y sinónimos adicionales que también deben poder encontrarlo. */
  keywords?: string[];
  /**
   * Texto largo donde también se busca: cuerpo de la nota, contenido de la
   * lección. Es el campo que permite encontrar algo por lo que se escribió, no
   * solo por cómo se tituló.
   */
  body?: string;
  /**
   * Forma normalizada de `body`, rellenada por `buildPaletteCatalog`.
   *
   * Existe para NO renormalizar el cuerpo en cada pulsación: con 30 lecciones
   * largas, renormalizar en cada tecla sería el cuello de botella de la paleta.
   */
  bodyNormalized?: string;
}

/** Fila del índice de lecciones (`dao.getLessonIndex`). */
export interface LessonIndexRow {
  lessonId: string;
  lessonTitle: string;
  lessonContent?: string;
  durationMinutes: number;
  moduleTitle: string;
  courseId: string;
  courseTitle: string;
}

/** Fila del índice de conceptos (`dao.getConceptIndex`). */
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

/** Fila del índice de trabajo práctico (`dao.getPracticeWorkIndex`). */
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
  /** Trabajo práctico del usuario: evidencia que no tiene vista propia. */
  practiceWork: PracticeWorkIndexRow[];
  /** Tarjetas pendientes de repaso, para etiquetar la acción de repaso. */
  pendingReviews: number;
  /** Continuación: siguiente lección pendiente, o null si no hay ninguna. */
  continueTarget: { courseId: string; lessonId: string; courseTitle: string; lessonTitle: string } | null;
  /** true si el tema actual es el oscuro. */
  isDarkTheme: boolean;
}

/* -------------------------------------------------------------------------- */
/* Normalización y ranking                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Normaliza un texto conservando la correspondencia con los índices ORIGINALES.
 *
 * Por qué no basta con normalizar: `"Introducción"` mide 12 caracteres en NFC y
 * 13 en NFD, porque la tilde se descompone en `o` + acento combinante. Cualquier
 * `indexOf` sobre la forma normalizada devuelve offsets que NO corresponden al
 * texto original, y el resaltado parte palabras por la mitad. El colapso de
 * espacios también desplaza.
 *
 * `origin[i]` es el índice, en el texto original, del carácter que produjo
 * `normalized[i]`. Es lo que permite resaltar sin adivinar.
 */
export function normalizeWithMap(text: string): { normalized: string; origin: number[] } {
  if (!text) return { normalized: '', origin: [] };

  let normalized = '';
  const origin: number[] = [];
  let previousWasSpace = false;

  for (let index = 0; index < text.length; index++) {
    // Se normaliza carácter a carácter: un carácter original puede produzir
    // varios normalizados (casos raros como las ligaduras), y todos se mapean
    // al mismo índice de origen.
    const folded = text[index]
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();

    for (const piece of folded) {
      if (/\s/.test(piece)) {
        // Colapsa ristras de espacios y descarta los iniciales.
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

  // Un texto que acaba en espacio no debe dejar una cola que rompa la búsqueda.
  while (normalized.endsWith(' ')) {
    normalized = normalized.slice(0, -1);
    origin.pop();
  }

  return { normalized, origin };
}

/**
 * Normaliza una consulta o un texto para compararlos de forma insensible a
 * mayúsculas, acentos y espacios sobrantes.
 *
 * Delega en `normalizeWithMap` para que la aguja y el pajar usen SIEMPRE la misma
 * transformación: si divergieran, los rangos resaltados quedarían desplazados.
 */
export function normalizePaletteQuery(query: string): string {
  if (!query) return '';
  return normalizeWithMap(query).normalized;
}

/** Puntuaciones por nivel de coincidencia. Mayor es mejor. */
export const PALETTE_SCORE = {
  exact: 1000,
  prefix: 800,
  wordStart: 600,
  substring: 400,
  subtitle: 200,
  keyword: 151,
  keywordPrefix: 150,
  keywordInner: 149,
  /** Coincidencia en el cuerpo: la nota o la lección habla de ello. */
  body: 120,
  /** Difusa por subsecuencia densa: "int" ~ "Introducción". */
  fuzzy: 100,
  fuzzyMid: 90,
  fuzzyLow: 80
} as const;

/**
 * Longitud mínima de la consulta para aceptar coincidencias difusas.
 *
 * Sin este mínimo, cualquier trigrama casaría con media biblioteca y llenaría
 * la lista de basura. Las difusas van además en último lugar, así que solo
 * actúan cuando no hay nada mejor que mostrar.
 */
export const PALETTE_FUZZY_MIN_LENGTH = 3;

/** Caracteres que marcan el principio de una palabra. */
const WORD_SEPARATORS = new Set([' ', '-', ':', '>', ',', '.', '/', '(', '¡']);

/** Nivel del título, quedándose con la MEJOR de todas sus ocurrencias. */
function bestTitleTier(haystack: string, needle: string): number | null {
  if (!haystack || !needle) return null;
  if (haystack === needle) return PALETTE_SCORE.exact;
  if (haystack.startsWith(needle)) return PALETTE_SCORE.prefix;

  let best: number | null = null;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) break;
    // Se recorren TODAS las ocurrencias: con `indexOf` a secas, un término que
    // aparece primero dentro de una palabra y después al principio de otra
    // palabra se clasificaría como `substring` cuando le correspondería
    // `wordStart`.
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
 * Coincidencia difusa por subsecuencia sobre título y subtítulo.
 *
 * Puntúa por DENSIDAD: "int" dentro de "Introducción" cubre casi todo el tramo
 * recorrido y puntúa alto; "itn" cubre uno de cada tres y puntúa bajo. Así la
 * red de seguridad ordena lo relevante por delante de lo meramente posible.
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
 * Puntúa un elemento frente a una consulta YA normalizada.
 * Devuelve `null` cuando el elemento no coincide en absoluto.
 *
 * Los niveles son excluyentes por palabra clave: gana la coincidencia más fuerte
 * disponible y se evalúan en orden. El título manda sobre todo lo demás.
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
/* Resaltado de coincidencias                                                   */
/* -------------------------------------------------------------------------- */

export interface TextRange {
  start: number;
  end: number;
}

/**
 * Localiza todas las ocurrencias CONTIGUAS de la consulta dentro de un texto y
 * devuelve los rangos en índices del TEXTO ORIGINAL, no de su forma normalizada.
 *
 * Solo se resaltan coincidencias contiguas. Las difusas seLocalizan
 * subsecuencia, así que no forman un tramo que se pueda marcar sin inventar
 * caracteres intermedios; se distinguen por aparecer al final de la lista.
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

/** Segmento de texto para pintar, con la marca de si coincide. */
export interface HighlightSegment {
  text: string;
  match: boolean;
}

/**
 * Trocea el texto en segmentos alternos para poder envolver los coincidentes en
 * `<mark>`. Los segmentos se/contienen exactamente el texto de entrada: quien
 * lo pinte nunca debe reescribir el contenido.
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
 * Extrae el fragmento del cuerpo que casó, para responder "¿por qué aparece
 * esto?" en la propia fila. Recorta con contexto a la izquierda y marca el
 * recorte con puntos suspensivos honestos.
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
/* Catálogo                                                                    */
/* -------------------------------------------------------------------------- */

/** Etiqueta humana de cada agrupación, reutilizada por la interfaz. */
export const PALETTE_GROUP_LABELS: Record<PaletteGroup, string> = {
  accion: 'Acciones',
  curso: 'Cursos',
  libro: 'Libros',
  recurso: 'Recursos',
  practica: 'Trabajo práctico',
  leccion: 'Lecciones',
  nota: 'Notas',
  concepto: 'Conceptos'
};

/** Orden fijo de los grupos en la paleta: vista predecible de un vistazo. */
const GROUP_ORDER: PaletteGroup[] = [
  'accion',
  'curso',
  'libro',
  'recurso',
  'practica',
  'leccion',
  'nota',
  'concepto'
];

/**
 * Traduce el identificador de una ACCIÓN de navegación a la pestaña de primer
 * nivel que la aplicación ya expone mediante `handleNavigateTab`.
 *
 * `ResourceDestination` modela el DESTINO DE UNA ENTIDAD (curso, nota,
 * concepto), no una pestaña de la interfaz. Las acciones de navegación
 * necesitan las pestañas de primer nivel, que viven en el estado de `App.tsx`
 * (`currentTab`), así que se despachan por identificador y no por destino.
 *
 * Devuelve `null` para las acciones que no son navegación (continuar, repasar,
 * exportar, cambiar tema, tutor IA, escanear carpeta), que tienen su propio
 * callback.
 */
export function resolveActionTab(actionId: string): string | null {
  switch (actionId) {
    case 'accion:dashboard':
      return 'dashboard';
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

/** Acciones de navegación estáticas. El destino se resuelve por identificador. */
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
 * Tope del cuerpo indexado, en caracteres.
 *
 * El cuerpo se usa para encontrar por contenido, no para leerlo: 4000 caracteres
 * cubren de sobra cualquier término que el usuario recuerde y acota la memoria del
 * catálogo y el coste de normalizar. Es un límite consciente, no un descuido.
 */
export const PALETTE_BODY_MAX_CHARS = 4000;

/**
 * Prepara el par `body` / `bodyNormalized` de un elemento.
 *
 * Normalizar aquí y no en cada pulsación es lo que mantiene la paleta
 * instantánea: el catálogo se construye cuando cambian los datos, no cuando se
 * escribe una letra.
 */
function buildBody(text: string | undefined): { body?: string; bodyNormalized?: string } {
  if (!text) return {};
  const body = text.slice(0, PALETTE_BODY_MAX_CHARS);
  if (!body.trim()) return {};
  return { body, bodyNormalized: normalizeWithMap(body).normalized };
}

/**
 * Construye el catálogo completo de la paleta de forma determinista.
 *
 * Cada colección de entidades se ordena por título y luego por identificador
 * ANTES de añadirla. Así el catálogo no depende del orden de llegada de los
 * datos: dos cargas que devuelven las mismas filas en distinto orden producen
 * exactamente la misma paleta, que es lo que hace comprobable el ranking.
 */
export function buildPaletteCatalog(input: PaletteCatalogInput): PaletteItem[] {
  const items: PaletteItem[] = NAVIGATION_ACTIONS.map(action => ({ ...action }));

  // Cada colección usa SUS propios accesores: las filas de lección y concepto
  // exponen `lessonTitle` / `conceptName`, no `title`.
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

  // Acción contextual: solo aparece cuando hay una lección pendiente real.
  if (input.continueTarget) {
    items.push({
      id: 'accion:continue',
      group: 'accion',
      title: 'Continuar aprendiendo',
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
    title: 'Repasar ahora',
    subtitle:
      input.pendingReviews > 0
        ? `${input.pendingReviews} ${input.pendingReviews === 1 ? 'tarjeta pendiente' : 'tarjetas pendientes'}`
        : 'Sesión de repaso SM-2 y preguntas de práctica',
    icon: 'accion',
    destination: null,
    keywords: ['sm2', 'supermemo', 'flashcards', 'tarjetas', 'repaso', 'practica', 'espaciado']
  });

  items.push({
    id: 'accion:ai',
    group: 'accion',
    title: 'Abrir el Tutor IA',
    subtitle: 'Pregunta sobre tu contenido local',
    icon: 'accion',
    destination: null,
    keywords: ['ia', 'asistente', 'tutor', 'preguntar', 'rag', 'llm']
  });

  items.push({
    id: 'accion:mount-folder',
    group: 'accion',
    title: 'Escanear carpeta local',
    subtitle: 'Asociar vídeos de tu disco a las lecciones',
    icon: 'accion',
    destination: null,
    keywords: ['carpeta', 'disco', 'video', 'medios', 'scan', 'importar', 'fsa']
  });

  items.push({
    id: 'accion:backup',
    group: 'accion',
    title: 'Exportar copia de seguridad',
    subtitle: 'Descarga la base de datos SQLite',
    icon: 'accion',
    destination: null,
    keywords: ['backup', 'respaldo', 'exportar', 'sqlite', 'descargar', 'copia']
  });

  items.push({
    id: 'accion:theme',
    group: 'accion',
    title: input.isDarkTheme ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro',
    subtitle: 'Alternar el tema de la interfaz',
    icon: 'accion',
    destination: null,
    keywords: ['tema', 'claro', 'oscuro', 'carbon', 'crema', 'apariencia', 'dark', 'light']
  });

  for (const course of [...input.courses].sort(byCourse)) {
    items.push({
      id: `curso:${course.id}`,
      group: 'curso',
      title: course.title,
      subtitle: course.description || course.category || 'Curso',
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
      subtitle: book.author || book.description || 'Libro',
      icon: 'book',
      destination: { tab: 'resource', resourceId: book.id },
      keywords: [book.author ?? '', book.category, 'libro', 'leer'],
      // El mismo cuerpo que indexaban los cursos. Un libro con una sinopsis
      // relevante era invisible para el usuario que la buscaba con sus palabras.
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
      // El contenido de la lección es la parte más densa de la biblioteca: sin él,
      // la paleta solo encontraría lecciones por el título.
      ...buildBody(lesson.lessonContent)
    });
  }

  for (const note of [...input.notes].sort(byNote)) {
    const context = note.lesson_id ? 'Nota de lección' : note.resource_id ? 'Nota de recurso' : 'Nota general';
    const body = buildBody(note.content);
    items.push({
      id: `nota:${note.id}`,
      group: 'nota',
      title: note.title,
      // El subtítulo es un RESUMEN corto, no el cuerpo entero: una nota de 4000
      // caracteres en el subtítulo se trunca por CSS pero sigue siendo 4000
      // nodos de texto en el DOM, y ademástaparía el nivel `body`, que existe
      // precisamente para las coincidencias más allá del resumen.
      subtitle: body.body ? body.body.slice(0, 80) : context,
      icon: 'note',
      destination: { tab: 'note', noteId: note.id },
      keywords: [context, 'nota', ...(note.tags || [])],
      ...body
    });
  }

  // Los cursos y los libros ya traen sus propias colecciones; aqui van el resto de
  // `learning_resource`: PDF, EPUB, Markdown y texto que el usuario importo. Antes
  // eran inalcanzables desde Ctrl+K pese a tener busqueda en la Biblioteca, nodo en
  // el grafo y vista propia en ResourceDetail.
  const byResource = byTextThenId<ResourceIndexRow>(r => r.resourceTitle, r => r.resourceId);
  for (const resource of [...input.resources].sort(byResource)) {
    items.push({
      id: `recurso:${resource.resourceId}`,
      group: 'recurso',
      title: resource.resourceTitle,
      subtitle: resource.resourceCategory || 'Recurso importado',
      icon: 'resource',
      destination: { tab: 'resource', resourceId: resource.resourceId },
      keywords: [resource.resourceType, resource.resourceCategory ?? '', 'recurso', 'documento', 'importado'],
      ...buildBody(resource.resourceDescription)
    });
  }

  // Trabajo práctico: evidencia producida por el usuario. Se busca por título y
  // descripción, y su destino es su contexto de origen (recurso, lección o
  // concepto), porque no tiene vista propia. Misma decision que el grafo.
  const byPractice = byTextThenId<PracticeWorkIndexRow>(p => p.practiceTitle, p => p.practiceId);
  for (const work of [...input.practiceWork].sort(byPractice)) {
    const kindLabel = practiceWorkKindLabel(work.practiceKind);
    items.push({
      id: `practica:${work.practiceId}`,
      group: 'practica',
      title: work.practiceTitle,
      subtitle: work.contextTitle
        ? `${kindLabel} · ${work.contextTitle}`
        : `${kindLabel} · ${practiceWorkStatusLabel(work.practiceStatus)}`,
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
      subtitle: concept.conceptDescription || 'Concepto',
      icon: 'concept',
      destination: { tab: 'concept', conceptId: concept.conceptId },
      keywords: ['concepto', 'idea', 'definicion']
      // Sin cuerpo a proposito: la descripcion del concepto YA es su subtitulo, y
      // el nivel `subtitle` puntua por encima de `body`. Indexarla tambien seria
      // guardar dos veces lo mismo para no ganar nada.
    });
  }

  return items;
}

/* -------------------------------------------------------------------------- */
/* Filtrado                                                                    */
/* -------------------------------------------------------------------------- */

/** Límite duro de resultados mostrados. */
export const PALETTE_RESULT_LIMIT = 30;

/**
 * Filtra y ordena el catálogo.
 *
 * Sin consulta devuelve la VISTA POR DEFECTO: acciones primero y después las
 * entidades en su orden estable, de modo que abrir la paleta nunca muestre cientos
 * de elementos de golpe.
 *
 * Con consulta devuelve los resultados ordenados por relevancia. El desempate
 * (título y luego id) es explícito: la misma entrada produce siempre la misma
 * lista, requisito para poder probar el ranking.
 */
export function filterPaletteItems(
  items: PaletteItem[],
  query: string,
  limit: number = PALETTE_RESULT_LIMIT
): PaletteItem[] {
  return matchPaletteItems(items, query, limit).map(match => match.item);
}

/** Una coincidencia, con todo lo que la interfaz necesita para explicarla. */
export interface PaletteMatch {
  item: PaletteItem;
  score: number;
  /** Texto de título realmente mostrado. */
  title: string;
  /** Rangos a resaltar en ese título, en índices del texto original. */
  titleRanges: TextRange[];
  /** Texto de subtítulo realmente mostrado: el contexto, o el fragmento del cuerpo que casó. */
  subtitle: string;
  /** Rangos a resaltar en ese subtítulo. */
  subtitleRanges: TextRange[];
  /** true si lo que casó fue el cuerpo, no el título ni el subtítulo. */
  matchedBody: boolean;
}

/** Umbral a partir del cual se considera que la coincidencia vino del cuerpo. */
const BODY_SCORE_CEILING = PALETTE_SCORE.body;

/**
 * Busca y ORDENA, DEVUELVIENDO el contexto de la coincidencia.
 *
 * Es la función que consume el componente. `filterPaletteItems` es un envoltorio
 * sobre esta para quien solo necesite la lista de elementos.
 *
 * Con consulta vacía devuelve la vista por defecto (acciones primero, sin
 * resaltado). Con consulta devuelve resultados con su resaltado, su fragmento de
 * cuerpo y la marca de si la coincidencia vino del contenido: sin eso, el
 * usuario no puede saber por qué un resultado aparece.
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
    // Si lo que casó fue el cuerpo, el subtítulo se sustituye por el fragmento que
    // coincidió: es la única forma de que el usuario entienda por qué aparece la
    // fila. Si casó el título, se conserva el contexto original.
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
 * Agrupa resultados preservando el orden por relevancia dentro de cada grupo.
 * Los grupos vacíos se omiten y su orden es fijo.
 */
export function groupPaletteItems<T extends PaletteItem | PaletteMatch>(
  items: T[]
): Array<{ group: PaletteGroup; label: string; items: T[] }> {
  // Acepta tanto elementos sueltos como coincidencias completas, para que quien
  // solo necesite la lista no tenga que envolverla y quien necesite el resaltado
  // tampoco tenga que desempaquetarla.
  const groupOf = (entry: T): PaletteGroup => ('item' in entry ? (entry as PaletteMatch).item.group : (entry as PaletteItem).group);

  const result: Array<{ group: PaletteGroup; label: string; items: T[] }> = [];
  for (const group of GROUP_ORDER) {
    const groupItems = items.filter(item => groupOf(item) === group);
    if (groupItems.length) result.push({ group, label: PALETTE_GROUP_LABELS[group], items: groupItems });
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/* Selección por teclado                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Mueve el índice de selección con envoltura en ambos extremos.
 *
 * Es pura y tolera listas vacías porque el resultado se recalcula en cada
 * pulsación de flecha, cuando la lista puede haber cambiado de longitud.
 */
export function movePaletteSelection(current: number, delta: number, length: number): number {
  if (length <= 0) return -1;
  if (!Number.isFinite(current) || current < 0) return delta > 0 ? 0 : length - 1;
  const next = (current + delta) % length;
  return next < 0 ? next + length : next;
}

/* -------------------------------------------------------------------------- */
/* Atajo global                                                                */
/* -------------------------------------------------------------------------- */

/** Forma mínima de un evento de teclado que necesita el detector de atajo. */
export interface PaletteHotkeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * Detecta el atajo de apertura y cierre de la paleta: `Ctrl+K` o `Cmd+K`.
 *
 * Se exige exactamente un modificador (ctrl XOR meta) para no dispararse con los
 * dos a la vez, y se excluyen `alt` y `shift` porque las combinaciones de tres
 * modificadores se reservan al sistema y al navegador.
 *
 * Deliberadamente NO se comprueba el elemento enfocado: `Ctrl+K` es una
 * combinación con modificador y no colisiona con ningún atajo de escritura.
 */
export function isPaletteHotkey(event: PaletteHotkeyEvent): boolean {
  if (!event || typeof event.key !== 'string') return false;
  if (event.key.toLowerCase() !== 'k') return false;
  if (event.altKey || event.shiftKey) return false;
  return (event.ctrlKey ? 1 : 0) + (event.metaKey ? 1 : 0) === 1;
}

/* -------------------------------------------------------------------------- */
/* Navegación                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Callbacks de navegación que la aplicación ya expone para sus vistas. Se
 * declaran aquí para que `navigateToDestination` sea comprobable sin React.
 */
export interface PaletteNavigation {
  openCourse: (courseId: string) => void;
  openLesson: (lessonId: string) => void;
  openNote: (noteId: string) => void;
  openConcept: (conceptId: string) => void;
  openResource: (resourceId: string) => void;
  openLibrary: () => void;
}

/**
 * Ejecuta un `ResourceDestination` contra los handlers de navegación existentes.
 *
 * Cubre las cinco variantes del tipo. El detalle importante es la lección: si el
 * destino trae `lessonId`, se enruta a `openLesson`, que ya resuelve el curso y
 * abre la lección exacta. `Library.tsx` descartaba ese `lessonId` y abría solo el
 * curso; la paleta sí aprovecha el destino completo.
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
    case 'library':
      navigation.openLibrary();
      return;
    default:
      return;
  }
}