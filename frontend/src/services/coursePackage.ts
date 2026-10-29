/**
 * Course packages (teacher -> learner).
 *
 * A package is a JSON file carrying the learning MATERIAL of one resource:
 * the resource, its structure (modules and lessons with content), its proposed
 * practice work, and — when applicable — the course or book data. It does NOT
 * include personal data (notes, sessions, repetitions, progress): the package
 * travels from teacher to learner, never the other way round.
 *
 * Safety rules:
 *  - Importing is ADDITIVE and IDEMPOTENT: it never deletes or overwrites rows.
 *  - A package with an unknown format or version is rejected before any write.
 *
 * The logic lives here, outside React and SQLite, so it can be tested separately.
 */

import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

export const COURSE_PACKAGE_FORMAT = 'crossedarts.course-package';
/** Format version this build can write and read. */
export const COURSE_PACKAGE_VERSION = 1;

export interface CoursePackageResource {
  id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  cover_path?: string | null;
  type: string;
}

export interface CoursePackageCourse {
  instructor?: string | null;
  difficulty?: string | null;
  total_duration_minutes?: number | null;
  total_lessons?: number | null;
}

export interface CoursePackageBook {
  author?: string | null;
  isbn?: string | null;
  page_count?: number | null;
}

export interface CoursePackageModule {
  id: string;
  title: string;
  order_index: number;
}

export interface CoursePackageLesson {
  id: string;
  module_id: string;
  title: string;
  content?: string | null;
  order_index: number;
  duration_minutes: number;
  lesson_type: string;
  media_url?: string | null;
}

export interface CoursePackagePracticeWork {
  id: string;
  title: string;
  description?: string | null;
  lesson_id?: string | null;
  kind: string;
  status: string;
  notes?: string | null;
}

export interface CoursePackage {
  format: typeof COURSE_PACKAGE_FORMAT;
  version: number;
  exportedAt: string;
  resource: CoursePackageResource;
  course?: CoursePackageCourse | null;
  book?: CoursePackageBook | null;
  modules: CoursePackageModule[];
  lessons: CoursePackageLesson[];
  practiceWork: CoursePackagePracticeWork[];
}

export interface CoursePackageValidation {
  valid: boolean;
  error?: string;
  package?: CoursePackage;
}

/** Builds the package envelope from data already read out of SQLite. */
export function buildCoursePackage(input: {
  resource: CoursePackageResource;
  course?: CoursePackageCourse | null;
  book?: CoursePackageBook | null;
  modules?: CoursePackageModule[];
  lessons?: CoursePackageLesson[];
  practiceWork?: CoursePackagePracticeWork[];
  exportedAt?: string;
}): CoursePackage {
  return {
    format: COURSE_PACKAGE_FORMAT,
    version: COURSE_PACKAGE_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    resource: input.resource,
    course: input.course ?? null,
    book: input.book ?? null,
    modules: input.modules ?? [],
    lessons: input.lessons ?? [],
    practiceWork: input.practiceWork ?? []
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasValidId(value: unknown): boolean {
  return isPlainObject(value) && typeof value.id === 'string' && value.id.length > 0;
}

/**
 * Validates a package before any write. As with backup restore, EVERYTHING is
 * checked first: importing only starts when the package is intact.
 */
export function validateCoursePackage(data: unknown, lang: LanguageCode = 'es'): CoursePackageValidation {
  if (!isPlainObject(data)) {
    return { valid: false, error: translateKey(lang, 'pkg.badFormat') };
  }

  if (data.format !== COURSE_PACKAGE_FORMAT) {
    return {
      valid: false,
      error: 'El archivo no es un paquete de curso de CrossedArts.'
    };
  }

  const version = data.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { valid: false, error: translateKey(lang, 'pkg.badVersion') };
  }
  if (version > COURSE_PACKAGE_VERSION) {
    return {
      valid: false,
      error: `El paquete fue creado con una versión más moderna de CrossedArts (${version}). Actualiza la aplicación antes de importarlo.`
    };
  }

  const resource = data.resource;
  if (!hasValidId(resource) || typeof (resource as any).title !== 'string' || !(resource as any).title.trim()) {
    return { valid: false, error: translateKey(lang, 'pkg.badResource') };
  }
  if (typeof (resource as any).type !== 'string' || !(resource as any).type.trim()) {
    return { valid: false, error: 'El recurso del paquete no declara su tipo.' };
  }

  const listChecks: Array<[string, unknown]> = [
    ['modules', data.modules],
    ['lessons', data.lessons],
    ['practiceWork', data.practiceWork]
  ];
  for (const [name, value] of listChecks) {
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) {
      return { valid: false, error: `El campo "${name}" del paquete debe ser una lista.` };
    }
    for (let i = 0; i < value.length; i += 1) {
      if (!hasValidId(value[i])) {
        return { valid: false, error: `El elemento ${i + 1} de "${name}" no tiene un id válido.` };
      }
    }
  }

  // Every lesson must point at a module present in the package: a package with
  // orphan lessons would produce broken courses on import.
  const moduleIds = new Set(((data.modules as any[]) || []).map((m) => m.id));
  for (const lesson of ((data.lessons as any[]) || [])) {
    if (typeof lesson.module_id !== 'string' || !moduleIds.has(lesson.module_id)) {
      return {
        valid: false,
        error: `La lección "${lesson.id}" apunta a un módulo que no está en el paquete.`
      };
    }
  }

  return { valid: true, package: data as unknown as CoursePackage };
}

