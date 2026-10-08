import test from 'node:test';
import assert from 'node:assert';

import {
  PALETTE_GROUP_LABELS,
  buildPaletteCatalog,
  navigateToDestination,
  resolveActionTab,
  type PaletteCatalogInput,
  type PaletteNavigation
} from '../src/services/commandPalette.ts';
import { resolveSearchResultDestination } from '../src/services/domainLogic.ts';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import type { LearningGoal, SearchResult } from '../src/types/models.ts';

function catalogInput(overrides: Partial<PaletteCatalogInput> = {}): PaletteCatalogInput {
  return {
    courses: [],
    books: [],
    notes: [],
    lessons: [],
    concepts: [],
    resources: [],
    practiceWork: [],
    pendingReviews: 0,
    continueTarget: null,
    isDarkTheme: false,
    ...overrides
  };
}

function navigationSpy(): PaletteNavigation & { calls: Array<{ fn: string; arg?: string }> } {
  const calls: Array<{ fn: string; arg?: string }> = [];
  return {
    calls,
    openCourse: id => calls.push({ fn: 'course', arg: id }),
    openLesson: id => calls.push({ fn: 'lesson', arg: id }),
    openNote: id => calls.push({ fn: 'note', arg: id }),
    openConcept: id => calls.push({ fn: 'concept', arg: id }),
    openResource: id => calls.push({ fn: 'resource', arg: id }),
    openLibrary: () => calls.push({ fn: 'library' }),
    openGoals: goalId => calls.push({ fn: 'goals', arg: goalId })
  };
}

const GOALS: LearningGoal[] = [
  {
    id: 'g1',
    title: 'Terminar el curso de React 18',
    description: 'Completar todas las lecciones antes de diciembre',
    kind: 'course',
    resource_id: 'c1-react',
    status: 'active',
    target_date: '2026-12-01'
  },
  { id: 'g2', title: 'Leer Deep Work', kind: 'book', resource_id: 'b1', status: 'completed' }
];

test('search: la paleta expone el grupo de Metas con su etiqueta', () => {
  assert.strictEqual(PALETTE_GROUP_LABELS.meta, 'Metas');

  const items = buildPaletteCatalog(catalogInput({ goals: GOALS }));
  const goalItems = items.filter(item => item.group === 'meta');
  assert.strictEqual(goalItems.length, 2);

  const goal = goalItems.find(item => item.id === 'meta:g1');
  assert.ok(goal);
  assert.strictEqual(goal.title, 'Terminar el curso de React 18');
  assert.deepStrictEqual(goal.destination, { tab: 'goals', goalId: 'g1' });
  assert.match(goal.subtitle ?? '', /Activa/);
  assert.match(goal.subtitle ?? '', /2026-12-01/);

  const done = goalItems.find(item => item.id === 'meta:g2');
  assert.match(done?.subtitle ?? '', /Completada/);
});

test('search: la paleta indexa metas por título, descripción y tipo', () => {
  const items = buildPaletteCatalog(catalogInput({ goals: GOALS }));
  const goal = items.find(item => item.id === 'meta:g1');
  assert.ok(goal?.body?.includes('diciembre'), 'La descripción indexada permite buscar por contenido');
  assert.ok(goal?.keywords?.includes('course'), 'El tipo de meta es un alias de búsqueda');
  assert.ok(goal?.keywords?.includes('meta'));
});

test('search: catálogos antiguos sin goals siguen funcionando', () => {
  const legacy = catalogInput() as PaletteCatalogInput & { goals?: undefined };
  delete legacy.goals;
  const items = buildPaletteCatalog(legacy);
  assert.ok(items.length > 0);
  assert.ok(!items.some(item => item.group === 'meta'));
});

test('search: acciones de navegación a Hoy, Análisis y Metas', () => {
  assert.strictEqual(resolveActionTab('accion:focus'), 'focus');
  assert.strictEqual(resolveActionTab('accion:analytics'), 'analytics');
  assert.strictEqual(resolveActionTab('accion:goals'), 'goals');

  const items = buildPaletteCatalog(catalogInput());
  for (const id of ['accion:focus', 'accion:analytics', 'accion:goals']) {
    assert.ok(items.some(item => item.id === id), `Falta la acción ${id}`);
  }
});

test('search: navigateToDestination abre la vista de metas con la meta elegida', () => {
  const nav = navigationSpy();
  navigateToDestination({ tab: 'goals', goalId: 'g1' }, nav);
  assert.deepStrictEqual(nav.calls, [{ fn: 'goals', arg: 'g1' }]);

  const navSinGoal = navigationSpy();
  navigateToDestination({ tab: 'goals' }, navSinGoal);
  assert.deepStrictEqual(navSinGoal.calls, [{ fn: 'goals', arg: undefined }]);
});

test('search: navigateToDestination tolera navegadores sin callback de metas', () => {
  const nav: PaletteNavigation = {
    openCourse: () => undefined,
    openLesson: () => undefined,
    openNote: () => undefined,
    openConcept: () => undefined,
    openResource: () => undefined,
    openLibrary: () => undefined
    // sin openGoals: los catálogos antiguos no lo proporcionan
  };
  navigateToDestination({ tab: 'goals', goalId: 'g9' }, nav);
  // Sin callback no se navega ni se lanza: degradación silenciosa y segura.
});

test('search: los resultados de búsqueda resuelven destino de meta', () => {
  const result: SearchResult = { id: 'g1', type: 'goal', title: 'Terminar React' };
  assert.deepStrictEqual(resolveSearchResultDestination(result), { tab: 'goals', goalId: 'g1' });
});

test('search: la búsqueda global encuentra metas en la base real', async () => {
  await dbBridge.init();

  const results = await dao.searchKnowledge('curso de React');
  const goal = results.find(result => result.type === 'goal' && result.id === 'g1-course');
  assert.ok(goal, 'La meta de la semilla debe aparecer en la búsqueda global');
  assert.match(goal.subtitle ?? '', /Completar un curso/);
  assert.match(goal.subtitle ?? '', /Activa/);

  // Búsqueda sin coincidencias de meta: no se inventan resultados.
  const none = await dao.searchKnowledge('zzzmetaquenoesiste999');
  assert.strictEqual(none.filter(result => result.type === 'goal').length, 0);
});
