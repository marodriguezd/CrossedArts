/**
 * Practice work: labels, validation, and summary. Pure domain-agnostic logic
 * (no React, no SQLite) for node:test coverage. The UI and DAO only consume it.
 */
import type { PracticeChecklistItem, PracticeWork, PracticeWorkKind, PracticeWorkStatus } from '../types/models.ts';
import { computeContentHash } from '../lib/localEmbeddings/chunking.ts';

/** Localized artifact-kind labels. Defaults to Spanish. */
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
export const PRACTICE_WORK_KIND_LABELS: Record<PracticeWorkKind, string> = {
  exercise: 'Ejercicio',
  project: 'Proyecto',
  essay: 'Ensayo',
  drawing: 'Dibujo',
  code: 'Código',
  other: 'Otro'
};

/** Stable order for populating selectors (never object-key order). */
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

/** Deterministic status cycle for the advance button. */
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
  /** Artifact-to-learning linkage. */
  resource_id?: string | null;
  lesson_id?: string | null;
  concept_id?: string | null;
  self_rating?: number | null;
  /** Markdown work content (workspace). */
  content?: string | null;
  /** Workspace checklist. */
  checklist?: PracticeChecklistItem[] | null;
}

export interface PracticeWorkValidation {
  ok: boolean;
  /** Actionable localized message; present only when `ok` is false. */
  error?: string;
}

/**
 * Validates a draft before writing to SQLite. Rules: 1. Title is required
 * (the only thing users see in lists). 2. Work must LINK to learning: at
 * least one resource, lesson, or concept. Orphan artifacts cannot be explored
 * or reviewed. 3. Self-ratings, when present, run 0-5 (same scale as SM-2).
 * 4. `blob:` URLs are never accepted as persisted artifacts.
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

  // Workspace: the checklist must stay usable.
  if (draft.checklist !== undefined && draft.checklist !== null) {
    if (!Array.isArray(draft.checklist)) {
      return { ok: false, error: 'La lista de verificación no tiene un formato válido.' };
    }
    if (draft.checklist.length > MAX_CHECKLIST_ITEMS) {
      return { ok: false, error: `La lista de verificación no puede superar ${MAX_CHECKLIST_ITEMS} elementos.` };
    }
    for (const item of draft.checklist) {
      if (!item || typeof item.text !== 'string' || !item.text.trim()) {
        return { ok: false, error: 'Los elementos de la lista deben tener texto.' };
      }
    }
  }

  if (draft.content !== undefined && draft.content !== null && typeof draft.content !== 'string') {
    return { ok: false, error: 'El contenido del espacio de trabajo no es texto válido.' };
  }

  return { ok: true };
}

/** Max checklist items per practice-work entry. */
export const MAX_CHECKLIST_ITEMS = 100;

/**
 * DETERMINISTIC id for a checklist item without an explicit id. It used to
 * synthesize with `Math.random()`, so two reads of the same persisted text
 * produced different ids: item identity was unstable, React re-rendered, and
 * any id-based dedup was useless.
 *
 * The id derives from CONTENT and POSITION (global index in the original
 * array), so parsing the same input twice yields exactly the same logical items.
 */
export function deterministicChecklistItemId(text: string, index: number): string {
  return `chk_${index}_${computeContentHash(text)}`;
}

/**
 * Deterministic id for a NEW UI-added item. No clock or randomness: derived
 * from position and text, disambiguated with an incremental suffix only when
 * the id already exists (repeated text). Two users typing the same list get
 * the same ids, and reparsing the persisted list keeps them.
 */
export function nextChecklistItemId(existing: readonly PracticeChecklistItem[], text: string): string {
  const taken = new Set(existing.map(item => item.id));
  const index = existing.length;
  const base = deterministicChecklistItemId(text, index);
  if (!taken.has(base)) return base;

  let suffix = 2;
  while (taken.has(`${base}_${suffix}`)) suffix++;
  return `${base}_${suffix}`;
}

/**
 * Parses the persisted checklist (text JSON) into typed items. Returns `null`
 * for unusable values: the row is neither dropped nor given an invented list;
 * it counts as "no list". Deterministic: parsing the same input twice yields
 * the same logical items (same text, state, and id).
 */
export function parsePracticeChecklist(raw: unknown): PracticeChecklistItem[] | null {
  if (raw === null || raw === undefined || raw === '') return null;
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(parsed)) return null;

  const items: PracticeChecklistItem[] = [];
  for (let index = 0; index < parsed.length; index++) {
    const entry = parsed[index];
    if (!entry || typeof entry !== 'object') continue;
    const text = (entry as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const explicitId = (entry as { id?: unknown }).id;
    // Explicit ids are preserved; synthesis (deterministic) only covers legacy
    // rows that lacked one.
    const id = typeof explicitId === 'string' && explicitId
      ? explicitId
      : deterministicChecklistItemId(String(text), index);
    items.push({
      id,
      text: String(text),
      done: Boolean((entry as { done?: unknown }).done)
    });
  }
  return items;
}

/** Serializes the list for its TEXT column. Empty or null list -> NULL. */
export function serializePracticeChecklist(items: PracticeChecklistItem[] | null | undefined): string | null {
  if (!items || items.length === 0) return null;
  return JSON.stringify(items);
}

export interface ChecklistSummary {
  total: number;
  done: number;
  percent: number;
}

/** Checklist progress. No items -> 0% (never NaN). */
export function summarizeChecklist(items: PracticeChecklistItem[] | null | undefined): ChecklistSummary {
  const list = items ?? [];
  const done = list.filter(item => item.done).length;
  return {
    total: list.length,
    done,
    percent: list.length > 0 ? Math.round((done / list.length) * 100) : 0
  };
}

export interface PracticeWorkSummary {
  total: number;
  done: number;
  inProgress: number;
  planned: number;
  completionPercent: number;
}

/** Per-status summary. Never divides by zero or invents progress. */
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

/** Readable kind label, with safe fallback for unknown values. */
export function practiceWorkKindLabel(kind?: string, lang: LanguageCode = 'es'): string {
  if (kind && kind in PRACTICE_WORK_KIND_LABELS) {
    return translateKey(lang, `practice.kind.${kind}`);
  }
  return translateKey(lang, 'practice.kind.other');
}

/** Readable status label, with safe fallback for unknown values. */
export function practiceWorkStatusLabel(status?: string, lang: LanguageCode = 'es'): string {
  if (status && status in PRACTICE_WORK_STATUS_LABELS) {
    return translateKey(lang, `practice.status.${status}`);
  }
  return PRACTICE_WORK_STATUS_LABELS.PLANNED.text;
}
