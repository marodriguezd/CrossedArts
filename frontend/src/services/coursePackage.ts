/**
 * Paquetes de curso (profesor → alumno).
 *
 * Un paquete es un fichero JSON con el MATERIAL de aprendizaje de un recurso:
 * el recurso, su estructura (módulos y lecciones con contenido), su trabajo
 * práctico propuesto y —si aplica— los datos del curso o libro. NO incluye datos
 * personales (notas, sesiones, repeticiones, progreso): el paquete viaja del
 * profesor al alumno, no al revés.
 *
 * Reglas de seguridad:
 *  - La importación es ADITIVA e IDEMPOTENTE: nunca borra ni sobrescribe filas.
 *  - Un paquete con formato o versión desconocidos se rechaza antes de escribir.
 *
 * La lógica vive aquí, fuera de React y de SQLite, para poder probarla aparte.
 */

export const COURSE_PACKAGE_FORMAT = 'crossedarts.course-package';
/** Versión del formato que esta build sabe escribir y leer. */
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

/** Construye el sobre del paquete a partir de datos ya leídos de SQLite. */
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
 * Valida un paquete antes de cualquier escritura. Igual que la restauración de
 * respaldos, se comprueba TODO primero: la importación solo empieza si el
 * paquete es íntegro.
 */
export function validateCoursePackage(data: unknown): CoursePackageValidation {
  if (!isPlainObject(data)) {
    return { valid: false, error: 'El paquete no tiene un formato válido: se esperaba un objeto JSON.' };
  }

  if (data.format !== COURSE_PACKAGE_FORMAT) {
    return {
      valid: false,
      error: 'El archivo no es un paquete de curso de CrossedArts.'
    };
  }

  const version = data.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    return { valid: false, error: 'El paquete no declara una versión válida.' };
  }
  if (version > COURSE_PACKAGE_VERSION) {
    return {
      valid: false,
      error: `El paquete fue creado con una versión más moderna de CrossedArts (${version}). Actualiza la aplicación antes de importarlo.`
    };
  }

  const resource = data.resource;
  if (!hasValidId(resource) || typeof (resource as any).title !== 'string' || !(resource as any).title.trim()) {
    return { valid: false, error: 'El paquete no contiene un recurso válido (id y título son obligatorios).' };
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

  // Toda lección debe apuntar a un módulo presente en el paquete: un paquete con
  // lecciones huérfanas produciría cursos rotos al importar.
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
  /** IDs que ya existen y por tanto se omiten (importación idempotente). */
  existing: string[];
  /** IDs que se crearán. */
  toCreate: string[];
}

/**
 * Decide, sin escribir nada, qué se creará y qué se omite. La importación es
 * idempotente: importar dos veces el mismo paquete no duplica nada.
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

/* -------------------------------------------------------------------------- */
/* Conflictos de importación                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Huella determinista del contenido con el que se compara un elemento.
 *
 * Función pura y estable: los mismos datos producen siempre la misma huella,
 * independientemente del navegador o del orden de las claves. Se usa FNV-1a de
 * 32 bits porque solo hace falta comparar dentro de una misma importación (no
 * es un hash de seguridad ni un identificador persistente).
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
  /** Etiqueta legible del elemento en conflicto. */
  label: string;
}

/** Firma canónica del recurso de un paquete. */
export function resourceSignature(resource: CoursePackageResource): string {
  return contentSignature([resource.title, resource.description, resource.category, resource.type]);
}

/** Firma canónica de un módulo de un paquete. */
export function moduleSignature(module: CoursePackageModule): string {
  return contentSignature([module.title, module.order_index]);
}

/**
 * Firma canónica de una lección. El material que viaja profesor→alumno NO
 * incluye `is_completed`: el progreso es del alumno y no forma parte del paquete.
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
 * Firma canónica del trabajo práctico PROPUESTO. Se excluye `status` a propósito:
 * el estado de un trabajo es progreso personal del alumno, no material docente,
 * así que un trabajo ya terminado localmente no debe reportarse como conflicto.
 */
export function practiceWorkSignature(work: CoursePackagePracticeWork): string {
  return contentSignature([work.title, work.description, work.lesson_id, work.kind, work.notes]);
}

/**
 * Detecta elementos del paquete cuyo ID ya existe localmente pero cuyo CONTENIDO
 * difiere del que trae el paquete.
 *
 * Regla de resolución: la importación es ADITIVA y el contenido LOCAL gana
 * SIEMPRE. Nunca se sobrescribe trabajo del alumno con material importado. La
 * función no decide qué hacer con el conflicto: solo lo hace visible, para que el
 * resultado sea determinista y explicable en lugar de silencioso.
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

/** Resumen legible para la interfaz tras importar. */
export function describeImportResult(created: number, skipped: number): string {
  if (created === 0 && skipped === 0) return 'El paquete estaba vacío.';
  if (created === 0) {
    return `No había nada nuevo que importar (${skipped} elemento${skipped === 1 ? '' : 's'} ya existían).`;
  }
  const base = `Paquete importado: ${created} elemento${created === 1 ? '' : 's'} nuevo${created === 1 ? '' : 's'}.`;
  return skipped > 0 ? `${base} ${skipped} ya existían y se omitieron.` : base;
}

/**
 * Completa el resumen de importación con los conflictos detectados. Se mantiene
 * aparte de `describeImportResult` para no alterar su contrato ya probado.
 */
export function describeConflicts(conflicts: readonly CoursePackageConflict[]): string {
  if (conflicts.length === 0) return '';
  const label = conflicts.length === 1 ? '1 elemento ya existía' : `${conflicts.length} elementos ya existían`;
  return `${label} con un contenido distinto: se conservó tu versión local y no se sobrescribió nada.`;
}
