/**
 * Metas de aprendizaje: validación, progreso derivado y estados de fecha.
 *
 * Lógica PURA (sin React, sin SQLite, sin red) para poder probarla con
 * `node:test`. Principios que rigen este módulo:
 *
 *  - El progreso NUNCA se persiste: se deriva de los datos reales (curso,
 *    libro, trabajo práctico, sesiones de estudio) en cada lectura.
 *  - Cada tipo de meta mide UNA sola cosa. Los tipos no se mezclan jamás en un
 *    mismo porcentaje (una meta de curso no "avanza" por repasar tarjetas).
 *  - Cuando no hay medida honesta posible (sin recurso, sin total de páginas,
 *    sin objetivo numérico), `measurable` es `false` y el porcentaje es `null`:
 *    la UI debe decirlo, no inventar un 0%.
 */
import type { Book, Course, LearningGoal, GoalKind, PracticeWork } from '../types/models.ts';

/** Etiquetas en español de los tipos de meta. */
export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  course: 'Completar un curso',
  book: 'Terminar un libro',
  practice: 'Completar trabajo práctico',
  study_time: 'Tiempo de estudio',
  custom: 'Meta personalizada'
};

/** Orden estable para poblar selectores. */
export const GOAL_KINDS: GoalKind[] = ['course', 'book', 'practice', 'study_time', 'custom'];

/** Tipos de meta ligados a un recurso concreto (curso o libro). */
export const GOAL_KINDS_REQUIRING_RESOURCE: ReadonlySet<GoalKind> = new Set<GoalKind>(['course', 'book']);

/** Unidades de medida por tipo de meta. La UI nunca las concatena entre sí. */
export type GoalUnit = 'lecciones' | 'páginas' | 'piezas' | 'minutos' | 'ninguna';

const GOAL_UNIT_BY_KIND: Record<GoalKind, GoalUnit> = {
  course: 'lecciones',
  book: 'páginas',
  practice: 'piezas',
  study_time: 'minutos',
  custom: 'ninguna'
};

/* -------------------------------------------------------------------------- */
/* Validación                                                                  */
/* -------------------------------------------------------------------------- */

export interface GoalDraft {
  title: string;
  description?: string | null;
  kind: GoalKind;
  resource_id?: string | null;
  target_value?: number | null;
  target_date?: string | null;
}

export interface GoalValidation {
  ok: boolean;
  /** Mensaje accionable en español; solo presente cuando `ok` es false. */
  error?: string;
}

/** `YYYY-MM-DD` o ISO con hora. Se acepta también `YYYY-MM-DD HH:MM:SS`. */
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/** Normaliza una fecha a `YYYY-MM-DD`; devuelve null si no es interpretable. */
export function normalizeGoalDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!DAY_PATTERN.test(trimmed)) return null;
  const day = trimmed.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  if (parsed.toISOString().slice(0, 10) !== day) return null;
  return day;
}

/**
 * Valida un borrador de meta antes de escribir en SQLite.
 *
 * Reglas:
 *  1. Título obligatorio.
 *  2. Curso/libro exigen recurso enlazado (sin él no hay nada que medir).
 *  3. El objetivo numérico, si existe, debe ser finito y mayor que cero.
 *  4. Tiempo de estudio exige objetivo en minutos (si no, no hay progreso).
 *  5. La fecha objetivo, si existe, debe ser una fecha real.
 *  6. Nunca se aceptan URLs `blob:` en la descripción (no son referencias).
 */
