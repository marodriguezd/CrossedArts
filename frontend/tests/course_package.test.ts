import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  COURSE_PACKAGE_FORMAT,
  COURSE_PACKAGE_VERSION,
  buildCoursePackage,
  describeImportResult,
  planCoursePackageImport,
  validateCoursePackage,
  type CoursePackage
} from '../src/services/coursePackage.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

function samplePackage(overrides: Partial<CoursePackage> = {}): CoursePackage {
  return {
    format: COURSE_PACKAGE_FORMAT,
    version: COURSE_PACKAGE_VERSION,
    exportedAt: '2026-10-06T00:00:00.000Z',
    resource: { id: 'res-1', title: 'Curso de muestra', type: 'course', category: 'General' },
    course: { difficulty: 'BEGINNER', total_lessons: 1 },
    book: null,
    modules: [{ id: 'mod-1', title: 'Módulo 1', order_index: 1 }],
    lessons: [
      {
        id: 'les-1',
        module_id: 'mod-1',
        title: 'Lección 1',
        content: 'Contenido',
        order_index: 1,
        duration_minutes: 10,
        lesson_type: 'VIDEO',
        media_url: null
      }
    ],
    practiceWork: [
      { id: 'pw-1', title: 'Ejercicio', kind: 'exercise', status: 'PLANNED', lesson_id: 'les-1' }
    ],
    ...overrides
  };
}

/* -------------------------------------------------------------------------- */
/* 30.x — Formato y validación                                                 */
/* -------------------------------------------------------------------------- */

test('30.1 buildCoursePackage fills defaults and stamps the format', () => {
  const pkg = buildCoursePackage({
    resource: { id: 'r', title: 'T', type: 'book' },
    exportedAt: '2026-01-01T00:00:00.000Z'
  });
  assert.equal(pkg.format, COURSE_PACKAGE_FORMAT);
  assert.equal(pkg.version, COURSE_PACKAGE_VERSION);
  assert.equal(pkg.exportedAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(pkg.modules, []);
  assert.deepEqual(pkg.lessons, []);
  assert.deepEqual(pkg.practiceWork, []);
  assert.equal(pkg.course, null);
  assert.equal(pkg.book, null);
});

test('30.2 validateCoursePackage rejects non-objects and foreign formats', () => {
  assert.equal(validateCoursePackage(null).valid, false);
  assert.equal(validateCoursePackage([]).valid, false);
  assert.equal(validateCoursePackage('nope').valid, false);
  assert.equal(validateCoursePackage({ format: 'otra-cosa', version: 1 }).valid, false);
  const wrongFormat = validateCoursePackage({ format: 'otra-cosa', version: 1 });
  assert.match(wrongFormat.error || '', /paquete de curso/i);
});

test('30.3 validateCoursePackage rejects future versions with an actionable message', () => {
  const result = validateCoursePackage(samplePackage({ version: COURSE_PACKAGE_VERSION + 1 }));
  assert.equal(result.valid, false);
  assert.match(result.error || '', /versión más moderna/i);
});

test('30.4 validateCoursePackage requires a well-formed resource', () => {
  const noTitle = samplePackage();
  (noTitle.resource as any).title = '   ';
  assert.equal(validateCoursePackage(noTitle).valid, false);

  const noId = samplePackage();
  (noId.resource as any).id = '';
  assert.equal(validateCoursePackage(noId).valid, false);

  const noType = samplePackage();
  (noType.resource as any).type = '';
  assert.equal(validateCoursePackage(noType).valid, false);
});

test('30.5 validateCoursePackage rejects orphan lessons and non-list collections', () => {
  const orphan = samplePackage();
  orphan.lessons[0].module_id = 'mod-desconocido';
  const orphanResult = validateCoursePackage(orphan);
  assert.equal(orphanResult.valid, false);
  assert.match(orphanResult.error || '', /módulo que no está en el paquete/i);

  const badList = samplePackage() as any;
  badList.modules = { not: 'a list' };
  assert.equal(validateCoursePackage(badList).valid, false);

  const missingId = samplePackage() as any;
  missingId.practiceWork = [{ title: 'sin id' }];
  assert.equal(validateCoursePackage(missingId).valid, false);
});

test('30.6 a valid package passes validation and is returned typed', () => {
  const result = validateCoursePackage(samplePackage());
  assert.equal(result.valid, true);
  assert.ok(result.package);
  assert.equal(result.package!.resource.id, 'res-1');
  assert.equal(result.package!.lessons.length, 1);
});

/* -------------------------------------------------------------------------- */
/* 30.x — Idempotencia                                                         */
/* -------------------------------------------------------------------------- */

test('30.7 planCoursePackageImport is idempotent across repeated imports', () => {
  const pkg = samplePackage();

  const first = planCoursePackageImport(pkg, new Set());
  assert.deepEqual(first.existing, []);
  assert.deepEqual(first.toCreate.sort(), ['les-1', 'mod-1', 'pw-1', 'res-1']);

  const second = planCoursePackageImport(pkg, new Set(['res-1', 'mod-1', 'les-1', 'pw-1']));
  assert.deepEqual(second.toCreate, []);
  assert.equal(second.existing.length, 4);

  const partial = planCoursePackageImport(pkg, new Set(['res-1']));
  assert.deepEqual(partial.toCreate.sort(), ['les-1', 'mod-1', 'pw-1']);
  assert.deepEqual(partial.existing, ['res-1']);
});

test('30.8 describeImportResult reports created and skipped honestly', () => {
  assert.equal(describeImportResult(0, 0), 'El paquete estaba vacío.');
  assert.match(describeImportResult(0, 3), /ya existían/i);
  assert.match(describeImportResult(1, 0), /1 elemento nuevo/i);
  assert.match(describeImportResult(5, 2), /5 elementos nuevos/i);
  assert.match(describeImportResult(5, 2), /2 ya existían/i);
});

/* -------------------------------------------------------------------------- */
/* 30.x — DAO: exportar e importar de verdad                                   */
/* -------------------------------------------------------------------------- */

test('30.9 exportCoursePackage gathers structure and excludes personal data', async () => {
  await dbBridge.init();
  const pkg = await dao.exportCoursePackage('c1-react');
  assert.ok(pkg, 'Un curso del seed debe poder exportarse');
  assert.equal(pkg!.format, COURSE_PACKAGE_FORMAT);
  assert.equal(pkg!.resource.id, 'c1-react');
  assert.equal(pkg!.resource.type, 'course');
  assert.ok(pkg!.modules.length >= 2, 'Debe incluir los módulos del curso');
  assert.ok(pkg!.lessons.length >= 4, 'Debe incluir las lecciones');
  assert.ok(pkg!.practiceWork.some(w => w.id === 'pw1'), 'Debe incluir el trabajo práctico del recurso');

  // Privacidad: un paquete docente NUNCA transporta datos personales.
  const serialized = JSON.stringify(pkg);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'notes'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'sessions'), false);
  assert.equal(/repetition_count|ease_factor|interval_days|inactive_seconds|cards_reviewed/.test(serialized), false);

  assert.equal(await dao.exportCoursePackage('no-existe'), null);
});

