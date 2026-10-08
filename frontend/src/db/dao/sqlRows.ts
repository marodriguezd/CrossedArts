/**
 * Lectura segura de filas de sql.js y mapeo de las entidades sensibles.
 *
 * Extraído del monolito dao.ts para que los módulos de dominio (sesiones, notas,
 * trabajo práctico, metas) compartan UNA sola implementación de lectura de
 * filas: no puede haber dos formas de convertir el mismo valor de SQLite.
 */

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
      throw new Error(`Fila SQL inválida: se esperaba texto en la posición ${index}`);
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


/** Convierte un valor de sql.js en texto nullable (o null). */
export function asNullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** Convierte un valor de sql.js en número nullable, rechazando lo no numérico. */
export function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}


/** Mapea una fila cruda de `practice_work` a un objeto de dominio tipado. */
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
  // El ámbito persistido es la fuente de verdad, con reclasificación honesta:
  // si su ancla ya no existe (el material se borró y el historial se conserva)
  // o si la fila heredada no lo declara, el ámbito efectivo se deriva de las
  // anclas reales con la misma regla canónica (`services/sessionScope.ts`).
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


