import test from 'node:test';
import assert from 'node:assert';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  MAX_CHECKLIST_ITEMS,
  nextChecklistItemId,
  parsePracticeChecklist,
  serializePracticeChecklist,
  summarizeChecklist,
  validatePracticeWorkDraft
} from '../src/services/practiceWork.ts';
import type { PracticeChecklistItem } from '../src/types/models.ts';

/* ------------------------- lista de verificación ------------------------- */

test('practice workspace: parsePracticeChecklist degrada con seguridad', () => {
  assert.strictEqual(parsePracticeChecklist(null), null);
  assert.strictEqual(parsePracticeChecklist(undefined), null);
  assert.strictEqual(parsePracticeChecklist(''), null);
  assert.strictEqual(parsePracticeChecklist('no es json {'), null);
  assert.strictEqual(parsePracticeChecklist('{"no":"array"}'), null);

  const items = parsePracticeChecklist(
    JSON.stringify([
      { id: 'a', text: 'Paso uno', done: true },
      { text: 'Sin id: se genera' },
      { id: 'vacio', text: '   ', done: false }, // sin texto útil → se descarta
      'no-objeto',
      null
    ])
  );
  assert.ok(items);
  assert.strictEqual(items.length, 2, 'Solo los ítems con texto válido sobreviven');
  assert.strictEqual(items[0].id, 'a');
  assert.strictEqual(items[0].done, true);
  assert.ok(items[1].id, 'Los ítems sin id reciben uno estable para React');

  // Se acepta también una lista ya parseada.
  const direct = parsePracticeChecklist([{ text: 'directo', done: false }]);
  assert.strictEqual(direct?.length, 1);
});

test('practice workspace: serialización y resumen de la lista', () => {
  assert.strictEqual(serializePracticeChecklist(null), null);
  assert.strictEqual(serializePracticeChecklist([]), null, 'Lista vacía → NULL en SQLite');

  const items: PracticeChecklistItem[] = [{ id: 'x', text: 'Revisar', done: false }];
  const serialized = serializePracticeChecklist(items);
  assert.ok(serialized);
  const roundtrip = parsePracticeChecklist(serialized);
  assert.deepStrictEqual(roundtrip, items);

  assert.deepStrictEqual(summarizeChecklist(null), { total: 0, done: 0, percent: 0 });
  assert.deepStrictEqual(summarizeChecklist([]), { total: 0, done: 0, percent: 0 });
  assert.deepStrictEqual(
    summarizeChecklist([
      { id: '1', text: 'a', done: true },
      { id: '2', text: 'b', done: true },
      { id: '3', text: 'c', done: false }
    ]),
    { total: 3, done: 2, percent: 67 }
  );
});

test('practice workspace: validación de borradores con espacio de trabajo', () => {
  const base = { title: 'Ensayo', resource_id: 'b1-deepwork' };

  assert.strictEqual(validatePracticeWorkDraft(base).ok, true);

  // Lista con elemento vacío → rechazado.
  const emptyItem = validatePracticeWorkDraft({
    ...base,
    checklist: [{ id: 'a', text: '   ', done: false }]
  });
  assert.strictEqual(emptyItem.ok, false);
  assert.match(emptyItem.error ?? '', /texto/);

  // Lista demasiado larga → rechazada.
  const tooLong = validatePracticeWorkDraft({
    ...base,
    checklist: Array.from({ length: MAX_CHECKLIST_ITEMS + 1 }, (_, i) => ({
      id: String(i),
      text: `paso ${i}`,
      done: false
    }))
  });
  assert.strictEqual(tooLong.ok, false);

  // Contenido no textual → rechazado.
  const badContent = validatePracticeWorkDraft({ ...base, content: 42 as unknown as string });
  assert.strictEqual(badContent.ok, false);

  // Contenido válido + lista válida → aceptado.
  assert.strictEqual(
    validatePracticeWorkDraft({
      ...base,
      content: '# Mi ensayo\n\nDesarrollo...',
      checklist: [{ id: 'a', text: 'Borrador', done: true }]
    }).ok,
    true
  );

  // Las reglas previas siguen vigentes.
  assert.strictEqual(validatePracticeWorkDraft({ title: '', resource_id: 'x' }).ok, false);
  assert.strictEqual(validatePracticeWorkDraft({ title: 'Sin vínculo' }).ok, false);
  assert.strictEqual(
    validatePracticeWorkDraft({ title: 'x', resource_id: 'r', self_rating: 9 }).ok,
    false
  );
});

