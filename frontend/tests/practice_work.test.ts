import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { SCHEMA_SQL } from '../src/db/schema.ts';
import { getDatabaseTables } from '../src/db/exportImport.ts';
import {
  PRACTICE_WORK_KINDS,
  PRACTICE_WORK_KIND_LABELS,
  PRACTICE_WORK_STATUSES,
  PRACTICE_WORK_STATUS_LABELS,
  nextPracticeWorkStatus,
  practiceWorkKindLabel,
  practiceWorkStatusLabel,
  summarizePracticeWork,
  validatePracticeWorkDraft
} from '../src/services/practiceWork.ts';
import type { PracticeWork } from '../src/types/models.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

/* -------------------------------------------------------------------------- */
/* 29.x — Lógica pura                                                          */
/* -------------------------------------------------------------------------- */

test('29.1 every practice-work kind and status has a Spanish label', () => {
  for (const kind of PRACTICE_WORK_KINDS) {
    assert.ok(PRACTICE_WORK_KIND_LABELS[kind], `Falta la etiqueta del tipo ${kind}`);
  }
  for (const status of PRACTICE_WORK_STATUSES) {
    assert.ok(PRACTICE_WORK_STATUS_LABELS[status]?.text, `Falta la etiqueta del estado ${status}`);
  }
  assert.equal(practiceWorkKindLabel('inventado'), 'Otro', 'Un tipo desconocido degrada con seguridad');
  assert.equal(practiceWorkStatusLabel('inventado'), 'Planificado');
  assert.equal(practiceWorkKindLabel('code'), 'Código');
});

test('29.2 nextPracticeWorkStatus cycles deterministically', () => {
  assert.equal(nextPracticeWorkStatus('PLANNED'), 'IN_PROGRESS');
  assert.equal(nextPracticeWorkStatus('IN_PROGRESS'), 'DONE');
  assert.equal(nextPracticeWorkStatus('DONE'), 'PLANNED');
});

test('29.3 validatePracticeWorkDraft enforces title, linkage, rating and no blob URLs', () => {
  assert.equal(validatePracticeWorkDraft({ title: '', resource_id: 'c1' }).ok, false);
  assert.equal(validatePracticeWorkDraft({ title: '   ', resource_id: 'c1' }).ok, false);
  assert.equal(validatePracticeWorkDraft({ title: 'Tarea' }).ok, false, 'Sin vínculo debe fallar');
  assert.equal(validatePracticeWorkDraft({ title: 'Tarea', resource_id: 'c1' }).ok, true);
  assert.equal(validatePracticeWorkDraft({ title: 'Tarea', lesson_id: 'l1' }).ok, true);
  assert.equal(validatePracticeWorkDraft({ title: 'Tarea', concept_id: 'cp1' }).ok, true);
  assert.equal(
    validatePracticeWorkDraft({ title: 'Tarea', resource_id: 'c1', self_rating: 7 }).ok,
    false
  );
  assert.equal(
    validatePracticeWorkDraft({ title: 'Tarea', resource_id: 'c1', self_rating: 4 }).ok,
    true
  );
  assert.equal(
    validatePracticeWorkDraft({ title: 'Tarea', resource_id: 'c1', artifact_url: 'blob:xyz' } as any).ok,
    false,
    'Nunca se persisten URLs blob:'
  );
});

test('29.4 summarizePracticeWork counts by status and never divides by zero', () => {
  const make = (status: PracticeWork['status']): PracticeWork => ({
    id: status + Math.random(), title: 't', kind: 'exercise', status
  });

  assert.deepEqual(summarizePracticeWork([]), {
    total: 0, done: 0, inProgress: 0, planned: 0, completionPercent: 0
  });

  const summary = summarizePracticeWork([
    make('DONE'), make('DONE'), make('IN_PROGRESS'), make('PLANNED')
  ]);
  assert.equal(summary.total, 4);
  assert.equal(summary.done, 2);
  assert.equal(summary.inProgress, 1);
  assert.equal(summary.planned, 1);
  assert.equal(summary.completionPercent, 50);
});

/* -------------------------------------------------------------------------- */
/* 29.x — Esquema, respaldo e integración                                      */
/* -------------------------------------------------------------------------- */

