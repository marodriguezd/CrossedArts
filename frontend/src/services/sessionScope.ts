/**
 * Ámbito de una sesión de estudio: regla de dominio ÚNICA y canónica.
 *
 * CrossedArts tiene TRES ámbitos de sesión, todos legítimos y explícitos:
 *
 *  - `lesson`   — sesión acotada a una lección. `lesson_id` obligatorio;
 *                  `resource_id` es opcional (el curso puede estar o no resuelto).
 *  - `resource` — sesión acotada a un recurso (curso o libro). `resource_id`
 *                  obligatorio y `lesson_id` nulo: no es una sesión de lección.
 *  - `global`   — repaso transversal de la biblioteca (repaso de tarjetas
 *                  pendientes sin recurso ni lección seleccionados). NO es una
 *                  sesión "sin ámbito": es un ámbito explícito y de primera clase,
 *                  y así se persiste y se presenta.
 *
 * Invariante: el ámbito se DERIVA de los anclas presentes y nunca se infiere de
 * la ausencia de datos. Al escribir, el DAO valida que el ámbito declarado sea
 * coherente con sus anclas y la base rechaza los casos que rompen el dominio de
 * valores o que dan ancla a un ámbito `global`.
 *
 * Reclasificación honesta: `ON DELETE SET NULL` puede desvincular la lección de
 * una sesión de lección YA TERMINADA (el historial no se destruye). En ese caso
 * el ámbito efectivo se vuelve a derivar de las anclas que quedan
 * (`resolveEffectiveStudySessionScope`), de modo que la interfaz nunca muestra
 * "Lección" para una sesión a la que ya no se le puede abrir una lección.
 */

/** Los tres ámbitos canónicos de una sesión de estudio. */
export type StudySessionScope = 'global' | 'resource' | 'lesson';

/** Conjunto ordenado de ámbitos válidos (para validación y para la UI). */
export const STUDY_SESSION_SCOPES: readonly StudySessionScope[] = ['global', 'resource', 'lesson'] as const;

export interface StudySessionScopeInput {
  resourceId?: string | null;
  lessonId?: string | null;
}

/**
 * Deriva el ámbito a partir de las anclas presentes. Determinista:
 * la lección es el ámbito más específico y manda sobre el recurso.
 */
export function resolveStudySessionScope(input: StudySessionScopeInput): StudySessionScope {
  if (input.lessonId) return 'lesson';
  if (input.resourceId) return 'resource';
  return 'global';
}

/**
 * Ámbito EFECTIVO de una sesión ya persistida.
 *
 * Acepta el ámbito declarado y las anclas realmente presentes. Si el ámbito
 * declarado ya no es representable (su ancla desapareció al borrar el material,
 * que no se destruye por conservar el historial), se devuelve el ámbito derivado
 * de las anclas restantes. Determinista y sin adivinar títulos.
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

/** Es el ámbito global (repaso transversal) cuando no hay ninguna ancla. */
export function isGlobalStudySessionScope(scope: StudySessionScope): boolean {
  return scope === 'global';
}

export interface StudySessionScopeConsistency {
  ok: boolean;
  error?: string;
}

/**
 * Comprueba que un ámbito declarado sea coherente con sus anclas.
 *
 * Reglas:
 *  - `global`  -> NO puede tener recurso ni lección.
 *  - `resource`-> DEBE tener recurso y NO puede tener lección.
 *  - `lesson`  -> DEBE tener lección; el recurso es opcional.
 */
export function validateStudySessionScope(
  scope: StudySessionScope,
  input: StudySessionScopeInput
): StudySessionScopeConsistency {
  const hasResource = Boolean(input.resourceId);
  const hasLesson = Boolean(input.lessonId);

  if (scope === 'global') {
    if (hasResource || hasLesson) {
      return {
        ok: false,
        error: 'Una sesión global no puede tener recurso ni lección: elige el ámbito resource o lesson.'
      };
    }
    return { ok: true };
  }

  if (scope === 'resource') {
    if (!hasResource) {
      return { ok: false, error: 'Una sesión de recurso necesita un resource_id.' };
    }
    if (hasLesson) {
      return {
        ok: false,
        error: 'Una sesión de recurso no puede tener lección: usa el ámbito lesson.'
      };
    }
    return { ok: true };
  }

  if (!hasLesson) {
    return { ok: false, error: 'Una sesión de lección necesita un lesson_id.' };
  }
  return { ok: true };
}

/** Etiqueta en español del ámbito. Nunca vacía: un ámbito desconocido degrada a global. */
export function studySessionScopeLabel(scope: StudySessionScope): string {
  switch (scope) {
    case 'lesson':
      return 'Lección';
    case 'resource':
      return 'Recurso';
    case 'global':
    default:
      return 'Repaso general';
  }
}

export interface StudySessionScopeDescriptionInput {
  scope: StudySessionScope;
  resourceTitle?: string | null;
  lessonTitle?: string | null;
}

/**
 * Descripción legible de una sesión a partir de su ámbito y sus títulos
 * resueltos. No inventa títulos: sin título conocido describe el ámbito.
 */
export function describeStudySessionScope(input: StudySessionScopeDescriptionInput): string {
  const { scope, resourceTitle, lessonTitle } = input;
  if (scope === 'lesson') {
    const parts = [resourceTitle, lessonTitle].filter(Boolean);
    return parts.length ? parts.join(' › ') : studySessionScopeLabel(scope);
  }
  if (scope === 'resource') {
    return resourceTitle || studySessionScopeLabel(scope);
  }
  return studySessionScopeLabel(scope);
}