/* --------------------------- persistencia real --------------------------- */

test('practice workspace: contenido y lista sobreviven el ciclo DAO', async () => {
  await dbBridge.init();

  const checklist: PracticeChecklistItem[] = [
    { id: 's1', text: 'Plantear el ejercicio', done: true },
    { id: 's2', text: 'Resolver la parte a', done: false },
    { id: 's3', text: 'Revisar resultados', done: false }
  ];

  const id = await dao.addPracticeWork({
    title: 'Espacio de prueba',
    kind: 'exercise',
    resource_id: 'c1-react',
    status: 'PLANNED'
  });

  await dao.updatePracticeWork(id, {
    content: '## Desarrollo\n\nPasos realizados...',
    checklist,
    self_rating: 4
  });

  const loaded = await dao.getPracticeWorkById(id);
  assert.ok(loaded);
  assert.strictEqual(loaded.content, '## Desarrollo\n\nPasos realizados...');
  assert.deepStrictEqual(loaded.checklist, checklist);
  assert.strictEqual(loaded.self_rating, 4);

  // Actualizar solo la lista no toca el contenido.
  const next = checklist.map(item => ({ ...item, done: true }));
  await dao.updatePracticeWork(id, { checklist: next });
  const afterToggle = await dao.getPracticeWorkById(id);
  assert.deepStrictEqual(afterToggle?.checklist, next);
  assert.strictEqual(afterToggle?.content, '## Desarrollo\n\nPasos realizados...');

  // Lista vacía → NULL de nuevo (no un JSON "[]" muerto).
  await dao.updatePracticeWork(id, { checklist: [] });
  const cleared = await dao.getPracticeWorkById(id);
  assert.strictEqual(cleared?.checklist, undefined);

  // Autoevaluación se puede limpiar con undefined explícito (clave presente).
  await dao.updatePracticeWork(id, { self_rating: undefined });
  const unrated = await dao.getPracticeWorkById(id);
  assert.strictEqual(unrated?.self_rating, undefined);

  // JSON corrupto en la columna no rompe la lectura de la fila.
  const db = dbBridge.getDatabase();
  db.run('UPDATE practice_work SET checklist = ? WHERE id = ?', ['{corrupto', id]);
  const corrupted = await dao.getPracticeWorkById(id);
  assert.ok(corrupted, 'La fila sigue siendo legible');
  assert.strictEqual(corrupted?.checklist, undefined, 'La lista corrupta se trata como ausente');

  await dao.deletePracticeWork(id);
  assert.strictEqual(await dao.getPracticeWorkById(id), null);
});