export function validateGoalDraft(draft: GoalDraft): GoalValidation {
  if (!draft.title || !draft.title.trim()) {
    return { ok: false, error: 'La meta necesita un título.' };
  }

  if (GOAL_KINDS_REQUIRING_RESOURCE.has(draft.kind) && !draft.resource_id) {
    return { ok: false, error: 'Selecciona el recurso al que se vincula esta meta.' };
  }

  if (draft.target_value !== undefined && draft.target_value !== null) {
    const value = draft.target_value;
    if (!Number.isFinite(value) || value <= 0) {
      return { ok: false, error: 'El valor objetivo debe ser un número mayor que cero.' };
    }
  }

  if (draft.kind === 'study_time' && !(typeof draft.target_value === 'number' && draft.target_value > 0)) {
    return { ok: false, error: 'Define los minutos objetivo de la meta de estudio.' };
  }

  if (draft.target_date !== undefined && draft.target_date !== null && draft.target_date !== '') {
    if (!normalizeGoalDate(draft.target_date)) {
      return { ok: false, error: 'La fecha objetivo no es una fecha válida.' };
    }
  }

  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Progreso derivado                                                           */
/* -------------------------------------------------------------------------- */

/** Curso mínimo necesario para medir una meta (contadores ya calculados). */
export interface GoalCourseContext {
  title: string;
  total_lessons: number;
  completed_lessons: number;
}

/** Libro mínimo necesario para medir una meta. */
export interface GoalBookContext {
  title: string;
  page_count?: number | null;
  current_page?: number | null;
  reading_percentage?: number | null;
}

export interface GoalProgressContext {
  courses: ReadonlyMap<string, GoalCourseContext>;
  books: ReadonlyMap<string, GoalBookContext>;
  practice: readonly PracticeWork[];
  /**
   * Minutos de estudio registrados desde la creación de cada meta, por id de
   * meta. Se inyecta desde el DAO para no acoplar este módulo a SQLite.
   */
  studyMinutesByGoal: ReadonlyMap<string, number>;
}

export interface GoalProgress {
  /** true solo cuando existe una medida honesta y completa del avance. */
  measurable: boolean;
  /** Valor actual medido (null cuando no es medible). */
  current: number | null;
  /** Valor objetivo (null cuando la meta no lo define). */
  target: number | null;
  /** Porcentaje 0..100 redondeado (null cuando no es medible). */
  percent: number | null;
  unit: GoalUnit;
  /** Explicación honesta de QUÉ se mide. La UI la muestra siempre. */
  basis: string;
  /** true si el recurso enlazado ya no existe (borrado por el usuario). */
  missingResource: boolean;
  /** true si la medida alcanza o supera el objetivo. */
  reachedTarget: boolean;
}

function unmeasurable(unit: GoalUnit, basis: string, missingResource = false): GoalProgress {
  return {
    measurable: false,
    current: null,
    target: null,
    percent: null,
    unit,
    basis,
    missingResource,
    reachedTarget: false
  };
}

function measured(
  unit: GoalUnit,
  basis: string,
  current: number,
  target: number | null,
  missingResource = false
): GoalProgress {
  const percent = target !== null && target > 0
    ? Math.max(0, Math.min(100, Math.round((current / target) * 100)))
    : null;
  return {
    measurable: true,
    current,
    target,
    percent,
    unit,
    basis,
    missingResource,
    reachedTarget: target !== null && target > 0 && current >= target
  };
}

/**
 * Deriva el progreso de una meta desde datos reales.
 *
 * Casos borde documentados (todos prueban en tests):
 *  - Curso sin lecciones → no medible (no se divide entre cero).
 *  - Libro sin número de páginas → no medible.
 *  - Recurso enlazado borrado → `missingResource`, no medible.
 *  - Práctica sin objetivo ni piezas registradas → no medible.
 *  - Meta personalizada → nunca medible: se completa manualmente.
 */
export function computeGoalProgress(goal: LearningGoal, context: GoalProgressContext): GoalProgress {
  const unit = GOAL_UNIT_BY_KIND[goal.kind] ?? 'ninguna';

  switch (goal.kind) {
    case 'course': {
      if (!goal.resource_id) return unmeasurable(unit, 'Sin recurso enlazado.');
      const course = context.courses.get(goal.resource_id);
      if (!course) return unmeasurable(unit, 'El curso enlazado ya no existe.', true);
      if (!course.total_lessons || course.total_lessons <= 0) {
        return unmeasurable(unit, 'El curso no tiene lecciones registradas.');
      }
      return measured(
        unit,
        `Lecciones completadas del curso «${course.title}».`,
        course.completed_lessons,
        course.total_lessons
      );
    }

    case 'book': {
      if (!goal.resource_id) return unmeasurable(unit, 'Sin recurso enlazado.');
      const book = context.books.get(goal.resource_id);
      if (!book) return unmeasurable(unit, 'El libro enlazado ya no existe.', true);
      const pageCount = book.page_count ?? null;
      if (!pageCount || pageCount <= 0) return unmeasurable(unit, 'El libro no tiene número de páginas.');
      const current = Math.max(0, book.current_page ?? 0);
      return measured(unit, `Páginas leídas del libro «${book.title}».`, current, pageCount);
    }

    case 'practice': {
      const scope = goal.resource_id
        ? context.practice.filter((item) => item.resource_id === goal.resource_id)
        : [...context.practice];
      const done = scope.filter((item) => item.status === 'DONE').length;
      const explicitTarget = typeof goal.target_value === 'number' && goal.target_value > 0
        ? goal.target_value
        : null;
      const target = explicitTarget ?? scope.length;

      if (target <= 0) {
        return unmeasurable(
          unit,
          goal.resource_id
            ? 'No hay trabajo práctico registrado con este recurso.'
            : 'No hay trabajo práctico registrado todavía.'
        );
      }
      return measured(
        unit,
        explicitTarget
          ? 'Trabajos prácticos terminados frente a tu objetivo.'
          : 'Trabajos prácticos terminados sobre los registrados (tu objetivo es terminarlos todos).',
        done,
        target
      );
    }

    case 'study_time': {
      const target = typeof goal.target_value === 'number' && goal.target_value > 0 ? goal.target_value : null;
      if (target === null) return unmeasurable(unit, 'Sin objetivo de minutos definido.');
      const current = Math.max(0, context.studyMinutesByGoal.get(goal.id) ?? 0);
      return measured(unit, 'Minutos de estudio registrados desde que creaste la meta.', current, target);
    }

    case 'custom':
    default:
      return unmeasurable('ninguna', 'Meta sin medida automática: se completa manualmente.');
  }
}

/* -------------------------------------------------------------------------- */
/* Fecha objetivo                                                              */
/* -------------------------------------------------------------------------- */

export type GoalDeadlineState = 'completed' | 'overdue' | 'due_soon' | 'upcoming' | 'no_deadline';

/** Días dentro de los cuales una meta se considera "por vencer". */
export const GOAL_DUE_SOON_DAYS = 7;

export const GOAL_DEADLINE_LABELS: Record<GoalDeadlineState, string> = {
  completed: 'Completada',
  overdue: 'Vencida',
  due_soon: 'Por vencer',
  upcoming: 'Próxima',
  no_deadline: 'Sin fecha'
};

/**
 * Clasifica la fecha objetivo de una meta respecto a `today` (`YYYY-MM-DD`).
 *
 * Estados:
 *  - completed: la meta está completada (la fecha deja de ser relevante).
 *  - overdue: la fecha ya pasó. Sin dramatismo: es información, no un castigo.
 *  - due_soon: quedan 0..7 días.
 *  - upcoming: quedan más de 7 días.
 *  - no_deadline: sin fecha o fecha ilegible (se reporta honestamente).
 */
export function classifyGoalDeadline(
  goal: Pick<LearningGoal, 'status' | 'target_date'>,
  today: string
): GoalDeadlineState {
  if (goal.status === 'completed') return 'completed';
  const due = normalizeGoalDate(goal.target_date);
  if (!due) return 'no_deadline';

  const diff = diffDays(today, due);
  if (Number.isNaN(diff)) return 'no_deadline';
  if (diff < 0) return 'overdue';
  if (diff <= GOAL_DUE_SOON_DAYS) return 'due_soon';
  return 'upcoming';
}

/** Días entre dos fechas `YYYY-MM-DD` (positivo si `to` es posterior). */
export function diffDays(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Resumen                                                                     */
/* -------------------------------------------------------------------------- */

export interface GoalSummary {
  total: number;
  active: number;
  completed: number;
  overdue: number;
  dueSoon: number;
  /** Metas activas cuya medida ya alcanza el objetivo (listas para cerrar). */
  readyToComplete: number;
}

/**
 * Resumen determinista para tarjetas de estado. Solo agrega estados y medidas
 * ya calculados: no introduce ninguna métrica nueva.
 */
export function summarizeGoals(
  goals: readonly LearningGoal[],
  progressOf: (goal: LearningGoal) => GoalProgress,
  today: string
): GoalSummary {
  const summary: GoalSummary = {
    total: goals.length,
    active: 0,
    completed: 0,
    overdue: 0,
    dueSoon: 0,
    readyToComplete: 0
  };

  for (const goal of goals) {
    if (goal.status === 'completed') {
      summary.completed += 1;
      continue;
    }
    summary.active += 1;
    const deadline = classifyGoalDeadline(goal, today);
    if (deadline === 'overdue') summary.overdue += 1;
    if (deadline === 'due_soon') summary.dueSoon += 1;
    const progress = progressOf(goal);
    if (progress.reachedTarget) summary.readyToComplete += 1;
  }

  return summary;
}

/** Cursos mínimos para el contexto de medición (desde las filas en memoria). */
export function buildGoalContextCourses(courses: readonly Course[]): Map<string, GoalCourseContext> {
  const map = new Map<string, GoalCourseContext>();
  for (const course of courses) {
    map.set(course.id, {
      title: course.title,
      total_lessons: course.total_lessons ?? 0,
      completed_lessons: course.completed_lessons ?? 0
    });
  }
  return map;
}

/** Libros mínimos para el contexto de medición. */
export function buildGoalContextBooks(books: readonly Book[]): Map<string, GoalBookContext> {
  const map = new Map<string, GoalBookContext>();
  for (const book of books) {
    map.set(book.id, {
      title: book.title,
      page_count: book.page_count ?? null,
      current_page: book.current_page ?? null,
      reading_percentage: book.reading_percentage ?? null
    });
  }
  return map;
}