export interface CoursePackageImportPlan {
  /** Ids that already exist and are therefore skipped (idempotent import). */
  existing: string[];
  /** Ids that will be created. */
  toCreate: string[];
}

/**
 * Decides, without writing anything, what will be created and what is skipped.
 * Importing is idempotent: importing the same package twice duplicates nothing.
 */
export function planCoursePackageImport(
  pkg: CoursePackage,
  existingIds: ReadonlySet<string>
): CoursePackageImportPlan {
  const ids = [
    pkg.resource.id,
    ...(pkg.modules || []).map((module) => module.id),
    ...(pkg.lessons || []).map((lesson) => lesson.id),
    ...(pkg.practiceWork || []).map((work) => work.id)
  ];

  const existing: string[] = [];
  const toCreate: string[] = [];
  for (const id of ids) {
    if (existingIds.has(id)) existing.push(id);
    else toCreate.push(id);
  }
  return { existing, toCreate };
}

/**
 * Deterministic fingerprint of the content an element is compared against.
 *
 * Pure, stable function: the same data always produces the same fingerprint,
 * regardless of browser or key order. 32-bit FNV-1a is used because comparison
 * only happens within a single import (it is neither a security hash nor a
 * persistent identifier).
 */
export function contentSignature(parts: ReadonlyArray<string | number | null | undefined>): string {
  const joined = parts
    .map((part) => (part === null || part === undefined ? '' : String(part).replace(/\s+/g, ' ').trim()))
    .join('\u001f');
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i += 1) {
    hash ^= joined.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export type CoursePackageConflictKind = 'resource' | 'module' | 'lesson' | 'practiceWork';

export interface CoursePackageConflict {
  id: string;
  kind: CoursePackageConflictKind;
  /** Readable label of the conflicting element. */
  label: string;
}

/** Canonical signature of a package's resource. */
export function resourceSignature(resource: CoursePackageResource): string {
  return contentSignature([resource.title, resource.description, resource.category, resource.type]);
}

/** Canonical signature of a package module. */
export function moduleSignature(module: CoursePackageModule): string {
  return contentSignature([module.title, module.order_index]);
}

/**
 * Canonical signature of a lesson. Material traveling teacher->learner does NOT
 * include `is_completed`: progress belongs to the learner and is not part of the
 * package.
 */
export function lessonSignature(lesson: CoursePackageLesson): string {
  return contentSignature([
    lesson.title,
    lesson.content,
    lesson.order_index,
    lesson.duration_minutes,
    lesson.lesson_type,
    lesson.media_url
  ]);
}

/**
 * Canonical signature of the PROPOSED practice work. `status` is deliberately
 * excluded: a work's status is the learner's personal progress, not teaching
 * material, so a work already completed locally must not be reported as a
 * conflict.
 */
export function practiceWorkSignature(work: CoursePackagePracticeWork): string {
  return contentSignature([work.title, work.description, work.lesson_id, work.kind, work.notes]);
}

/**
 * Detects package elements whose ID already exists locally but whose CONTENT
 * differs from the package's.
 *
 * Resolution rule: importing is ADDITIVE and LOCAL content ALWAYS wins. Learner
 * work is never overwritten with imported material. The function does not decide
 * what to do with the conflict: it only makes it visible, so the outcome is
 * deterministic and explainable rather than silent.
 */
export function detectCoursePackageConflicts(
  pkg: CoursePackage,
  localSignatures: ReadonlyMap<string, string>
): CoursePackageConflict[] {
  const conflicts: CoursePackageConflict[] = [];

  const check = (
    id: string,
    kind: CoursePackageConflictKind,
    label: string,
    incomingSignature: string
  ) => {
    const local = localSignatures.get(id);
    if (local !== undefined && local !== incomingSignature) {
      conflicts.push({ id, kind, label });
    }
  };

  check(pkg.resource.id, 'resource', pkg.resource.title, resourceSignature(pkg.resource));
  for (const module of pkg.modules || []) {
    check(module.id, 'module', module.title, moduleSignature(module));
  }
  for (const lesson of pkg.lessons || []) {
    check(lesson.id, 'lesson', lesson.title, lessonSignature(lesson));
  }
  for (const work of pkg.practiceWork || []) {
    check(work.id, 'practiceWork', work.title, practiceWorkSignature(work));
  }

  return conflicts;
}

/** Readable summary for the UI after importing. */
export function describeImportResult(created: number, skipped: number, lang: LanguageCode = 'es'): string {
  if (created === 0 && skipped === 0) return translateKey(lang, 'pkg.empty');
  if (created === 0) {
    return skipped === 1
      ? translateKey(lang, 'pkg.nothingNewOne')
      : translateKey(lang, 'pkg.nothingNewOther', { n: skipped });
  }
  const base = created === 1
    ? translateKey(lang, 'pkg.importedOne')
    : translateKey(lang, 'pkg.importedOther', { n: created });
  return skipped > 0 ? `${base}${translateKey(lang, 'pkg.skipped', { n: skipped })}` : base;
}

/**
 * Completes the import summary with the detected conflicts. Kept separate from
 * `describeImportResult` so its already-tested contract stays intact.
 */
export function describeConflicts(conflicts: readonly CoursePackageConflict[], lang: LanguageCode = 'es'): string {
  if (conflicts.length === 0) return '';
  const label = conflicts.length === 1
    ? translateKey(lang, 'pkg.conflictOneLabel')
    : translateKey(lang, 'pkg.conflictOtherLabel', { n: conflicts.length });
  return `${label}${translateKey(lang, 'pkg.conflictSuffix')}`;
}
