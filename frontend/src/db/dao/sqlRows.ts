/**
 * Safe sql.js row reads and sensitive-entity mapping.
 *
 * Split out of the dao.ts monolith so the domain modules (sessions, notes,
 * practice work, goals) share ONE row-reading implementation: the same SQLite
 * value converts exactly one way.
 */

import { translateKey } from '../../i18n/dictionaries.ts';
import { daoLang } from '../daoLanguage.ts';
import { parsePracticeChecklist } from '../../services/practiceWork.ts';
import {
  resolveEffectiveStudySessionScope,
  STUDY_SESSION_SCOPES,
  type StudySessionScope
} from '../../services/sessionScope.ts';
import type {
  LearningSession,
  PracticeWork,
  PracticeWorkKind,
  PracticeWorkStatus,
  StudySessionMode,
  StudySessionStatus
} from '../../types/models.ts';

type SqlValue = unknown;

export class SqlRow {
  private readonly row: readonly SqlValue[];

  constructor(row: readonly SqlValue[]) {
    this.row = row;
  }

  str(index: number): string {
    const v = this.row[index];
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new Error(translateKey(daoLang(), 'dao.err.badRow', { i: index }));
    }
    return String(v);
  }

  optionalStr(index: number): string | undefined {
    const v = this.row[index];
    return v === null || v === undefined ? undefined : this.str(index);
  }

  num(index: number, fallback = 0): number {
    const v = this.row[index];
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  bool(index: number): boolean {
    return this.num(index) === 1;
  }
}

/** Coerces a sql.js value to a nullable string (or null). */
export function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Coerces a sql.js value to a nullable number, rejecting non-numeric input. */
export function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

/** Maps a raw `practice_work` row to a typed domain object. */
export function mapPracticeWorkRow(row: readonly unknown[]): PracticeWork {
  const r = new SqlRow(row);
  return {
    id: r.str(0),
    title: r.str(1),
    description: r.optionalStr(2),
    resource_id: r.optionalStr(3),
    lesson_id: r.optionalStr(4),
    concept_id: r.optionalStr(5),
    kind: (r.optionalStr(6) as PracticeWorkKind) || 'exercise',
    status: (r.optionalStr(7) as PracticeWorkStatus) || 'PLANNED',
    artifact_url: r.optionalStr(8),
    notes: r.optionalStr(9),
    self_rating: r.optionalStr(10) === undefined ? undefined : r.num(10),
    completed_at: r.optionalStr(11),
    created_at: r.optionalStr(12),
    updated_at: r.optionalStr(13),
    content: r.optionalStr(14),
    checklist: parsePracticeChecklist(r.optionalStr(15)) ?? undefined
  };
}


export function mapLearningSessionRow(row: readonly unknown[]): LearningSession {
  const r = new SqlRow(row);
  const resourceId = r.optionalStr(1);
  const lessonId = r.optionalStr(12);
  // The persisted scope is the source of truth, with honest re-derivation: when
  // its anchor is gone (material deleted, history kept) or a legacy row declares
  // none, the effective scope derives from the real anchors under the same
  // canonical rule (`services/sessionScope.ts`).
  const declaredScope = r.optionalStr(14);
  const scope = resolveEffectiveStudySessionScope(
    STUDY_SESSION_SCOPES.includes(declaredScope as StudySessionScope)
      ? (declaredScope as StudySessionScope)
      : undefined,
    { resourceId, lessonId }
  );
  return {
    id: r.str(0),
    resource_id: resourceId,
    scope,
    started_at: r.str(2),
    ended_at: r.optionalStr(3),
    duration_minutes: r.num(4),
    inactive_seconds: r.num(5),
    mode: (r.str(6) as StudySessionMode) || 'flashcards',
    cards_reviewed: r.num(7),
    questions_answered: r.num(8),
    correct_answers: r.num(9),
    status: (r.str(10) as StudySessionStatus) || 'completed',
    resource_title: r.optionalStr(11),
    lesson_id: lessonId,
    lesson_title: r.optionalStr(13)
  };
}
