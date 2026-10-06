import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import { GRAPH_NODE_LABELS, resolveSearchResultDestination } from '../src/services/domainLogic.ts';
import {
  PALETTE_GROUP_LABELS,
  buildPaletteCatalog,
  type PaletteCatalogInput
} from '../src/services/commandPalette.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

/** Catálogo mínimo válido, con el trabajo práctico vacío salvo que se indique. */
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

/* -------------------------------------------------------------------------- */
/* 35.x — Estado deshabilitado de los controles sólidos                        */
/* -------------------------------------------------------------------------- */

test('35.1 the Button primitive resolves disabled state per variant instead of fading the text', () => {
  const source = readSource('../src/components/ui/index.tsx');

  assert.ok(
    source.includes('BUTTON_DISABLED'),
    'Debe existir un tratamiento deshabilitado por variante'
  );
  assert.ok(
    !/disabled:opacity-\d/.test(source),
    'El primitivo no debe atenuar TODO el elemento con opacity en estado deshabilitado'
  );
  assert.ok(
    source.includes('disabled:bg-line disabled:text-muted'),
    'Los botones sólidos deshabilitados deben usar superficie y tinta semánticas'
  );
  // Contraste real medido: muted sobre line = 5.16:1 (claro) y 5.22:1 (oscuro).
  assert.ok(source.includes('disabled:pointer-events-none'), 'Sigue sin recibir eventos');

  // El estado HABILITADO no cambia: el relleno de acento usa el token de tinta.
  assert.ok(
    source.includes('solid: \'bg-accent text-on-accent'),
    'El texto sobre el relleno de acento debe usar el token semántico on-accent'
  );
  assert.ok(!/text-white/.test(source), 'Sin colores literales en el primitivo');
});