test('29.5 the schema declares the practice_work table and its indexes', () => {
  assert.ok(SCHEMA_SQL.includes('CREATE TABLE IF NOT EXISTS practice_work'));
  assert.ok(SCHEMA_SQL.includes('idx_practice_work_resource'));
  assert.ok(SCHEMA_SQL.includes('idx_practice_work_lesson'));
  assert.ok(SCHEMA_SQL.includes('idx_practice_work_status'));
  // La tabla es aditiva: se crea con IF NOT EXISTS para migrar bases existentes.
  assert.ok(/CREATE TABLE IF NOT EXISTS practice_work/.test(SCHEMA_SQL));
});

test('29.6 practice_work participates in JSON backup and validation', () => {
  assert.ok(getDatabaseTables().includes('practice_work'), 'El respaldo debe incluir el trabajo práctico');
  const source = readSource('../src/db/exportImport.ts');
  assert.ok(source.includes("'practice_work'"));
});

test('29.7 the demo seed links practice work to resources, lessons and concepts', async () => {
  await dbBridge.init();
  const items = await dao.getAllPracticeWork();
  assert.ok(items.length >= 3, 'El seed debe incluir trabajo práctico de ejemplo');

  const statuses = new Set(items.map(item => item.status));
  assert.ok(statuses.has('DONE') && statuses.has('IN_PROGRESS') && statuses.has('PLANNED'));

  // Todo trabajo del seed debe estar vinculado a algo real.
  for (const item of items) {
    assert.ok(
      item.resource_id || item.lesson_id || item.concept_id,
      `El trabajo ${item.id} debe estar vinculado`
    );
  }

  const stats = await dao.getPracticeWorkStats();
  assert.equal(stats.total, items.length);
  assert.equal(stats.done + stats.inProgress + stats.planned, stats.total);
});

/* -------------------------------------------------------------------------- */
/* 29.x — DAO: ciclo de vida real                                              */
/* -------------------------------------------------------------------------- */

test('29.8 practice work roundtrips: create, update status seals completed_at, delete', async () => {
  await dbBridge.init();

  const id = await dao.addPracticeWork({
    title: 'Tarea de prueba de integración',
    resource_id: 'c1-react',
    kind: 'project',
    status: 'PLANNED'
  });

  try {
    const created = await dao.getPracticeWorkById(id);
    assert.ok(created, 'El trabajo creado debe poder leerse');
    assert.equal(created!.title, 'Tarea de prueba de integración');
    assert.equal(created!.kind, 'project');
    assert.equal(created!.status, 'PLANNED');
    assert.equal(created!.completed_at, undefined);

    // Estado intermedio: sin fecha de cierre.
    await dao.updatePracticeWork(id, { status: 'IN_PROGRESS' });
    const inProgress = await dao.getPracticeWorkById(id);
    assert.equal(inProgress!.status, 'IN_PROGRESS');
    assert.equal(inProgress!.completed_at, undefined);

    // Done: se sella completed_at automáticamente.
    await dao.updatePracticeWork(id, { status: 'DONE' });
    const done = await dao.getPracticeWorkById(id);
    assert.equal(done!.status, 'DONE');
    assert.ok(done!.completed_at, 'Marcar como terminado debe sellar completed_at');

    // Volver atrás limpia la fecha de cierre (no se inventa historial).
    await dao.updatePracticeWork(id, { status: 'PLANNED' });
    const reopened = await dao.getPracticeWorkById(id);
    assert.equal(reopened!.completed_at, undefined);

    await dao.updatePracticeWork(id, { self_rating: 4, notes: 'Repasar el margen' });
    const rated = await dao.getPracticeWorkById(id);
    assert.equal(rated!.self_rating, 4);
    assert.equal(rated!.notes, 'Repasar el margen');
  } finally {
    const deleted = await dao.deletePracticeWork(id);
    assert.equal(deleted, true);
  }

  assert.equal(await dao.getPracticeWorkById(id), null);
  assert.equal(await dao.deletePracticeWork(id), false, 'Borrar dos veces es un no-op seguro');
});