test('practice workspace: una base legada gana las columnas del espacio de trabajo al importarse', async () => {
  await dbBridge.init();
  const originalBytes = dbBridge.exportDatabase();

  // Construye una base "antigua": mismo esquema pero sin content/checklist.
  const initSqlJs = (await import('sql.js')).default;
  const SQL = await initSqlJs();
  const legacy = new SQL.Database();
  try {
    const { SCHEMA_SQL } = await import('../src/db/schema.ts');
    legacy.run(SCHEMA_SQL);
    legacy.run(
      "INSERT INTO learning_resource (id, title, type, category, status) VALUES ('legacy-r', 'Recurso legado', 'course', 'General', 'NOT_STARTED')"
    );
    legacy.run(
      "INSERT INTO course (id, instructor, difficulty, total_lessons, completed_lessons) VALUES ('legacy-r', NULL, 'BEGINNER', 2, 0)"
    );
    legacy.run(
      "INSERT INTO practice_work (id, title, resource_id, kind, status) VALUES ('legacy-pw', 'Trabajo legado', 'legacy-r', 'project', 'IN_PROGRESS')"
    );
    legacy.run('ALTER TABLE practice_work DROP COLUMN content;');
    legacy.run('ALTER TABLE practice_work DROP COLUMN checklist;');

    const beforeInfo = legacy.exec('PRAGMA table_info(practice_work)');
    const beforeCols = new Set(beforeInfo[0].values.map(row => String(row[1])));
    assert.ok(!beforeCols.has('content'), 'La base legada no tiene content');
    assert.ok(!beforeCols.has('checklist'), 'La base legada no tiene checklist');

    const legacyBytes = legacy.export();
    await dbBridge.importDatabase(legacyBytes);

    const db = dbBridge.getDatabase();
    const info = db.exec('PRAGMA table_info(practice_work)');
    const columns = new Set(info[0].values.map(row => String(row[1])));
    assert.ok(columns.has('content'), 'La migración añade content');
    assert.ok(columns.has('checklist'), 'La migración añade checklist');

    const rows = await dao.getAllPracticeWork();
    const migrated = rows.find(row => row.id === 'legacy-pw');
    assert.ok(migrated, 'El trabajo legado conserva sus datos');
    assert.strictEqual(migrated.title, 'Trabajo legado');
    assert.strictEqual(migrated.content, undefined);
    assert.strictEqual(migrated.checklist, undefined);

    // La base migrada ya puede usar el espacio de trabajo.
    await dao.updatePracticeWork('legacy-pw', {
      content: 'Ahora con contenido',
      checklist: [{ id: 'n1', text: 'nuevo', done: false }]
    });
    const upgraded = await dao.getPracticeWorkById('legacy-pw');
    assert.strictEqual(upgraded?.content, 'Ahora con contenido');
    assert.strictEqual(upgraded?.checklist?.length, 1);
  } finally {
    try { legacy.close(); } catch { /* cierre defensivo */ }
    // Restaurar la base original para el resto del proceso.
    await dbBridge.importDatabase(originalBytes);
  }
});


test('practice workspace: el parseo del checklist es determinista', async () => {
  const legacy = JSON.stringify([
    { text: 'Revisar el tema 1' },
    { text: 'Hacer ejercicios' },
    { text: 'Repasar tarjetas' }
  ]);

  const first = parsePracticeChecklist(legacy)!;
  const second = parsePracticeChecklist(legacy)!;
  assert.deepStrictEqual(first, second, 'Parsear la misma entrada devuelve los mismos ítems');
  assert.deepStrictEqual(first.map(i => i.id), second.map(i => i.id), 'Identificadores estables');
  assert.ok(
    first.every(i => i.id && !/\d{10,}/.test(i.id)),
    'Los identificadores no contienen marcas de tiempo aleatorias'
  );
});

test('practice workspace: los identificadores explícitos se preservan', () => {
  const parsed = parsePracticeChecklist(JSON.stringify([
    { id: 'mi-id-explicito', text: 'Paso con id', done: true },
    { text: 'Paso sin id' }
  ]))!;
  assert.strictEqual(parsed[0].id, 'mi-id-explicito');
  assert.strictEqual(parsed[1].id !== 'mi-id-explicito', true);
});

test('practice workspace: añadir un paso genera un id determinista y único', () => {
  const first = nextChecklistItemId([], 'Analizar el caso');
  assert.strictEqual(nextChecklistItemId([], 'Analizar el caso'), first, 'Mismo contenido → mismo id');

  const existing = [{ id: first, text: 'Analizar el caso', done: false }];
  const second = nextChecklistItemId(existing, 'Analizar el caso');
  assert.notStrictEqual(second, first, 'Texto repetido no colisiona');
  assert.strictEqual(nextChecklistItemId(existing, 'Analizar el caso'), second, 'Sigue siendo determinista');
});
