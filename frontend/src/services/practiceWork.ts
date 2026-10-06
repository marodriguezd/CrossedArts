/**
 * Trabajo práctico: etiquetas, validación y resumen.
 *
 * Lógica pura y agnóstica al dominio (sin React, sin SQLite) para poder probarla
 * con node:test. La interfaz y el DAO solo la consumen.
 */
import type { PracticeWork, PracticeWorkKind, PracticeWorkStatus } from '../types/models.ts';

/** Etiquetas en español de los tipos de artefacto. */
export const PRACTICE_WORK_KIND_LABELS: Record<PracticeWorkKind, string> = {
  exercise: 'Ejercicio',
  project: 'Proyecto',
  essay: 'Ensayo',
  drawing: 'Dibujo',
  code: 'Código',
  other: 'Otro'
};

/** Orden estable para poblar selectores (nunca depende del orden de un objeto). */
export const PRACTICE_WORK_KINDS: PracticeWorkKind[] = [
  'exercise',
  'project',
  'essay',
  'drawing',
  'code',
  'other'
];

export const PRACTICE_WORK_STATUS_LABELS: Record<
  PracticeWorkStatus,
  { text: string; tone: 'neutral' | 'accent' | 'success' }
> = {
  PLANNED: { text: 'Planificado', tone: 'neutral' },
  IN_PROGRESS: { text: 'En marcha', tone: 'accent' },
  DONE: { text: 'Terminado', tone: 'success' }
};

export const PRACTICE_WORK_STATUSES: PracticeWorkStatus[] = ['PLANNED', 'IN_PROGRESS', 'DONE'];

/** Ciclo determinista del estado al pulsar el botón de avance. */
export function nextPracticeWorkStatus(status: PracticeWorkStatus): PracticeWorkStatus {
  if (status === 'PLANNED') return 'IN_PROGRESS';
  if (status === 'IN_PROGRESS') return 'DONE';
  return 'PLANNED';
}

export interface PracticeWorkDraft {
  title: string;
  kind?: PracticeWorkKind;
  status?: PracticeWorkStatus;
  description?: string;
  notes?: string;
  /** Vinculación del artefacto con el aprendizaje. */
  resource_id?: string | null;
  lesson_id?: string | null;
  concept_id?: string | null;
  self_rating?: number | null;
}

export interface PracticeWorkValidation {
  ok: boolean;
  /** Mensaje accionable en español; solo presente cuando `ok` es false. */
  error?: string;
}

/**
 * Valida un borrador antes de escribir en SQLite.
 *
 * Reglas:
 *  1. El título no puede estar vacío (es lo único que el usuario ve en la lista).
 *  2. El trabajo debe estar LIGADO al aprendizaje: al menos un recurso, lección
 *     o concepto. Un artefacto huérfano no se puede explorar ni repasar.
 *  3. La autoevaluación, si existe, va de 0 a 5 (misma escala que SM-2).
 *  4. Nunca se aceptan URLs `blob:` como artefacto persistido.
 */
export function validatePracticeWorkDraft(draft: PracticeWorkDraft): PracticeWorkValidation {
  if (!draft.title || !draft.title.trim()) {
    return { ok: false, error: 'El trabajo práctico necesita un título.' };
  }

  const linked = Boolean(draft.resource_id || draft.lesson_id || draft.concept_id);
  if (!linked) {
    return {
      ok: false,
      error: 'Vincula el trabajo a un recurso, una lección o un concepto para poder encontrarlo después.'
    };
  }

  if (draft.self_rating !== undefined && draft.self_rating !== null) {
    const rating = draft.self_rating;
    if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
      return { ok: false, error: 'La autoevaluación debe estar entre 0 y 5.' };
    }
  }

  const artifact = (draft as { artifact_url?: string | null }).artifact_url;
  if (artifact && artifact.startsWith('blob:')) {
    return { ok: false, error: 'No se pueden guardar URLs temporales (blob:) como artefacto.' };
  }

  return { ok: true };
}

export interface PracticeWorkSummary {
  total: number;
  done: number;
  inProgress: number;
  planned: number;
  completionPercent: number;
}

/** Resumen por estado. Nunca divide por cero ni inventa progreso. */
export function summarizePracticeWork(items: readonly PracticeWork[]): PracticeWorkSummary {
  const done = items.filter((item) => item.status === 'DONE').length;
  const inProgress = items.filter((item) => item.status === 'IN_PROGRESS').length;
  const planned = items.filter((item) => item.status === 'PLANNED').length;
  return {
    total: items.length,
    done,
    inProgress,
    planned,
    completionPercent: items.length > 0 ? Math.round((done / items.length) * 100) : 0
  };
}

/** Etiqueta legible del tipo, con degradación segura ante valores desconocidos. */
export function practiceWorkKindLabel(kind?: string): string {
  if (kind && kind in PRACTICE_WORK_KIND_LABELS) {
    return PRACTICE_WORK_KIND_LABELS[kind as PracticeWorkKind];
  }
  return PRACTICE_WORK_KIND_LABELS.other;
}

/** Etiqueta legible del estado, con degradación segura ante valores desconocidos. */
export function practiceWorkStatusLabel(status?: string): string {
  if (status && status in PRACTICE_WORK_STATUS_LABELS) {
    return PRACTICE_WORK_STATUS_LABELS[status as PracticeWorkStatus].text;
  }
  return PRACTICE_WORK_STATUS_LABELS.PLANNED.text;
}
