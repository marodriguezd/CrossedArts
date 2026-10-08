export interface AppUrlState {
  tab: string;
  courseId?: string | null;
  lessonId?: string | null;
  resourceId?: string | null;
  noteId?: string | null;
  goalId?: string | null;
  studyResourceId?: string | null;
  studyLessonId?: string | null;
  studyMode?: 'flashcards' | 'practice' | 'mixed' | null;
}

const VALID_TABS = new Set([
  'dashboard',
  'library',
  'course_detail',
  'resource_detail',
  'review',
  'graph',
  'notes',
  // El identificador real de la vista «Hoy» en el resto de la app es `focus`
  // (Shell, Dashboard y la paleta de comandos). `today` fue un alias temprano:
  // se acepta por compatibilidad, pero SIEMPRE se normaliza a `focus`, de modo
  // que `#tab=today` no renderiza una vista vacía ni rompe los enlaces guardados.
  'focus',
  'analytics',
  'goals',
  'settings',
]);

/** Alias históricos de `tab` → identificador canónico renderizado por la app. */
const TAB_ALIASES: Record<string, string> = { today: 'focus' };

/**
 * Parsea el estado navegable desde la URL (hash o searchParams).
 * Soporta tanto formato hash (#tab=course_detail&courseId=123) como search (?tab=...).
 * Da prioridad a hash por ser completamente seguro para SPAs estáticas en GitHub Pages.
 */
export function parseUrlState(hashOrSearch: string): AppUrlState {
  const raw = hashOrSearch.startsWith('#') || hashOrSearch.startsWith('?')
    ? hashOrSearch.slice(1)
    : hashOrSearch;

  const params = new URLSearchParams(raw);
  const tabParam = params.get('tab') || 'dashboard';
  const canonicalTab = TAB_ALIASES[tabParam] ?? tabParam;
  const tab = VALID_TABS.has(canonicalTab) ? canonicalTab : 'dashboard';

  const courseId = params.get('courseId') || params.get('course_id') || null;
  const lessonId = params.get('lessonId') || params.get('lesson_id') || null;
  const resourceId = params.get('resourceId') || params.get('resource_id') || null;
  const noteId = params.get('noteId') || params.get('note_id') || null;
  const goalId = params.get('goalId') || params.get('goal_id') || null;
  const studyResourceId = params.get('studyResourceId') || null;
  const studyLessonId = params.get('studyLessonId') || null;
  const modeParam = params.get('studyMode');
  const studyMode = modeParam === 'flashcards' || modeParam === 'practice' || modeParam === 'mixed' ? modeParam : null;

  return {
    tab,
    courseId,
    lessonId,
    resourceId,
    noteId,
    goalId,
    studyResourceId,
    studyLessonId,
    studyMode,
  };
}

/**
 * Serializa el estado navegable de la aplicación a una cadena hash/search.
 */
export function serializeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();
  if (state.tab && state.tab !== 'dashboard') {
    params.set('tab', state.tab);
  }

  if (state.courseId) params.set('courseId', state.courseId);
  if (state.lessonId) params.set('lessonId', state.lessonId);
  if (state.resourceId) params.set('resourceId', state.resourceId);
  if (state.noteId) params.set('noteId', state.noteId);
  if (state.goalId) params.set('goalId', state.goalId);
  if (state.studyResourceId) params.set('studyResourceId', state.studyResourceId);
  if (state.studyLessonId) params.set('studyLessonId', state.studyLessonId);
  if (state.studyMode) params.set('studyMode', state.studyMode);

  const qs = params.toString();
  return qs ? `#${qs}` : '';
}