test('29.9 lesson-scoped practice work never leaks between lessons', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const courseId = 'test-pw-course';
  const moduleId = 'test-pw-module';
  const lessonA = 'test-pw-lesson-a';
  const lessonB = 'test-pw-lesson-b';

  db.run("INSERT INTO learning_resource (id, title, type) VALUES (?, ?, 'course')", [courseId, 'Curso de práctica']);
  db.run('INSERT INTO course (id) VALUES (?)', [courseId]);
  db.run('INSERT INTO module (id, course_id, title) VALUES (?, ?, ?)', [moduleId, courseId, 'Módulo']);
  db.run('INSERT INTO lesson (id, module_id, title) VALUES (?, ?, ?)', [lessonA, moduleId, 'Lección A']);
  db.run('INSERT INTO lesson (id, module_id, title) VALUES (?, ?, ?)', [lessonB, moduleId, 'Lección B']);
  await dbBridge.persist();

  const genericId = await dao.addPracticeWork({ title: 'Trabajo del recurso', resource_id: courseId });
  const lessonAId = await dao.addPracticeWork({ title: 'Trabajo de A', resource_id: courseId, lesson_id: lessonA });
  const lessonBId = await dao.addPracticeWork({ title: 'Trabajo de B', resource_id: courseId, lesson_id: lessonB });

  try {
    const scopeA = await dao.getPracticeWorkForResource(courseId, lessonA);
    const idsA = scopeA.map(item => item.id);
    assert.ok(idsA.includes(genericId), 'El ámbito de lección incluye el trabajo del recurso');
    assert.ok(idsA.includes(lessonAId));
    assert.equal(idsA.includes(lessonBId), false, 'El trabajo de otra lección no debe filtrarse');

    const wholeResource = await dao.getPracticeWorkForResource(courseId);
    assert.equal(wholeResource.length, 3);
    // Orden por atención: lo no terminado primero (todos están planificados).
    assert.deepEqual(wholeResource.map(i => i.status), ['PLANNED', 'PLANNED', 'PLANNED']);
  } finally {
    for (const id of [genericId, lessonAId, lessonBId]) {
      await dao.deletePracticeWork(id);
    }
    db.run("DELETE FROM learning_resource WHERE id = ?", [courseId]);
    await dbBridge.persist();
  }
});

test('29.10 deleting a resource preserves its practice work as an orphan artifact', async () => {
  await dbBridge.init();
  const db = dbBridge.getDatabase();

  const courseId = 'test-pw-cascade';
  db.run("INSERT INTO learning_resource (id, title, type) VALUES (?, ?, 'course')", [courseId, 'Curso temporal']);
  db.run('INSERT INTO course (id) VALUES (?)', [courseId]);
  await dbBridge.persist();

  const id = await dao.addPracticeWork({ title: 'Trabajo temporal', resource_id: courseId });
  assert.ok(await dao.getPracticeWorkById(id));

  db.run('DELETE FROM learning_resource WHERE id = ?', [courseId]);
  await dbBridge.persist();

  // El trabajo práctico es evidencia PRODUCIDA por el estudiante: borrar el
  // recurso de origen no debe destruirla (ON DELETE SET NULL). El artefacto
  // queda huérfano pero visible y explicable.
  const survivor = await dao.getPracticeWorkById(id);
  assert.ok(survivor, 'El trabajo práctico debe sobrevivir al borrado del recurso');
  assert.ok(!survivor!.resource_id, 'Su vínculo al recurso queda como NULL');
  const visible = await dao.getAllPracticeWork();
  assert.ok(visible.some((w) => w.id === id), 'El artefacto huérfano sigue siendo visible en la biblioteca');
});

/* -------------------------------------------------------------------------- */
/* 29.x — Interfaz                                                             */
/* -------------------------------------------------------------------------- */

test('29.11 the resource detail view mounts the practice work panel', () => {
  const source = readSource('../src/pages/ResourceDetail.tsx');
  assert.ok(source.includes('PracticeWorkPanel'), 'El detalle de recurso debe montar el panel');
  assert.ok(source.includes('resourceId={resource.id}'), 'El panel debe recibir el recurso real');
});

test('29.12 the practice work panel uses semantic tokens and accessible controls', () => {
  const source = readSource('../src/components/practice/PracticeWorkPanel.tsx');
  assert.ok(!/\bslate-\d/.test(source) && !/\bpurple-\d/.test(source) && !/\bindigo-\d/.test(source));
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(source), 'Sin colores hexadecimales literales');
  assert.ok(source.includes('aria-label'), 'Los controles deben tener nombre accesible');
  assert.ok(source.includes('ConfirmDialog'), 'El borrado debe requerir confirmación explícita');
});