test('35.2 no solid accent control keeps the old faint disabled opacity', () => {
  const files = [
    '../src/components/ai/AIAssistantDrawer.tsx',
    '../src/pages/CourseDetail.tsx',
    '../src/components/lesson/LessonWorkspace.tsx',
    '../src/components/ui/index.tsx'
  ];
  for (const file of files) {
    const source = readSource(file);
    // Un control con relleno de acento no puede volver al atenuado global.
    assert.ok(
      !/bg-accent[^"']*disabled:opacity-\d/.test(source),
      `${file}: un control sólido de acento no debe seguir usando disabled:opacity-*`
    );
    // Y su tinta debe salir del token, nunca de un literal claro.
    assert.ok(
      !/bg-accent[^"']*text-white/.test(source),
      `${file}: sin colores literales sobre el relleno de acento`
    );
  }

  // Los dos botones sólidos inline conservan un estado deshabilitado legible.
  for (const file of ['../src/components/ai/AIAssistantDrawer.tsx', '../src/pages/CourseDetail.tsx']) {
    const source = readSource(file);
    assert.ok(
      source.includes('disabled:bg-line disabled:text-muted'),
      `${file}: el estado deshabilitado debe usar superficie y tinta semánticas`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* 35.x — Leyenda del grafo en viewport estrecho                               */
/* -------------------------------------------------------------------------- */

test('35.3 the graph legend stays compact on narrow viewports without losing information', () => {
  const source = readSource('../src/pages/KnowledgeGraph.tsx');

  // Se ancla a ambos lados en móvil y se limita en escritorio: envuelve en menos
  // líneas en vez de crecer en alto sobre el lienzo.
  assert.ok(source.includes('absolute bottom-3 left-3 right-3'), 'Debe anclarse a ambos lados en móvil');
  assert.ok(source.includes('sm:max-w-[26rem]'), 'Debe limitar su ancho en escritorio');

  // La información secundaria se compacta; nada se elimina.
  assert.ok(source.includes('text-micro leading-snug text-faint'), 'Los metadatos usan la escala micro');
  assert.ok(source.includes('nodos con conexiones en el grafo completo'), 'La conectividad sigue visible');
  assert.ok(source.includes('aparece aislado'), 'El aislamiento de la vista sigue explicado');
  assert.ok(source.includes('Arrastra y haz zoom'), 'La indicación de interacción sigue visible');
});

/* -------------------------------------------------------------------------- */
/* 35.x — Tipado de GraphNodeMeta por tipo de nodo                             */
/* -------------------------------------------------------------------------- */

test('35.4 metadata shapes are declared per node kind and cover every kind', () => {
  const models = readSource('../src/types/models.ts');

  for (const shape of [
    'GraphNodeMetaCommon',
    'CourseNodeMeta',
    'BookNodeMeta',
    'ModuleNodeMeta',
    'LessonNodeMeta',
    'NoteNodeMeta',
    'PracticeNodeMeta',
    'GraphNodeMetaByKind'
  ]) {
    assert.ok(models.includes(shape), `Falta la forma de metadatos ${shape}`);
  }
  assert.ok(
    models.includes('practice: PracticeNodeMeta'),
    'El mapa por tipo debe incluir el trabajo práctico'
  );

  // Ancla en tiempo de ejecución: la lista de tipos con etiqueta debe coincidir
  // con los tipos que `GraphNodeMetaByKind` declara (si se añade un tipo al
  // grafo sin su forma de metadatos, TypeScript ya falla).
  assert.deepEqual(Object.keys(GRAPH_NODE_LABELS).sort(), [
    'book',
    'concept',
    'course',
    'lesson',
    'module',
    'note',
    'practice',
    'resource'
  ]);
});

/* -------------------------------------------------------------------------- */
/* 35.x — Trabajo práctico en búsqueda y paleta                                */
/* -------------------------------------------------------------------------- */

const PRACTICA = [
  {
    practiceId: 'pw1',
    practiceTitle: 'Refactorizar un componente a custom hooks',
    practiceDescription: 'Extrae la lógica de estado a un hook tipado.',
    practiceKind: 'code',
    practiceStatus: 'DONE',
    resourceId: 'c1-react',
    contextTitle: 'React 18 & TypeScript Masterclass'
  },
  {
    practiceId: 'pw-orphan',
    practiceTitle: 'Ensayo sin contexto',
    practiceKind: 'essay',
    practiceStatus: 'PLANNED'
  }
];

test('35.5 practice work is catalogued in the palette with its own group and a context destination', () => {
  assert.equal(PALETTE_GROUP_LABELS.practica, 'Trabajo práctico');

  const items = buildPaletteCatalog(catalogInput({ practiceWork: PRACTICA }));
  const withContext = items.find((item) => item.id === 'practica:pw1');
  assert.ok(withContext, 'El trabajo práctico debe estar en el catálogo');
  assert.equal(withContext!.group, 'practica');
  assert.equal(withContext!.icon, 'practice');
  assert.deepEqual(
    withContext!.destination,
    { tab: 'resource', resourceId: 'c1-react' },
    'Debe abrir su contexto de origen, no una vista inexistente'
  );
  assert.match(withContext!.subtitle || '', /Código/, 'El subtítulo muestra el tipo de artefacto en español');

  // Sin contexto declarado, degrada a la Biblioteca en lugar de romper el enlace.
  const orphan = items.find((item) => item.id === 'practica:pw-orphan');
  assert.deepEqual(orphan!.destination, { tab: 'library' });
});

test('35.6 the palette finds practice work by title, description and kind', () => {
  const items = buildPaletteCatalog(catalogInput({ practiceWork: PRACTICA }));
  const catalog = { items };

  // El ranking vive en la paleta; basta comprobar que el elemento existe y que
  // su cuerpo indexable incluye la descripción (mismo mecanismo que las notas).
  const withContext = items.find((item) => item.id === 'practica:pw1');
  assert.ok(withContext!.body && withContext!.body.includes('hook'), 'La descripción debe ser buscable');
  assert.ok(withContext!.keywords?.includes('Código'), 'El tipo en español debe ser buscable');
  assert.ok(catalog.items.length >= 2);
});

test('35.7 local search returns practice work and resolves it to its learning context', async () => {
  await dbBridge.init();

  const results = await dao.searchKnowledge('Refactorizar');
  const practice = results.find((r) => r.id === 'pw1');
  assert.ok(practice, 'La búsqueda local debe encontrar el trabajo práctico del seed');
  assert.equal(practice!.type, 'practice');
  assert.equal(practice!.resourceId, 'c1-react');

  assert.deepEqual(
    resolveSearchResultDestination(practice!),
    { tab: 'resource', resourceId: 'c1-react' },
    'La búsqueda abre el contexto, igual que el grafo y la paleta'
  );

  // Un trabajo sin recurso pero con lección se abre por su lección.
  assert.deepEqual(
    resolveSearchResultDestination({ id: 'x', type: 'practice', title: 'X', lessonId: 'l1' }),
    { tab: 'course', resourceId: 'l1' }
  );
  assert.deepEqual(
    resolveSearchResultDestination({ id: 'y', type: 'practice', title: 'Y' }),
    { tab: 'library' }
  );
});

test('35.8 the practice-work index is a single deterministic query with its context', async () => {
  await dbBridge.init();
  const rows = await dao.getPracticeWorkIndex();

  assert.ok(rows.length >= 3, 'El seed debe exponer su trabajo práctico al índice');
  const row = rows.find((r) => r.practiceId === 'pw1');
  assert.ok(row);
  assert.equal(row!.practiceKind, 'code');
  assert.equal(row!.practiceStatus, 'DONE');
  assert.equal(row!.resourceId, 'c1-react');
  assert.equal(
    row!.contextTitle,
    'React 18 & TypeScript Masterclass',
    'El título de contexto llega sin consultas extra'
  );

  // Orden determinista por título e id.
  const sorted = [...rows].sort((a, b) => a.practiceTitle.localeCompare(b.practiceTitle) || a.practiceId.localeCompare(b.practiceId));
  assert.deepEqual(rows.map((r) => r.practiceId), sorted.map((r) => r.practiceId));

  // Todo artefacto del seed está vinculado: no hay filas sin contexto.
  for (const item of rows) {
    assert.ok(item.resourceId || item.lessonId || item.conceptId, `${item.practiceId} debe declarar contexto`);
  }
});

test('35.9 the palette wires the practice-work index from the app shell', () => {
  const app = readSource('../src/App.tsx');
  assert.ok(app.includes('getPracticeWorkIndex'), 'La aplicación debe cargar el índice de práctica');
  assert.ok(app.includes('practiceWork: practiceIndex'), 'La paleta debe recibirlo');

  const palette = readSource('../src/components/common/CommandPalette.ts');
  assert.ok(palette.includes('practica:'), 'La interfaz debe tener icono para el grupo de práctica');
});
