/**
 * Study-session scope: SINGLE canonical domain rule.
 *
 * CrossedArts has THREE session scopes, all legitimate and explicit:
 *
 *  - `lesson`   — session bound to one lesson. `lesson_id` required;
 *                  `resource_id` optional (the course may or may not resolve).
 *  - `resource` — session bound to a resource (course or book). `resource_id`
 *                  required and `lesson_id` null: not a lesson session.
 *  - `global`   — cross-library review (due cards with no resource or lesson
 *                  selected). NOT a "scopeless" session: an explicit
 *                  first-class scope, persisted and presented as such.
 *
 * Invariant: scope DERIVES from the present anchors and is never inferred from
 * missing data. On write, the DAO checks the declared scope against its
 * anchors, and the store rejects domain violations or anchored `global` scopes.
 *
 * Honest reclassification: `ON DELETE SET NULL` may unlink the lesson from an
 * ALREADY FINISHED lesson session (history is preserved). The effective scope
 * then re-derives from the remaining anchors
 * (`resolveEffectiveStudySessionScope`), so the UI never shows "Lesson" for a
 * session whose lesson can no longer be opened.
 */

/** The three canonical study-session scopes. */
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import { daoLang } from '../db/daoLanguage.ts';

export type StudySessionScope = 'global' | 'resource' | 'lesson';

/** Ordered set of valid scopes (for validation and the UI). */
export const STUDY_SESSION_SCOPES: readonly StudySessionScope[] = ['global', 'resource', 'lesson'] as const;

export interface StudySessionScopeInput {
  resourceId?: string | null;
  lessonId?: string | null;
}

/**
 * Derives scope from the present anchors. Deterministic: the lesson is the
 * most specific scope and outranks the resource.
 */
export function resolveStudySessionScope(input: StudySessionScopeInput): StudySessionScope {
  if (input.lessonId) return 'lesson';
  if (input.resourceId) return 'resource';
  return 'global';
}

/**
 * EFFECTIVE scope of an already persisted session.
 *
 * Takes the declared scope plus the anchors actually present. When the declared
 * scope is no longer representable (its anchor vanished with deleted material,
 * which is kept out of history preservation), returns the scope derived from
 * the remaining anchors. Deterministic, no title guessing.
 */
export function resolveEffectiveStudySessionScope(
  declaredScope: StudySessionScope | undefined,
  input: StudySessionScopeInput
): StudySessionScope {
  const derived = resolveStudySessionScope(input);
  if (!declaredScope) return derived;
  if (declaredScope === 'lesson' && !input.lessonId) return derived;
  if (declaredScope === 'resource' && !input.resourceId) return derived;
  if (declaredScope === 'global' && (input.resourceId || input.lessonId)) return derived;
  return declaredScope;
}

/** True for the global scope (cross-cutting review) when no anchor exists. */
export function isGlobalStudySessionScope(scope: StudySessionScope): boolean {
  return scope === 'global';
}

export interface StudySessionScopeConsistency {
  ok: boolean;
  error?: string;
}

/**
 * Checks a declared scope for consistency with its anchors.
 *
 * Rules:
 *  - `global`   -> must NOT carry resource or lesson.
 *  - `resource` -> MUST carry a resource and must NOT carry a lesson.
 *  - `lesson`   -> MUST carry a lesson; the resource is optional.
 */
export function validateStudySessionScope(
  scope: StudySessionScope,
  input: StudySessionScopeInput,
  lang: LanguageCode = 'es'
): StudySessionScopeConsistency {
  const hasResource = Boolean(input.resourceId);
  const hasLesson = Boolean(input.lessonId);

  if (scope === 'global') {
    if (hasResource || hasLesson) {
      return {
        ok: false,
        error: translateKey(lang, 'scope.globalLeak')
      };
    }
    return { ok: true };
  }

  if (scope === 'resource') {
    if (!hasResource) {
      return { ok: false, error: translateKey(lang, 'scope.needResource') };
    }
    if (hasLesson) {
      return {
        ok: false,
        error: translateKey(lang, 'scope.noLesson')
      };
    }
    return { ok: true };
  }

  if (!hasLesson) {
    return { ok: false, error: translateKey(lang, 'scope.needLesson') };
  }
  return { ok: true };
}

/** Localized scope label. Never empty: an unknown scope falls back to global. */
export function studySessionScopeLabel(scope: StudySessionScope, lang: LanguageCode = 'es'): string {
  switch (scope) {
    case 'lesson':
      return translateKey(lang, 'scope.lesson');
    case 'resource':
      return translateKey(lang, 'scope.resource');
    case 'global':
    default:
      return translateKey(lang, 'scope.global');
  }
}

export interface StudySessionScopeDescriptionInput {
  scope: StudySessionScope;
  resourceTitle?: string | null;
  lessonTitle?: string | null;
}

/**
 * Readable session description from scope plus resolved titles. Never invents
 * titles: without a known title it describes the scope.
 */
export function describeStudySessionScope(input: StudySessionScopeDescriptionInput, lang: LanguageCode = 'es'): string {
  const { scope, resourceTitle, lessonTitle } = input;
  if (scope === 'lesson') {
    const parts = [resourceTitle, lessonTitle].filter(Boolean);
    return parts.length ? parts.join(' › ') : studySessionScopeLabel(scope, lang);
  }
  if (scope === 'resource') {
    return resourceTitle || studySessionScopeLabel(scope, lang);
  }
  return studySessionScopeLabel(scope, lang);
}