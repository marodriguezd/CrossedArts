import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  COURSE_PACKAGE_FORMAT,
  COURSE_PACKAGE_VERSION,
  buildCoursePackage,
  contentSignature,
  describeConflicts,
  detectCoursePackageConflicts,
  lessonSignature,
  moduleSignature,
  practiceWorkSignature,
  resourceSignature,
  type CoursePackage
} from '../src/services/coursePackage.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

function samplePackage(): CoursePackage {
  return buildCoursePackage({
    resource: { id: 'res-1', title: 'Curso de muestra', type: 'course', category: 'General' },
    course: { difficulty: 'BEGINNER', total_lessons: 1 },
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
      { id: 'pw-1', title: 'Ejercicio', description: null, lesson_id: 'les-1', kind: 'exercise', status: 'PLANNED', notes: null }
    ],
    exportedAt: '2026-10-06T00:00:00.000Z'
  });
}

/** Mapa de firmas tal y como lo construiría el DAO para el paquete de muestra. */
function signaturesOf(pkg: CoursePackage): Map<string, string> {
  const map = new Map<string, string>();
  map.set(pkg.resource.id, resourceSignature(pkg.resource));
  for (const m of pkg.modules) map.set(m.id, moduleSignature(m));
  for (const l of pkg.lessons) map.set(l.id, lessonSignature(l));
  for (const w of pkg.practiceWork) map.set(w.id, practiceWorkSignature(w));
  return map;
}

/* -------------------------------------------------------------------------- */
/* 34.x — Firmas de contenido                                                  */
/* -------------------------------------------------------------------------- */

test('34.1 content signatures are deterministic and change only with content', () => {
  assert.equal(contentSignature(['a', 'b']), contentSignature(['a', 'b']));
  assert.equal(contentSignature(['a', 'b']), contentSignature([' a ', 'b']), 'El espaciado no genera falsos positivos');
  assert.notEqual(contentSignature(['a', 'b']), contentSignature(['a', 'c']));

  const pkg = samplePackage();
  assert.equal(lessonSignature(pkg.lessons[0]), lessonSignature(pkg.lessons[0]));
  assert.notEqual(
    lessonSignature(pkg.lessons[0]),
    lessonSignature({ ...pkg.lessons[0], content: 'Otro contenido' })
  );
});

test('34.2 a practice work status change is personal progress, not a conflict', () => {
  const pkg = samplePackage();
  const incoming = practiceWorkSignature(pkg.practiceWork[0]);
  const advancedLocally: typeof pkg.practiceWork[0] = { ...pkg.practiceWork[0], status: 'DONE' };
  assert.equal(
    practiceWorkSignature(advancedLocally),
    incoming,
    'El estado del trabajo es progreso del alumno y no debe reportarse como conflicto'
  );
});

/* -------------------------------------------------------------------------- */
/* 34.x — Detección de conflictos                                              */
/* -------------------------------------------------------------------------- */

test('34.3 identical content produces no conflicts', () => {
  const pkg = samplePackage();
  assert.deepEqual(detectCoursePackageConflicts(pkg, signaturesOf(pkg)), []);
});

test('34.4 differing content is reported per element without deciding the outcome', () => {
  const pkg = samplePackage();
  const local = signaturesOf(pkg);
  local.set('res-1', contentSignature(['Otro título local']));
  local.set('les-1', contentSignature(['Lección modificada']));

  const conflicts = detectCoursePackageConflicts(pkg, local);
  const ids = conflicts.map((c) => c.id).sort();
  assert.deepEqual(ids, ['les-1', 'res-1']);
  assert.equal(conflicts.find((c) => c.id === 'les-1')!.kind, 'lesson');
  assert.equal(conflicts.find((c) => c.id === 'res-1')!.kind, 'resource');
  assert.equal(conflicts.find((c) => c.id === 'les-1')!.label, 'Lección 1');
  // Un id ausente localmente no puede entrar en conflicto.
  const localWithoutLesson = signaturesOf(pkg);
  localWithoutLesson.delete('les-1');
  assert.deepEqual(
    detectCoursePackageConflicts(pkg, localWithoutLesson).map((c) => c.id),
    []
  );
});

test('34.5 the conflict summary is explicit and non-destructive in wording', () => {
  assert.equal(describeConflicts([]), '');
  const one = describeConflicts([{ id: 'a', kind: 'lesson', label: 'A' }]);
  assert.match(one, /1 elemento/);
  assert.match(one, /se conservó tu versión local/i);
  assert.match(one, /no se sobrescribió/i);

  const several = describeConflicts([
    { id: 'a', kind: 'lesson', label: 'A' },
    { id: 'b', kind: 'module', label: 'B' }
  ]);
  assert.match(several, /2 elementos/);
});

/* -------------------------------------------------------------------------- */
/* 34.x — El DAO informa del conflicto y conserva lo local                     */
/* -------------------------------------------------------------------------- */

test('34.6 importing over a divergent local version keeps local content and reports it', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const pkg = await dao.exportCoursePackage('c1-react');
  assert.ok(pkg);
  const lesson = pkg!.lessons[0];
  assert.ok(lesson);

  const readTitle = (): string =>
    String(db.exec('SELECT title FROM lesson WHERE id = ?', [lesson.id])[0].values[0][0]);
  const originalTitle = readTitle();
  const localTitle = `${originalTitle} (nota local)`;

  db.run('UPDATE lesson SET title = ? WHERE id = ?', [localTitle, lesson.id]);
  await dbBridge.persist();

  try {
    const result = await dao.importCoursePackage(pkg!);
    assert.equal(result.created, 0, 'Nada nuevo debe crearse');
    assert.ok(result.skipped > 0);
    assert.ok(
      result.conflicts.some((c) => c.id === lesson.id && c.kind === 'lesson'),
      'El conflicto debe reportarse'
    );
    assert.equal(readTitle(), localTitle, 'El contenido LOCAL nunca se sobrescribe');

    const summary = describeConflicts(result.conflicts);
    assert.match(summary, /se conservó tu versión local/i);
  } finally {
    db.run('UPDATE lesson SET title = ? WHERE id = ?', [originalTitle, lesson.id]);
    await dbBridge.persist();
  }

  // Restaurado el contenido local, el mismo paquete ya no entra en conflicto.
  const clean = await dao.importCoursePackage(pkg!);
  assert.deepEqual(clean.conflicts, []);
});

/* -------------------------------------------------------------------------- */
/* 34.x — Interfaz                                                             */
/* -------------------------------------------------------------------------- */

test('34.7 Settings reports conflicts and the detail explains what a package contains', () => {
  const settings = readSource('../src/pages/SettingsView.tsx');
  assert.ok(settings.includes('describeConflicts'), 'Ajustes debe informar de los conflictos detectados');

  const detail = readSource('../src/pages/ResourceDetail.tsx');
  assert.ok(
    /material educativo/i.test(detail),
    'El detalle debe describir el paquete como material educativo'
  );
  assert.ok(
    /sin tu progreso|no incluye tu progreso/i.test(detail),
    'Debe quedar claro que el paquete no transporta datos personales'
  );
});