test('30.10 importing a package is additive, idempotent and cascade-safe', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const source = await dao.exportCoursePackage('c1-react');
  assert.ok(source);

  // Clonar con ids nuevos para no chocar con el contenido real del usuario.
  const cloned = JSON.parse(JSON.stringify(source)) as CoursePackage;
  const newResourceId = 'pkg-test-course';
  cloned.resource.id = newResourceId;
  cloned.resource.title = 'Curso importado de prueba';
  cloned.modules = cloned.modules.map((m, i) => ({ ...m, id: `pkg-mod-${i}` }));
  cloned.lessons = cloned.lessons.map((l, i) => ({
    ...l,
    id: `pkg-les-${i}`,
    module_id: `pkg-mod-${Math.max(0, cloned.modules.findIndex(m => m.id === l.module_id))}`
  }));
  cloned.practiceWork = cloned.practiceWork.map((w, i) => ({ ...w, id: `pkg-pw-${i}`, lesson_id: null }));

  const validation = validateCoursePackage(cloned);
  assert.equal(validation.valid, true, validation.error);

  const expectedCount =
    1 + cloned.modules.length + cloned.lessons.length + cloned.practiceWork.length;

  try {
    const first = await dao.importCoursePackage(cloned);
    assert.equal(first.created, expectedCount);
    assert.equal(first.skipped, 0);

    // El recurso importado existe y su estructura es completa.
    const detail = await dao.getResourceDetail(newResourceId);
    assert.ok(detail, 'El recurso importado debe existir');
    assert.equal(detail!.resource.title, 'Curso importado de prueba');
    const importedModules = cloned.modules.length;
    assert.equal(cloned.lessons.length, (source!.lessons || []).length, 'No se pierden lecciones al clonar');
    assert.ok(importedModules > 0);

    const lessons = db.exec(
      `SELECT COUNT(*) FROM lesson WHERE module_id IN (${cloned.modules.map(() => '?').join(',')})`,
      cloned.modules.map(m => m.id)
    );
    assert.equal(Number(lessons[0].values[0][0]), cloned.lessons.length);

    const work = await dao.getPracticeWorkForResource(newResourceId);
    assert.equal(work.length, cloned.practiceWork.length);

    // Importar el mismo paquete otra vez no duplica NADA.
    const second = await dao.importCoursePackage(cloned);
    assert.equal(second.created, 0);
    assert.equal(second.skipped, expectedCount);
  } finally {
    db.run('DELETE FROM learning_resource WHERE id = ?', [newResourceId]);
    await dbBridge.persist();
  }

  assert.equal(await dao.getResourceDetail(newResourceId), null, 'El borrado en cascada limpia todo');
});

/* -------------------------------------------------------------------------- */
/* 30.x — Interfaz                                                             */
/* -------------------------------------------------------------------------- */

test('30.11 the resource detail exports a package and Settings imports it', () => {
  const detail = readSource('../src/pages/ResourceDetail.tsx');
  assert.ok(detail.includes('exportCoursePackage'), 'El detalle debe exportar el paquete');
  assert.ok(detail.includes('downloadJsonFile'), 'Debe reutilizar la descarga segura de JSON');

  const settings = readSource('../src/pages/SettingsView.tsx');
  assert.ok(settings.includes('validateCoursePackage'), 'Ajustes debe validar el paquete antes de escribir');
  assert.ok(settings.includes('importCoursePackage'), 'Ajustes debe importar el paquete');
  assert.ok(settings.includes('Importar paquete'), 'Debe existir el control de importación de paquetes');
});
