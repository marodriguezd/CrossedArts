import test from 'node:test';
import assert from 'node:assert';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  generateJsonBackup,
  getDatabaseTables,
  importJsonBackup,
  validateJsonBackup
} from '../src/db/exportImport.ts';

test('goals: la tabla learning_goal participa en el respaldo JSON', async () => {
  await dbBridge.init();

  assert.ok(getDatabaseTables().includes('learning_goal'), 'getDatabaseTables debe incluir learning_goal');

  const dump = generateJsonBackup();
  assert.ok(Array.isArray(dump['learning_goal']), 'El volcado debe incluir learning_goal');
  assert.ok(dump['learning_goal'].length >= 1, 'La semilla incluye al menos una meta de ejemplo');
  assert.ok(
    dump['learning_goal'].every((row: any) => typeof row.id === 'string' && row.id),
    'Toda meta exportada debe tener id'
  );
  assert.strictEqual(validateJsonBackup(dump).valid, true);
});

test('goals: el respaldo rechaza columnas inexistentes en learning_goal', async () => {
  await dbBridge.init();
  const dump = generateJsonBackup();
  const tampered = JSON.parse(JSON.stringify(dump));
  tampered['learning_goal'].push({
    id: 'g-fantasma',
    title: 'Meta con columna inventada',
    kind: 'custom',
    status: 'active',
    progress_percent: 42 // no existe en el esquema: se rechaza sin tocar la base
  });

  const result = validateJsonBackup(tampered);
  assert.strictEqual(result.valid, false);
  assert.match(result.error ?? '', /learning_goal/);
});

test('goals: CRUD completo sobre la base de datos real', async () => {
  await dbBridge.init();

  const createdId = await dao.createGoal({
    title: 'Terminar el libro de Deep Work',
    description: 'Leer las 304 páginas antes del examen',
    kind: 'book',
    resource_id: 'b1-deepwork',
    target_date: '2026-11-30'
  });

  const created = await dao.getGoalById(createdId);
  assert.ok(created, 'La meta creada debe poder leerse');
  assert.strictEqual(created.title, 'Terminar el libro de Deep Work');
  assert.strictEqual(created.kind, 'book');
  assert.strictEqual(created.resource_id, 'b1-deepwork');
  assert.strictEqual(created.status, 'active');
  assert.strictEqual(created.completed_at, undefined);
  assert.ok(created.created_at, 'Debe registrar fecha de creación');

  const all = await dao.getGoals();
  assert.ok(all.some(goal => goal.id === createdId));

  // Actualización de campos.
  await dao.updateGoal(createdId, { title: 'Deep Work — lectura completa', target_value: undefined });
  const updated = await dao.getGoalById(createdId);
  assert.strictEqual(updated?.title, 'Deep Work — lectura completa');

  // Completar sella completed_at.
  await dao.updateGoal(createdId, { status: 'completed' });
  const completed = await dao.getGoalById(createdId);
  assert.strictEqual(completed?.status, 'completed');
  assert.ok(completed?.completed_at, 'Completar debe sellar completed_at');

  // Reabrir limpia completed_at.
  await dao.updateGoal(createdId, { status: 'active' });
  const reopened = await dao.getGoalById(createdId);
  assert.strictEqual(reopened?.status, 'active');
  assert.strictEqual(reopened?.completed_at, undefined);

  // Borrado.
  assert.strictEqual(await dao.deleteGoal(createdId), true);
  assert.strictEqual(await dao.getGoalById(createdId), null);
  assert.strictEqual(await dao.deleteGoal(createdId), false, 'Borrar dos veces devuelve false');
});

test('goals: al crear, si la persistencia falla no queda meta fantasma', async () => {
  await dbBridge.init();
  const before = (await dao.getGoals()).length;

  // Validación de negativos en DAO: target no numérico se persiste como NULL,
  // nunca como un valor roto.
  const id = await dao.createGoal({ title: 'Meta sin objetivo numérico', kind: 'custom', target_value: Number.NaN });
  const goal = await dao.getGoalById(id);
  assert.strictEqual(goal?.target_value, undefined, 'NaN no debe persistirse');
  await dao.deleteGoal(id);

  assert.strictEqual((await dao.getGoals()).length, before);
});

test('goals: la meta de ejemplo de la semilla apunta a un curso real', async () => {
  await dbBridge.init();
  const goals = await dao.getGoals();
  const seeded = goals.find(goal => goal.id === 'g1-course');
  assert.ok(seeded, 'La semilla crea la meta g1-course');
  assert.strictEqual(seeded.kind, 'course');
  assert.strictEqual(seeded.resource_id, 'c1-react');
  assert.strictEqual(seeded.status, 'active');
  assert.ok(seeded.target_date, 'La meta de ejemplo tiene fecha objetivo');
});

test('goals: el ciclo de respaldo completo conserva las metas', async () => {
  await dbBridge.init();

  const original = generateJsonBackup();
  const goalCount = (original['learning_goal'] || []).length;

  const mutated = JSON.parse(JSON.stringify(original));
  mutated['learning_goal'] = [
    ...mutated['learning_goal'],
    {
      id: 'g-backup-roundtrip',
      title: 'Meta de prueba de respaldo',
      kind: 'study_time',
      target_value: 300,
      status: 'active'
    }
  ];

  await importJsonBackup(mutated);
  let restored = generateJsonBackup();
  assert.strictEqual(restored['learning_goal'].length, goalCount + 1);
  assert.ok(restored['learning_goal'].some((g: any) => g.id === 'g-backup-roundtrip'));

  // Restaurar el estado original.
  await importJsonBackup(original);
  restored = generateJsonBackup();
  assert.strictEqual(restored['learning_goal'].length, goalCount);
  assert.ok(!restored['learning_goal'].some((g: any) => g.id === 'g-backup-roundtrip'));
});

test('analytics DAO: sesiones y minutos se leen sin estructuras paralelas', async () => {
  await dbBridge.init();

  const sessions = await dao.getSessionsForAnalytics();
  assert.ok(sessions.length >= 4, 'La semilla registra al menos 4 sesiones completadas');
  for (const session of sessions) {
    assert.strictEqual(session.status, 'completed');
    assert.ok(typeof session.duration_minutes === 'number');
  }

  const totalMinutes = await dao.getStudyMinutesSince();
  const sum = sessions.reduce((acc, session) => acc + session.duration_minutes, 0);
  assert.strictEqual(totalMinutes, sum, 'getStudyMinutesSince debe sumar las mismas sesiones');

  const future = await dao.getStudyMinutesSince('2999-01-01 00:00:00');
  assert.strictEqual(future, 0, 'Sin actividad futura no se inventan minutos');
});

test('analytics DAO: la serie diaria admite el rango de 90 días', async () => {
  await dbBridge.init();
  const series = await dao.getDailyActivitySeries('90d');
  assert.ok(Array.isArray(series));
  assert.strictEqual(series.length, 90, 'El rango de 90 días genera 90 puntos continuos');
  const total = series.reduce((acc, point) => acc + point.minutes, 0);
  assert.ok(total > 0, 'La semilla tiene actividad registrada');
});
