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
  // The real id of the "Today" view across the app is `focus` (Shell,
  // Dashboard, and the command palette). `today` was an early alias: accepted
  // for compatibility but ALWAYS normalized to `focus`, so `#tab=today` never
  // renders an empty view or breaks saved links.
  'focus',
  'analytics',
  'goals',
  'settings',
]);

/** Historic `tab` aliases -> canonical id rendered by the app. */
const TAB_ALIASES: Record<string, string> = { today: 'focus' };

/**
 * Parses navigable state from the URL (hash or searchParams). Supports both
 * hash (#tab=course_detail&courseId=123) and search (?tab=...) formats. Hash
 * wins because it is fully safe for static SPAs on GitHub Pages.
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
