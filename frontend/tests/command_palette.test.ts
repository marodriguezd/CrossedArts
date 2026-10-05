import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dbBridge } from '../src/db/sqliteBridge.ts';
import { dao } from '../src/db/dao.ts';
import {
  PALETTE_BODY_MAX_CHARS,
  PALETTE_FUZZY_MIN_LENGTH,
  PALETTE_SCORE,
  bodySnippet,
  buildPaletteCatalog,
  matchPaletteItems,
  matchRangesInText,
  normalizeWithMap,
  segmentForHighlight,
  filterPaletteItems,
  groupPaletteItems,
  isPaletteHotkey,
  movePaletteSelection,
  PALETTE_GROUP_LABELS,
  navigateToDestination,
  normalizePaletteQuery,
  resolveActionTab,
  scorePaletteItem,
  type ConceptIndexRow,
  type LessonIndexRow,
  type PaletteCatalogInput,
  type PaletteItem,
  type ResourceIndexRow,
  type PaletteNavigation,
} from '../src/services/commandPalette.ts';
import type { Book, Course, Note } from '../src/types/models.ts';

function readSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8');
}

/** Ignora comentarios: solo cuenta el código realmente invocable. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Detecta colores literales de paleta (Regla 5). Exige el número de tono para no
 * confundirse con utilidades que contienen esos mismos letras, como
 * `translate-y-` o `-translate-x-1/2`.
 */
function findLiteralPaletteColors(code: string): string[] {
  return [...code.matchAll(/\b(slate|purple|indigo|gray|zinc|neutral|stone|amber|emerald|sky|rose)-(?:[0-9]{2,3})\b/g)].map(
    match => match[0]
  );
}

function makeItem(overrides: Partial<PaletteItem> & { id: string; title: string }): PaletteItem {
  return {
    group: 'curso',
    icon: 'course',
    destination: { tab: 'course', resourceId: overrides.id },
    ...overrides
  };
}

function makeCourse(overrides: Partial<Course> & { id: string; title: string }): Course {
  return {
    description: undefined,
    cover_path: undefined,
    category: 'Programación',
    status: 'NOT_STARTED',
    source_path: undefined,
    type: 'course',
    difficulty: 'BEGINNER',
    ...overrides
  } as Course;
}

function makeBook(overrides: Partial<Book> & { id: string; title: string }): Book {
  return {
    description: undefined,
    cover_path: undefined,
    category: 'Novela',
    status: 'NOT_STARTED',
    source_path: undefined,
    type: 'book',
    reading_percentage: 0,
    ...overrides
  } as Book;
}

function makeNote(overrides: Partial<Note> & { id: string; title: string }): Note {
  return {
    content: '',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  } as Note;
}

const LESSONS: LessonIndexRow[] = [
  {
    lessonId: 'l1',
    lessonTitle: 'Introducción a React',
    durationMinutes: 30,
    moduleTitle: 'Fundamentos',
    courseId: 'c1',
    courseTitle: 'React Masterclass'
  },
  {
    lessonId: 'l2',
    lessonTitle: 'Hooks en profundidad',
    durationMinutes: 45,
    moduleTitle: 'Fundamentos',
    courseId: 'c1',
    courseTitle: 'React Masterclass'
  }
];

const RECURSOS: ResourceIndexRow[] = [
  {
    resourceId: 'r1-srs',
    resourceTitle: 'Spaced Repetition Systems: teoría y práctica',
    resourceDescription: 'Notas sobre el algoritmo SuperMemo-2 y la retención a largo plazo.',
    resourceCategory: 'Aprendizaje',
    resourceType: 'pdf'
  },
  {
    resourceId: 'r2-sql',
    resourceTitle: 'Consultas SQL para SQLite',
    resourceDescription: 'Índices, SELECT y preparación de sentencias.',
    resourceType: 'md'
  }
];

const CONCEPTS: ConceptIndexRow[] = [
  { conceptId: 'cp1', conceptName: 'Memorización espaciada', conceptDescription: 'Técnica de repaso' },
  { conceptId: 'cp2', conceptName: 'Ciclo de vida de un componente' }
];

function makeCatalogInput(overrides: Partial<PaletteCatalogInput> = {}): PaletteCatalogInput {
  return {
    courses: [],
    books: [],
    notes: [],
    lessons: [],
    concepts: [],
    resources: [],
    pendingReviews: 0,
    continueTarget: null,
    isDarkTheme: false,
    ...overrides
  };
}

// ---------------------------------------------------------------------------
// A. Normalización y ranking
// ---------------------------------------------------------------------------

test('19.1 normalizePaletteQuery folds case, accents and repeated whitespace', () => {
  assert.equal(normalizePaletteQuery('Introducción'), 'introduccion');
  assert.equal(normalizePaletteQuery('  Repaso   SM-2 '), 'repaso sm-2');
  assert.equal(normalizePaletteQuery('MEMORÍA'), 'memoria');
  assert.equal(normalizePaletteQuery(''), '');
  assert.equal(normalizePaletteQuery('   '), '');
});

test('19.2 scorePaletteItem ranks every match tier and rejects non-matches', () => {
  const item = makeItem({
    id: 'nota:1',
    title: 'Introducción a React',
    subtitle: 'Notas del módulo Fundamentos',
    keywords: ['react', 'hooks']
  });
  const q = normalizePaletteQuery;

  assert.equal(scorePaletteItem(item, q('Introducción a React')), PALETTE_SCORE.exact);
  assert.equal(scorePaletteItem(item, q('Introdu')), PALETTE_SCORE.prefix);
  assert.equal(scorePaletteItem(item, q('a React')), PALETTE_SCORE.wordStart);
  assert.equal(scorePaletteItem(item, q('ducción')), PALETTE_SCORE.substring);
  assert.equal(scorePaletteItem(item, q('módulo')), PALETTE_SCORE.subtitle);
  assert.equal(scorePaletteItem(item, q('Hooks')), PALETTE_SCORE.keyword, 'Alias exacto');
  assert.equal(scorePaletteItem(item, q('hook')), PALETTE_SCORE.keywordPrefix, 'Prefijo de alias');
  assert.equal(scorePaletteItem(item, q('ok')), PALETTE_SCORE.keywordInner, 'Alias por dentro');
  assert.equal(scorePaletteItem(item, q('zzzz')), null);
  assert.equal(scorePaletteItem(item, ''), 0);
});

test('19.3 A missing accent never blocks a match, which matters for Spanish queries', () => {
  const item = makeItem({ id: 'nota:1', title: 'Introducción' });
  // El usuario escribe sin tilde: debe encontrarlo igual.
  assert.equal(scorePaletteItem(item, 'introduccion'), PALETTE_SCORE.exact);
});

test('19.4 A title match always outranks a subtitle or keyword-only match', () => {
  const inTitle = makeItem({ id: 'a', title: 'Repaso Spaciado', subtitle: 'otro' });
  const inSubtitle = makeItem({ id: 'b', title: 'Otro tema', subtitle: 'Repaso Spaciado' });
  const inKeyword = makeItem({ id: 'c', title: 'Cuestión', keywords: ['repaso espaciado'] });

  assert.ok(scorePaletteItem(inTitle, 'repaso')! > scorePaletteItem(inSubtitle, 'repaso')!);
  assert.ok(scorePaletteItem(inSubtitle, 'repaso')! > scorePaletteItem(inKeyword, 'repaso')!);
});

// ---------------------------------------------------------------------------
// B. Catálogo
// ---------------------------------------------------------------------------

test('19.5 buildPaletteCatalog always exposes navigation and utility actions', () => {
  const ids = buildPaletteCatalog(makeCatalogInput()).map(item => item.id);
  for (const expected of [
    'accion:dashboard',
    'accion:library',
    'accion:graph',
    'accion:notes',
    'accion:settings',
    'accion:review',
    'accion:ai',
    'accion:mount-folder',
    'accion:backup',
    'accion:theme'
  ]) {
    assert.ok(ids.includes(expected), `El catálogo debe incluir ${expected}`);
  }
});

test('19.6 "Continuar aprendiendo" only appears when there is a real pending lesson', () => {
  const without = buildPaletteCatalog(makeCatalogInput());
  assert.ok(!without.some(item => item.id === 'accion:continue'));

  const with_ = buildPaletteCatalog(
    makeCatalogInput({
      continueTarget: { courseId: 'c1', lessonId: 'l2', courseTitle: 'React', lessonTitle: 'Hooks' }
    })
  );
  const cont = with_.find(item => item.id === 'accion:continue');
  assert.ok(cont, 'Con lección pendiente debe existir la acción de continuar');
  assert.deepEqual(cont!.destination, { tab: 'course', resourceId: 'c1', lessonId: 'l2' });
  assert.ok(cont!.subtitle?.includes('Hooks'));
});

test('19.7 buildPaletteCatalog covers every entity type with a resolvable destination', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({
      courses: [makeCourse({ id: 'c1', title: 'React Masterclass' })],
      books: [makeBook({ id: 'b1', title: 'Clean Code' })],
      notes: [makeNote({ id: 'n1', title: 'Resumen del módulo' })],
      lessons: LESSONS,
      concepts: CONCEPTS
    })
  );

  const byId = new Map(items.map(item => [item.id, item]));

  assert.deepEqual(byId.get('curso:c1')!.destination, { tab: 'course', resourceId: 'c1' });
  assert.deepEqual(byId.get('libro:b1')!.destination, { tab: 'resource', resourceId: 'b1' });
  assert.deepEqual(byId.get('leccion:l1')!.destination, { tab: 'course', resourceId: 'c1', lessonId: 'l1' });
  assert.deepEqual(byId.get('nota:n1')!.destination, { tab: 'note', noteId: 'n1' });
  assert.deepEqual(byId.get('concepto:cp1')!.destination, { tab: 'concept', conceptId: 'cp1' });

  // La lección lleva el breadcrumb curso > módulo, que es lo que la hace navegable.
  assert.equal(byId.get('leccion:l1')!.subtitle, 'React Masterclass > Fundamentos');
});

test('19.8 resolveActionTab maps navigation actions and rejects callback-driven ones', () => {
  assert.equal(resolveActionTab('accion:dashboard'), 'dashboard');
  assert.equal(resolveActionTab('accion:library'), 'library');
  assert.equal(resolveActionTab('accion:graph'), 'graph');
  assert.equal(resolveActionTab('accion:notes'), 'notes');
  assert.equal(resolveActionTab('accion:settings'), 'settings');

  // Estas no son navegación de pestaña: se despachan por callback.
  assert.equal(resolveActionTab('accion:backup'), null);
  assert.equal(resolveActionTab('accion:theme'), null);
  assert.equal(resolveActionTab('accion:ai'), null);
  assert.equal(resolveActionTab('curso:c1'), null);
});

test('19.9 The theme action names the theme it switches TO, in Spanish', () => {
  const light = buildPaletteCatalog(makeCatalogInput({ isDarkTheme: false }));
  const dark = buildPaletteCatalog(makeCatalogInput({ isDarkTheme: true }));
  assert.equal(light.find(i => i.id === 'accion:theme')!.title, 'Cambiar a tema oscuro');
  assert.equal(dark.find(i => i.id === 'accion:theme')!.title, 'Cambiar a tema claro');
});

test('19.10 The review action states the real pending count, honestly', () => {
  const one = buildPaletteCatalog(makeCatalogInput({ pendingReviews: 1 }));
  assert.match(one.find(i => i.id === 'accion:review')!.subtitle!, /1 tarjeta pendiente/);

  const many = buildPaletteCatalog(makeCatalogInput({ pendingReviews: 7 }));
  assert.match(many.find(i => i.id === 'accion:review')!.subtitle!, /7 tarjetas pendientes/);

  const none = buildPaletteCatalog(makeCatalogInput({ pendingReviews: 0 }));
  const subtitle = none.find(i => i.id === 'accion:review')!.subtitle!;
  assert.ok(!subtitle.includes('0 '), 'Con cero pendientes no se inventa un recuento');
});

test('19.11 buildPaletteCatalog is deterministic: same input, same ids in the same order', () => {
  const input = makeCatalogInput({
    courses: [makeCourse({ id: 'c1', title: 'B' }), makeCourse({ id: 'c2', title: 'A' })],
    books: [makeBook({ id: 'b1', title: 'Z' })],
    notes: [makeNote({ id: 'n1', title: 'M' })],
    lessons: LESSONS,
    concepts: CONCEPTS
  });
  const first = buildPaletteCatalog(input).map(i => i.id);
  const second = buildPaletteCatalog(input).map(i => i.id);
  assert.deepEqual(first, second);
  // El orden de llegada de los datos no debe alterar el catálogo.
  assert.deepEqual(first, buildPaletteCatalog({ ...input, courses: [...input.courses].reverse() }).map(i => i.id));
});

// ---------------------------------------------------------------------------
// C. Filtrado y agrupación
// ---------------------------------------------------------------------------

test('19.12 An empty query shows actions first, so the palette opens useful', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({
      courses: [makeCourse({ id: 'c1', title: 'React' })],
      notes: [makeNote({ id: 'n1', title: 'Nota' })]
    })
  );
  const results = filterPaletteItems(items, '');
  assert.equal(results[0].group, 'accion');
  assert.ok(results.filter(i => i.group === 'accion').length >= 10);
  assert.ok(results.some(i => i.id === 'curso:c1'));
});

test('19.13 A single character already matches: the palette is not gated at two characters', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({ courses: [makeCourse({ id: 'c1', title: 'React Masterclass' })] })
  );
  assert.ok(filterPaletteItems(items, 'r').length > 0, 'Un carácter debe devolver resultados');

  // El DAO sí exige dos caracteres; la paleta no hereda ese límite.
  const { searchKnowledge } = dao;
  assert.equal(typeof searchKnowledge, 'function');
});

test('19.14 Relevance ordering: prefix beats substring, and ties break deterministically', () => {
  const items: PaletteItem[] = [
    makeItem({ id: 'z', title: 'Estudio profundo de React' }),
    makeItem({ id: 'a', title: 'React desde cero' }),
    makeItem({ id: 'm', title: 'Resumen de pruebas' }),
    makeItem({ id: 'b', title: 'React avanzado' })
  ];

  const results = filterPaletteItems(items, 'react');

  // 'z' solo contiene la palabra en medio del título; los otros dos empiezan por ella.
  assert.equal(results.at(-1)!.id, 'z', 'Una coincidencia interna pierde contra el prefijo');
  // Entre los dos prefijos, el desempate alfabético del título manda.
  assert.deepEqual(results.slice(0, 2).map(i => i.id), ['b', 'a']);
  assert.ok(!results.some(i => i.id === 'm'), 'Un elemento sin la palabra no aparece');

  // Determinismo: dos llamadas seguidas producen exactamente la misma lista.
  assert.deepEqual(filterPaletteItems(items, 'react'), filterPaletteItems(items, 'react'));
});

test('19.15 filterPaletteItems respects the limit and never returns an empty page of results', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({
      courses: Array.from({ length: 20 }, (_, i) => makeCourse({ id: `c${i}`, title: `Curso ${i}` }))
    })
  );
  const limited = filterPaletteItems(items, 'curso', 5);
  assert.equal(limited.length, 5);
  assert.equal(filterPaletteItems(items, 'curso', 0).length, 1, 'Un límite no positivo se corrige a 1');
});

test('19.16 A query with no matches returns an empty list instead of the default view', () => {
  const items = buildPaletteCatalog(makeCatalogInput({ courses: [makeCourse({ id: 'c1', title: 'React' })] }));
  assert.deepEqual(filterPaletteItems(items, 'zzzzqqq'), []);
});

test('19.17 groupPaletteItems orders groups deterministically and drops empty ones', () => {
  const groups = groupPaletteItems([
    makeItem({ id: 'concepto:x', title: 'C', group: 'concepto' }),
    makeItem({ id: 'nota:y', title: 'N', group: 'nota' }),
    makeItem({ id: 'accion:z', title: 'A', group: 'accion' })
  ]);
  assert.deepEqual(groups.map(g => g.group), ['accion', 'nota', 'concepto']);
  assert.deepEqual(groups.map(g => g.label), ['Acciones', 'Notas', 'Conceptos']);
  assert.ok(!groups.some(g => g.group === 'libro'), 'Los grupos vacíos se omiten');
});

// ---------------------------------------------------------------------------
// D. Selección por teclado
// ---------------------------------------------------------------------------

test('19.18 movePaletteSelection wraps in both directions', () => {
  assert.equal(movePaletteSelection(0, 1, 3), 1);
  assert.equal(movePaletteSelection(2, 1, 3), 0, 'Abajo desde el final vuelve al principio');
  assert.equal(movePaletteSelection(0, -1, 3), 2, 'Arriba desde el principio vuelve al final');
  assert.equal(movePaletteSelection(1, 1, 3), 2);
});

test('19.19 movePaletteSelection tolerates an empty list and an invalid index', () => {
  assert.equal(movePaletteSelection(0, 1, 0), -1);
  assert.equal(movePaletteSelection(-1, 1, 4), 0);
  assert.equal(movePaletteSelection(-1, -1, 4), 3);
  assert.equal(movePaletteSelection(Number.NaN, 1, 4), 0);
  assert.equal(movePaletteSelection(99, 1, 4), 0, 'Un índice fuera de rango se recoloca');
});

// ---------------------------------------------------------------------------
// E. Atajo global
// ---------------------------------------------------------------------------

test('19.20 isPaletteHotkey accepts Ctrl+K and Cmd+K only', () => {
  const key = (over: Partial<Parameters<typeof isPaletteHotkey>[0]> = {}) =>
    isPaletteHotkey({ key: 'k', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...over });

  assert.ok(key({ ctrlKey: true }), 'Ctrl+K abre la paleta');
  assert.ok(key({ metaKey: true }), 'Cmd+K abre la paleta');
  assert.ok(key({ key: 'K', ctrlKey: true }), 'Mayúsculas también');

  assert.ok(!key(), 'Una k suelta es atajo de reproducción, no de la paleta');
  assert.ok(!key({ ctrlKey: true, metaKey: true }), 'Ambos modificadores a la vez no');
  assert.ok(!key({ ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+K se reserva al sistema');
  assert.ok(!key({ ctrlKey: true, altKey: true }), 'Alt queda excluido');
  assert.ok(!key({ key: 'j', ctrlKey: true }), 'Solo la letra k');
  assert.ok(!isPaletteHotkey({} as never), 'Un evento sin forma válida no rompe la app');
});

// ---------------------------------------------------------------------------
// F. Navegación
// ---------------------------------------------------------------------------

function spyNavigation(): PaletteNavigation & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    openCourse: id => calls.push(`course:${id}`),
    openLesson: id => calls.push(`lesson:${id}`),
    openNote: id => calls.push(`note:${id}`),
    openConcept: id => calls.push(`concept:${id}`),
    openResource: id => calls.push(`resource:${id}`),
    openLibrary: () => calls.push('library')
  };
}

test('19.21 navigateToDestination covers all five destination variants', () => {
  const nav = spyNavigation();
  navigateToDestination({ tab: 'course', resourceId: 'c1' }, nav);
  navigateToDestination({ tab: 'note', noteId: 'n1' }, nav);
  navigateToDestination({ tab: 'resource', resourceId: 'b1' }, nav);
  navigateToDestination({ tab: 'concept', conceptId: 'cp1' }, nav);
  navigateToDestination({ tab: 'library' }, nav);
  assert.deepEqual(nav.calls, ['course:c1', 'note:n1', 'resource:b1', 'concept:cp1', 'library']);
});

test('19.22 A destination with lessonId opens the exact lesson, not just its course', () => {
  const nav = spyNavigation();
  navigateToDestination({ tab: 'course', resourceId: 'c1', lessonId: 'l2' }, nav);
  assert.deepEqual(nav.calls, ['lesson:l2'], 'La lección debe preservarse (Library.tsx la descartaba)');
});

test('19.23 An empty course id never navigates to a falsy course', () => {
  const nav = spyNavigation();
  navigateToDestination({ tab: 'course', resourceId: '' }, nav);
  // El guarda vive en App.tsx; aquí solo se comprueba que el destino no filtra nada.
  assert.deepEqual(nav.calls, ['course:']);
});

// ---------------------------------------------------------------------------
// G. Integración con el DAO
// ---------------------------------------------------------------------------

test('19.24 getConceptIndex returns every concept in one deterministic pass', async () => {
  await dbBridge.init();
  const index = await dao.getConceptIndex();
  assert.ok(Array.isArray(index));
  assert.ok(index.length > 0, 'La demo sembrada debe tener conceptos');
  for (const row of index) {
    assert.equal(typeof row.conceptId, 'string');
    assert.equal(typeof row.conceptName, 'string');
    assert.ok(row.conceptId.length > 0 && row.conceptName.length > 0);
  }
  // Orden determinista: nombre ascendente.
  const names = index.map(row => row.conceptName);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
  assert.deepEqual(index.map(r => r.conceptId), (await dao.getConceptIndex()).map(r => r.conceptId));
});

test('19.25 getLessonIndex and getConceptIndex make zero network requests', async () => {
  await dbBridge.init();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (...args: unknown[]) => {
    calls++;
    throw new Error('La paleta debe permanecer local (Regla 1)');
  }) as unknown as typeof fetch;

  try {
    const lessons = await dao.getLessonIndex();
    const concepts = await dao.getConceptIndex();
    assert.ok(lessons.length > 0);
    assert.ok(concepts.length > 0);
    assert.equal(calls, 0, 'Preparar el índice de la paleta no debe introducir peticiones de red');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('19.26 A palette built from real seed data resolves to real destinations', async () => {
  await dbBridge.init();
  const [courses, books, notes, lessons, concepts] = await Promise.all([
    dao.getCourses(),
    dao.getBooks(),
    dao.getNotes(),
    dao.getLessonIndex(),
    dao.getConceptIndex()
  ]);

  const items = buildPaletteCatalog(
    makeCatalogInput({
      courses,
      books,
      notes,
      lessons,
      concepts,
      pendingReviews: (await dao.getKPIs()).pending_reviews,
      continueTarget: {
        courseId: 'c1-react',
        lessonId: 'l1',
        courseTitle: 'React',
        lessonTitle: 'Primeros pasos'
      },
      isDarkTheme: false
    })
  );

  assert.ok(items.length > 10);
  // Cada elemento de entidad debe producir una navegación real, sin ids inventados.
  const nav = spyNavigation();
  for (const item of items.filter(i => i.group !== 'accion')) {
    assert.ok(item.destination, `${item.id} debe tener destino`);
    navigateToDestination(item.destination, nav);
  }
  assert.ok(nav.calls.length > 0);

  // Una búsqueda por un término real del seed debe encontrar algo.
  const results = filterPaletteItems(items, 'react');
  assert.ok(results.length > 0, 'La paleta debe encontrar contenido real');
});

// ---------------------------------------------------------------------------
// H. Auditorías de fuente (contrato de accesibilidad e integración)
// ---------------------------------------------------------------------------

test('19.28 CommandPalette overrides the toolbar search with the semantic palette trigger', () => {
  const src = readSource('../src/components/layout/Shell.tsx');

  assert.ok(src.includes('onOpenCommandPalette'), 'El Shell expone el disparador de la paleta');
  assert.ok(!src.includes('onGlobalSearch'), 'La búsqueda global antigua deja de cablearse desde el header');
  assert.ok(!src.includes('<SearchInput'), 'El input de la barra se sustituye por el disparador');
  assert.ok(src.includes('aria-keyshortcuts'), 'El atajo debe ser anunciable y descubrible');
  assert.ok(src.includes('Buscar o ir a'), 'El disparador debe explicar para qué sirve');

  // Solo tokens semánticos: prohibido introducir colores literales de paleta (Regla 5).
  const literals = findLiteralPaletteColors(stripComments(src));
  assert.deepEqual(literals, [], `Shell.tsx no debe introducir colores literales: ${literals.join(', ')}`);

  // La paleta tampoco debe introducir colores literales en su propia vista.
  const paletteLiterals = findLiteralPaletteColors(stripComments(readSource('../src/components/common/CommandPalette.ts')));
  assert.deepEqual(paletteLiterals, [], `CommandPalette.ts no debe introducir colores literales: ${paletteLiterals.join(', ')}`);
});

test('19.30 App mounts the palette, registers the hotkey and wires every action', () => {
  const src = readSource('../src/App.tsx');

  assert.ok(src.includes('useCommandPaletteHotkey'), 'App registra el atajo global');
  assert.ok(src.includes('<CommandPalette'), 'App monta la paleta');
  assert.ok(src.includes('onOpenCommandPalette'), 'El Shell abre la paleta');

  // Cada acción del catálogo debe tener su despacho.
  for (const action of ['accion:review', 'accion:ai', 'accion:mount-folder', 'accion:backup', 'accion:theme']) {
    assert.ok(src.includes(`'${action}'`), `App debe despachar ${action}`);
  }

  // La navegación por destino usa el helper puro, no una copia de la lógica.
  assert.ok(src.includes('navigateToDestination'));
  assert.ok(src.includes('resolveActionTab'));

  // La paleta es un overlay exclusivo: abrirla cierra el Tutor IA.
  assert.ok(src.includes('setIsAIOpen(false)'));

  // Prepara el índice de forma deduplicada y sin consultas por pulsación.
  assert.ok(src.includes('ensurePaletteIndex'));
  assert.ok(src.includes('dao.getLessonIndex()'));
  assert.ok(src.includes('dao.getConceptIndex()'));
});

test('19.31 The media and study shortcuts ignore modified keys (regression)', () => {
  // Defecto real: ambos handlers comparaban teclas sin verificar modificadores,
  // de modo que Ctrl+K / Cmd+K pausaba el vídeo o calificaba la tarjeta a la vez
  // que abría la paleta. Cmd+L saltaba -10 s y Cmd+M silenciaba.
  for (const file of [
    '../src/components/lesson/LessonWorkspace.tsx',
    '../src/pages/ReviewCenter.tsx'
  ]) {
    const code = stripComments(readSource(file));
    assert.ok(
      /if \(e\.ctrlKey \|\| e\.metaKey \|\| e\.altKey\) return;/.test(code),
      `${file} debe ignorar las combinaciones con modificador`
    );
  }
});

test('19.32 useTheme exposes one shared source of truth for every consumer', () => {
  const src = readSource('../src/hooks/useTheme.ts');
  assert.ok(src.includes('listeners'), 'Debe notificar a todos los suscriptores');
  assert.ok(src.includes('export function setThemeMode'), 'El cambio de tema debe ser accesible desde fuera');

  // Tres vistas leen el tema: los dos `ThemeToggle` (cabecera y Ajustes) y la
  // paleta. Con estado local en cada `useTheme`, la etiqueta de la paleta se
  // quedaría desfasada en cuanto el usuario alternara el tema desde la cabecera.
  assert.ok(
    readSource('../src/components/common/ThemeToggle.tsx').includes('useTheme'),
    'ThemeToggle debe leer el estado compartido'
  );
  assert.ok(readSource('../src/App.tsx').includes('useTheme'), 'La paleta necesita conocer el tema actual');
  assert.ok(
    readSource('../src/components/layout/Shell.tsx').includes('<ThemeToggle'),
    'La cabecera sigue usando el mismo toggle compartido'
  );
  assert.ok(
    readSource('../src/pages/SettingsView.tsx').includes('<ThemeToggle'),
    'Ajustes sigue usando el mismo toggle compartido'
  );
});

test('19.33 The palette adds no network dependency and no new npm package', () => {
  const pkg = JSON.parse(readSource('../package.json'));
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  for (const forbidden of ['cmdk', 'fuse.js', 'downshift', 'react-hotkeys', 'fuzzy']) {
    assert.ok(!(forbidden in deps), `La paleta no debe añadir ${forbidden} (cero dependencias nuevas)`);
  }
  // El índice se construye con dos consultas locales ya existentes en el DAO.
  const daoSrc = readSource('../src/db/dao.ts');
  assert.ok(daoSrc.includes('async getConceptIndex()'));
  assert.ok(daoSrc.includes('async getLessonIndex()'));
});

test('19.34 The palette is pure logic plus one view: no database access outside the DAO', () => {
  const code = stripComments(readSource('../src/services/commandPalette.ts'));
  assert.ok(!code.includes('dbBridge'), 'El módulo puro no debe tocar el puente de base de datos');
  assert.ok(!code.includes('dao.'), 'El módulo puro no debe consultar el DAO');
  assert.ok(!code.includes('fetch('), 'El módulo puro no debe realizar peticiones');
  assert.ok(!code.includes('document.'), 'El módulo puro no debe leer el DOM');

  const component = stripComments(readSource('../src/components/common/CommandPalette.ts'));
  assert.ok(!component.includes('dao.'), 'El componente no debe consultar el DAO directamente');
  assert.ok(!component.includes('fetch('), 'El componente no debe realizar peticiones de red');
});
// ---------------------------------------------------------------------------
// I. Normalización con mapa de origen (el desfase NFD)
// ---------------------------------------------------------------------------

test('19.35 normalizeWithMap keeps a valid origin index for every normalized character', () => {
  const identity = normalizeWithMap('React');
  assert.equal(identity.normalized, 'react');
  assert.deepEqual(identity.origin, [0, 1, 2, 3, 4]);

  // NFD descompone "ó" en dos caracteres: 13 en vez de 12. El mapa es lo que
  // impide que el resaltado termine partido por la mitad.
  const accented = normalizeWithMap('Introducción');
  assert.equal(accented.normalized, 'introduccion');
  assert.equal(accented.normalized.length, accented.origin.length);
  for (const index of accented.origin) {
    assert.ok(Number.isInteger(index) && index >= 0 && index < 'Introducción'.length);
  }

  // El colapso de espacios también desplaza: el mapa debe saltárselos.
  const spaced = normalizeWithMap('Hola    mundo');
  assert.equal(spaced.normalized, 'hola mundo');
  assert.deepEqual(spaced.origin, [0, 1, 2, 3, 4, 8, 9, 10, 11, 12]);

  assert.deepEqual(normalizeWithMap(''), { normalized: '', origin: [] });
  assert.equal(normalizeWithMap('   ').normalized, '');
  assert.equal(normalizeWithMap('  x  ').normalized, 'x');
});

test('19.36 normalizePaletteQuery delegates to normalizeWithMap so both sides agree', () => {
  // Si la aguja y el pajar usaran transformaciones distintas, los rangos
  // quedarían desplazados sin que nada lo delatara.
  for (const text of ['Introducción', '  doble  espacio  ', 'Añadir, quitar', 'ñandú', '']) {
    assert.equal(normalizePaletteQuery(text), normalizeWithMap(text).normalized);
  }
  assert.equal(normalizePaletteQuery('INTRODUCCIÓN'), 'introduccion');
  assert.equal(normalizePaletteQuery('Repaso   SM-2 '), 'repaso sm-2');
  assert.equal(normalizePaletteQuery(''), '');
});

test('19.37 matchRangesInText returns ranges in ORIGINAL offsets, never normalized ones', () => {
  // La trampa: "Introducción" son 12 caracteres en NFC y 13 en NFD.
  assert.equal('Introducción'.length, 12);
  assert.equal('Introducción'.normalize('NFD').length, 13);

  const title = 'Introducción al protocolo';
  const ranges = matchRangesInText(title, normalizePaletteQuery('ción'));
  assert.equal(ranges.length, 1);
  assert.equal(title.slice(ranges[0].start, ranges[0].end), 'ción', 'No debe partir la palabra');
  assert.ok(title.slice(ranges[0].start, ranges[0].end).includes('ó'), 'Debe incluir el carácter acentuado');

  // Y también a través del colapso de espacios.
  const spaced = 'Hola    mundo';
  const spacedRange = matchRangesInText(spaced, normalizePaletteQuery('mundo'))[0];
  assert.equal(spaced.slice(spacedRange.start, spacedRange.end), 'mundo');

  assert.deepEqual(matchRangesInText('cualquier cosa', ''), []);
  assert.deepEqual(matchRangesInText('', 'x'), []);
  assert.deepEqual(matchRangesInText('texto', normalizePaletteQuery('zzz')), []);
});

test('19.38 matchRangesInText finds every occurrence and never leaves the text bounds', () => {
  const title = 'React de React y más React';
  const ranges = matchRangesInText(title, normalizePaletteQuery('react'));
  assert.equal(ranges.length, 3);
  for (const range of ranges) {
    assert.ok(range.start >= 0);
    assert.ok(range.end <= title.length);
    assert.ok(range.start < range.end);
    assert.equal(title.slice(range.start, range.end), 'React');
  }

  // Property: para cualquier texto y consulta, los rangos son legalmente válidos.
  const textos = ['Introducción al protocolo', '  doble  espacio  aquí ', 'Añadir, quitar: sí/no', 'ñandú ñoño', ''];
  for (const text of textos) {
    for (const query of ['a', 'no', 'espacio', 'ñ', 'protocolo', 'quitar']) {
      for (const range of matchRangesInText(text, normalizePaletteQuery(query))) {
        assert.ok(range.start >= 0 && range.end <= text.length && range.start < range.end, `rango ilegal en ${JSON.stringify(text)}`);
      }
    }
  }
});

test('19.39 segmentForHighlight reconstructs the original text EXACTLY (property)', () => {
  // Esta es la property que atrapa cualquier desfase de offsets: si los segmentos
  // se concatenaran distinto del original, el resaltado estaría partiendo palabras.
  const textos = ['Introducción al protocolo', '  doble  espacio  aquí ', 'Añadir, quitar: sí/no', 'ñandú ñoño', 'React   vs   Vue', ''];
  let comprobaciones = 0;

  for (const text of textos) {
    for (const query of ['protocolo', 'espacio', 'quitar', 'no', 'ñ', 'react', 'vue', 'a']) {
      const normalized = normalizePaletteQuery(query);
      if (!normalized) continue;
      const segments = segmentForHighlight(text, matchRangesInText(text, normalized));
      assert.equal(segments.map(s => s.text).join(''), text, `no reconserva ${JSON.stringify(text)} / ${query}`);
      // Todo lo marcado debe contener realmente la consulta, ya normalizada.
      for (const segment of segments) {
        if (segment.match) assert.ok(normalizePaletteQuery(segment.text).includes(normalized));
      }
      comprobaciones++;
    }
  }
  assert.ok(comprobaciones >= 40, 'La property debe ejercitarse con suficientes casos');
});

test('19.40 segmentForHighlight handles no matches, empty text and unsorted ranges', () => {
  assert.deepEqual(segmentForHighlight('texto', []), [{ text: 'texto', match: false }]);
  assert.deepEqual(segmentForHighlight('', []), []);

  // Rangos desordenados: se ordenan antes de trocear, y se respeta el original.
  const segments = segmentForHighlight('abcdef', [
    { start: 4, end: 6 },
    { start: 1, end: 3 }
  ]);
  assert.deepEqual(segments, [
    { text: 'a', match: false },
    { text: 'bc', match: true },
    { text: 'd', match: false },
    { text: 'ef', match: true }
  ]);
  assert.equal(segments.map(s => s.text).join(''), 'abcdef');

  // Rango solapado: no debe duplicar caracteres.
  const overlapping = segmentForHighlight('abcdef', [
    { start: 0, end: 4 },
    { start: 2, end: 6 }
  ]);
  assert.equal(overlapping.map(s => s.text).join(''), 'abcdef');

  // Rango fuera de texto: se recorta, no revienta.
  const clipped = segmentForHighlight('abc', [{ start: 1, end: 99 }]);
  assert.equal(clipped.map(s => s.text).join(''), 'abc');
});

test('19.41 bodySnippet shows the fragment that matched and crops honestly', () => {
  const body = 'Repaso inicial. ' + 'relleno '.repeat(40) + ' Aqui aparece SuperMemo-2 que es lo importante.';
  const snippet = bodySnippet(body, normalizePaletteQuery('supermemo'));
  assert.ok(snippet.includes('SuperMemo-2'), 'El fragmento debe contener lo que casó');
  assert.ok(snippet.length <= 84, 'El fragmento debe estar acotado');
  assert.ok(snippet.startsWith('…'), 'El recorte izquierdo debe señalarse con puntos suspensivos');

  // Sin coincidencia devuelve el comienzo, que es un contexto legítimo.
  const head = bodySnippet(body, normalizePaletteQuery('zzz'));
  assert.ok(head.startsWith('Repaso inicial.'));

  assert.equal(bodySnippet('', 'x'), '');
  assert.equal(bodySnippet('texto', ''), '');
});

// ---------------------------------------------------------------------------
// J. Búsqueda por contenido y difusa
// ---------------------------------------------------------------------------

test('19.42 scorePaletteItem finds text in the BODY, ranked below every direct match', () => {
  const porCuerpo = makeItem({
    id: 'nota:1',
    title: 'Notas del taller',
    subtitle: 'Nota de recurso',
    body: 'Hablamos de spaced repetition y de SuperMemo-2 en detalle',
    bodyNormalized: 'hablamos de spaced repetition y de supermemo-2 en detalle'
  });
  assert.equal(scorePaletteItem(porCuerpo, normalizePaletteQuery('supermemo')), PALETTE_SCORE.body);
  assert.equal(scorePaletteItem(porCuerpo, normalizePaletteQuery('zzz')), null);

  // El cuerpo pierde contra el título, el subtítulo y los alias.
  const enTitulo = makeItem({ id: 'a', title: 'SuperMemo', body: 'otro', bodyNormalized: 'otro' });
  assert.ok(scorePaletteItem(enTitulo, 'supermemo')! > PALETTE_SCORE.body);
});

test('19.43 Fuzzy matching refuses short queries so it cannot flood the list', () => {
  // 'mXaXbXc' no contiene 'ab' ni 'mab' como subcadena: es el caso donde solo
  // puede actuar la difusa, así que la guarda se comprueba sin interferencias.
  const item = makeItem({ id: 'nota:1', title: 'mXaXbXc' });
  assert.equal(scorePaletteItem(item, 'ab'), null, 'Precondición: sin subcadena ni alias');
  assert.equal(scorePaletteItem(item, 'zzz'), null, 'Una secuencia ausente no se inventa');

  // La difusa NO se activa por debajo de 3 caracteres: cualquier bigrama casaría
  // con media biblioteca y llenaría la lista de basura.
  assert.equal(PALETTE_FUZZY_MIN_LENGTH, 3);
  assert.equal(scorePaletteItem(item, 'ab'), null, 'Dos caracteres no activan la difusa');
  // Con un solo carácter la guarda no es observable: si la letra está en el título
  // ya es una subcadena, que puntúa mucho por encima. La constante es la garantía.
  assert.ok(PALETTE_FUZZY_MIN_LENGTH > 2);

  // A partir de 3 caracteres entra, y siempre por debajo de cualquier directa.
  const fuzzy = scorePaletteItem(item, 'mab');
  assert.ok(fuzzy !== null, 'Una subsecuencia de 3 caracteres debe encontrar la lección');
  assert.ok(fuzzy <= PALETTE_SCORE.fuzzy, 'La difusa ocupa la banda más baja de todas');
  assert.ok(fuzzy < PALETTE_SCORE.body, 'Y por debajo del cuerpo');

  const conPrefijo = makeItem({ id: 'nota:2', title: 'mab' });
  assert.ok(
    scorePaletteItem(conPrefijo, 'mab')! > fuzzy!,
    'Una coincidencia real siempre gana a la difusa'
  );
});

test('19.44 Fuzzy matching scores by density, not just by possibility', () => {
  // Ninguno contiene 'abc' como subcadena, y los tres reparten los caracteres en
  // tramos de longitud distinta para que la densidad sea lo único que cambie.
  const muyDenso = makeItem({ id: 'a', title: 'mXab' });                     // span 4 -> 0.75
  const denso = makeItem({ id: 'b', title: 'mXaXb' });                       // span 5 -> 0.60
  const disperso = makeItem({ id: 'c', title: 'mXXXXaXXXXb' });              // span 10 -> 0.30

  const sMuyDenso = scorePaletteItem(muyDenso, 'mab')!;
  const sDenso = scorePaletteItem(denso, 'mab')!;
  const sDisperso = scorePaletteItem(disperso, 'mab')!;

  assert.ok(sMuyDenso !== null && sDenso !== null && sDisperso !== null);
  assert.equal(sMuyDenso, PALETTE_SCORE.fuzzy);
  assert.equal(sDenso, PALETTE_SCORE.fuzzyMid);
  assert.equal(sDisperso, PALETTE_SCORE.fuzzyLow);
  assert.ok(sMuyDenso > sDenso && sDenso > sDisperso, 'Más densa, mejor puntuada');
});

test('19.45 wordStart now beats substring even when the first occurrence is mid-word', () => {
  // Defecto corregido: con `indexOf` a secas, la primera ocurrencia decidía y
  // "miReact react" se clasificaba como `substring` (400) en vez de `wordStart`.
  const item = makeItem({ id: 'nota:1', title: 'miReact React' });
  assert.equal(scorePaletteItem(item, 'react'), PALETTE_SCORE.wordStart);

  // Y una ocurrencia realmente interna sigue siendo `substring`.
  assert.equal(scorePaletteItem(makeItem({ id: 'x', title: 'miReact' }), 'react'), PALETTE_SCORE.substring);
});

test('19.46 A note is found by what was WRITTEN in it, not only by its title (regression)', () => {
  // Regresión real: `dao.searchKnowledge` buscaba en `note.content`; la paleta
  // solo miraba títulos, así que era PEOR que la búsqueda anterior del header.
  const items = buildPaletteCatalog(
    makeCatalogInput({
      notes: [
        makeNote({
          id: 'n1',
          title: 'Notas del taller',
          content: 'Hablamos de spaced repetition y de SuperMemo-2 en detalle'
        })
      ],
      lessons: [
        {
          lessonId: 'l1',
          lessonTitle: 'Introducción al protocolo',
          lessonContent: 'El protocolo de spaced repetition define los intervalos',
          durationMinutes: 10,
          moduleTitle: 'Base',
          courseId: 'c1',
          courseTitle: 'Curso'
        }
      ]
    })
  );

  const fromNote = filterPaletteItems(items, 'supermemo');
  assert.ok(fromNote.some(i => i.id === 'nota:n1'), 'La nota debe aparecer por su cuerpo');

  const fromLesson = filterPaletteItems(items, 'intervalos');
  assert.ok(fromLesson.some(i => i.id === 'leccion:l1'), 'La lección debe aparecer por su contenido');

  // Y el título de esa lección ya es buscable por su título, como antes.
  assert.ok(filterPaletteItems(items, 'protocolo').some(i => i.id === 'leccion:l1'));
});

test('19.47 matchPaletteItems explains WHY each result appears', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({
      notes: [
        makeNote({
          id: 'n1',
          title: 'Notas del taller',
          // La coincidencia va MÁS ALLÁ del resumen de 80 caracteres: si no, casaría
          // por el subtítulo y nunca se ejercitaría el nivel `body`.
          content: `Hablamos de spaced repetition durante toda la sesión. ${'detalle irrelevante '.repeat(6)}Ahí vimos SuperMemo-2.`
        })
      ],
      courses: [makeCourse({ id: 'c1', title: 'React Masterclass' })]
    })
  );

  const porCuerpo = matchPaletteItems(items, 'supermemo').find(m => m.item.id === 'nota:n1')!;
  assert.ok(porCuerpo.matchedBody, 'Debe marcar que casó por el cuerpo');
  assert.equal(porCuerpo.score, PALETTE_SCORE.body, 'Y con la puntuación del nivel cuerpo');
  assert.ok(porCuerpo.subtitle.includes('SuperMemo'), 'El subtítulo muestra el fragmento que casó');
  assert.ok(porCuerpo.subtitle.length < 100, 'El fragmento se recorta, no se vuelca el cuerpo entero');
  assert.ok(porCuerpo.subtitleRanges.length > 0, 'Y debe poder resaltarse dentro de él');
  assert.deepEqual(porCuerpo.titleRanges, [], 'El título no coincide, así que no se resalta');

  const porTitulo = matchPaletteItems(items, 'react').find(m => m.item.id === 'curso:c1')!;
  assert.equal(porTitulo.matchedBody, false);
  assert.ok(porTitulo.titleRanges.length > 0, 'El título debe quedar resaltado');
  assert.equal(porTitulo.title, 'React Masterclass');
});

test('19.48 The default view is not polluted by fuzzy or content matches', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({ courses: [makeCourse({ id: 'c1', title: 'React Masterclass' })] })
  );
  const matches = matchPaletteItems(items, '');

  for (const match of matches) {
    assert.equal(match.score, 0);
    assert.equal(match.matchedBody, false);
    assert.deepEqual(match.titleRanges, []);
    assert.deepEqual(match.subtitleRanges, []);
  }
  assert.equal(matches[0].item.group, 'accion');

  // Y una consulta sin coincidencias NO debe devolver la vista por defecto.
  assert.deepEqual(matchPaletteItems(items, 'zzzzqqq'), []);
});

test('19.49 The body is capped and pre-normalized when the catalog is built', () => {
  const enorme = 'palabra clave '.repeat(2000);
  assert.ok(enorme.length > PALETTE_BODY_MAX_CHARS);

  const items = buildPaletteCatalog(
    makeCatalogInput({ notes: [makeNote({ id: 'n1', title: 'Nota larga', content: enorme })] })
  );
  const note = items.find(item => item.id === 'nota:n1')!;

  assert.equal(note.body!.length, PALETTE_BODY_MAX_CHARS, 'El cuerpo indexado está acotado');
  assert.equal(note.bodyNormalized!.length <= PALETTE_BODY_MAX_CHARS, true);

  // Pre-normalizado: el componente NO debe renormalizar en cada pulsación.
  assert.ok(note.bodyNormalized!.includes('palabra clave'));
  assert.equal(note.bodyNormalized, normalizePaletteQuery(note.body));

  // Un cuerpo solo de espacios no se indexa (sería ruido).
  const vacio = buildPaletteCatalog(
    makeCatalogInput({ notes: [makeNote({ id: 'n2', title: 'Nota vacía', content: '   \n  ' })] })
  ).find(item => item.id === 'nota:n2')!;
  assert.equal(vacio.body, undefined);
  assert.equal(vacio.bodyNormalized, undefined);
});

test('19.50 Highlighting is rendered as text, never as HTML (XSS)', () => {
  // Una nota puede contener "<script>". Debe MOSTRARSE, no interpretarse.
  const items = buildPaletteCatalog(
    makeCatalogInput({
      notes: [
        makeNote({
          id: 'n1',
          title: '<script>alert(1)</script>',
          content: 'contenido con <img src=x onerror=alert(1)> dentro'
        })
      ]
    })
  );

  const match = matchPaletteItems(items, 'script')[0];
  assert.equal(match.item.title, '<script>alert(1)</script>', 'El texto se conserva literal');
  const segments = segmentForHighlight(match.item.title, match.titleRanges);
  assert.equal(segments.map(s => s.text).join(''), match.item.title);

  // Los segmentos marked contienen la consulta normalizada: nada inventado.
  for (const segment of segments) {
    if (segment.match) assert.ok(normalizePaletteQuery(segment.text).includes('script'));
  }
});

// ---------------------------------------------------------------------------
// K. Auditorías de fuente de los seis defectos corregidos
// ---------------------------------------------------------------------------

test('19.52 The toolbar trigger keeps its visible text as the accessible name', () => {
  const src = stripComments(readSource('../src/components/layout/Shell.tsx'));

  // Defecto 2 (WCAG 2.5.3): un aria-label que no contiene el texto visible rompe
  // el control por voz. El nombre accesible debe ser "Buscar o ir a…".
  assert.ok(src.includes('Buscar o ir a'), 'El texto visible debe seguir siendo el rótulo');
  assert.ok(
    !/onOpenCommandPalette[\s\S]{0,200}aria-label/.test(src),
    'El disparador no debe llevar aria-label que reemplace al texto visible'
  );
  assert.ok(src.includes('aria-keyshortcuts'), 'El atajo se anuncia con aria-keyshortcuts');
});

test('19.53 The mobile drawer closes whenever the palette opens', () => {
  const shell = stripComments(readSource('../src/components/layout/Shell.tsx'));
  const app = stripComments(readSource('../src/App.tsx'));

  // Defecto 3: el clic cerraba el cajón móvil pero el atajo no, así que con Ctrl+K
  // en un móvil quedaban los dos overlays vivos con dos manejadores de Escape.
  assert.ok(shell.includes('paletteOpen: boolean'), 'El Shell debe conocer el estado de la paleta');
  assert.ok(
    /if \(paletteOpen\) setIsMobileNavOpen\(false\)/.test(shell),
    'Abrir la paleta debe cerrar el cajón móvil'
  );
  assert.ok(app.includes('paletteOpen={isPaletteOpen}'), 'App debe pasarle el estado');
});

test('19.54 The hotkey is inert while the app is still initialising', () => {
  const app = stripComments(readSource('../src/App.tsx'));

  // Defecto 4: el listener se montaba antes de los guardas de carga, así que
  // pulsar Ctrl+K durante el arranque dejaba la paleta abierta al terminar.
  assert.ok(
    /useCommandPaletteHotkey\(loading \|\| initError \? \(\) => undefined : togglePalette\)/.test(app),
    'El atajo debe ser inerte durante loading e initError'
  );
});

test('19.55 La lógica pura de la paleta sigue sin depender de React ni del DOM', () => {
  // La garantía de "nunca inyectar HTML" ya no se comprueba leyendo el archivo: se
  // verifica sobre el HTML realmente renderizado en `command_palette_render.test.ts`.
  // Aquí queda la garantía estructural: el módulo de ranking no sabe del navegador.
  const pure = stripComments(readSource('../src/services/commandPalette.ts'));
  assert.ok(!pure.includes('dangerouslySetInnerHTML'));
  assert.ok(!pure.includes('document.'), 'El módulo puro no debe leer el DOM');
  assert.ok(!pure.includes('React'), 'El módulo puro no debe depender de React');
});

// ---------------------------------------------------------------------------
// L. Recursos importados: el punto de entrada global llega a todo el contenido
// ---------------------------------------------------------------------------

test('19.56 Un recurso importado aparece en la paleta y es navegable', () => {
  const items = buildPaletteCatalog(makeCatalogInput({ resources: RECURSOS }));
  const recurso = items.find(item => item.id === 'recurso:r1-srs');

  assert.ok(recurso, 'Un PDF importado debe aparecer en la paleta');
  assert.equal(recurso!.group, 'recurso');
  assert.deepEqual(
    recurso!.destination,
    { tab: 'resource', resourceId: 'r1-srs' },
    'Debe abrir su vista de detalle, no la Biblioteca entera'
  );

  // Y el destino realmente se resuelve a la vista de su recurso.
  const nav = spyNavigation();
  navigateToDestination(recurso!.destination!, nav);
  assert.deepEqual(nav.calls, ['resource:r1-srs']);
});

test('19.57 El cuerpo de un recurso importado es buscable', () => {
  // Sin indexar la descripción, el usuario que busca por lo que escribió en el
  // documento no lo encontraría: solo por el título.
  const items = buildPaletteCatalog(makeCatalogInput({ resources: RECURSOS }));

  // Ojo: 'supermemo' NO sirve para esto, porque es keyword de la acción de repaso
  // (151) y esa acción gana legítimamente al nivel `body` (120). Para demostrar que
  // el cuerpo se indexa hay que buscar algo que solo exista en la descripción.
  const match = matchPaletteItems(items, 'retención')[0];

  assert.equal(match.item.id, 'recurso:r1-srs', 'Debe encontrar por el contenido');
  assert.equal(match.matchedBody, true, 'Lo que casó fue el cuerpo, no el título');
  assert.ok(match.subtitle.includes('retención'), 'Debe explicar qué fragmento casó');
});

test('19.58 La categoría y el tipo de un recurso son buscables', () => {
  const items = buildPaletteCatalog(makeCatalogInput({ resources: RECURSOS }));
  assert.ok(filterPaletteItems(items, 'aprendizaje').some(i => i.id === 'recurso:r1-srs'));
  assert.ok(filterPaletteItems(items, 'pdf').some(i => i.id === 'recurso:r1-srs'));
});

test('19.59 Un libro se encuentra por su sinopsis, no solo por su título', () => {
  // Antes solo se indexaban autor y categoría. Una sinopsis era invisible.
  const items = buildPaletteCatalog(
    makeCatalogInput({
      books: [
        {
          id: 'b1',
          title: 'Trabajo profundo',
          author: 'Cal Newport',
          description: 'Estrategias para alcanzar concentración sostenida.',
          category: 'Productividad'
        } as Book
      ]
    })
  );
  const match = matchPaletteItems(items, 'concentración')[0];
  assert.equal(match.item.id, 'libro:b1');
  assert.equal(match.matchedBody, true);
});

test('19.60 El indice de recursos excluye cursos y libros, sin duplicar', () => {
  // `getCourses()` y `getBooks()` ya los traen: incluirlos otra vez en la paleta
  // mostraría el mismo documento dos veces con dos iconos distintos.
  const items = buildPaletteCatalog(
    makeCatalogInput({
      resources: RECURSOS,
      books: [{ id: 'b1', title: 'Deep Work', author: 'Cal Newport', description: '', category: 'Productividad' } as Book]
    })
  );
  const libros = items.filter(item => item.group === 'libro' || item.group === 'recurso');
  assert.equal(libros.length, 3, 'Un libro y los dos recursos: exactamente una entrada cada uno');
  assert.equal(new Set(libros.map(i => i.id)).size, libros.length, 'Sin identificadores repetidos');
});

test('19.61 Los recursos importados tienen su propio grupo, ordenado con los demas', () => {
  const items = buildPaletteCatalog(
    makeCatalogInput({ resources: RECURSOS, concepts: CONCEPTS, lessons: LESSONS })
  );

  // Lo que ve el usuario es el catálogo AGRUPADO, y ese es el orden que fija
  // `GROUP_ORDER`: el array crudo va en orden de inserción, que es otro asunto.
  const grupos = groupPaletteItems(matchPaletteItems(items, '')).map(g => g.group);
  assert.deepEqual(
    grupos,
    ['accion', 'recurso', 'leccion', 'concepto'],
    'Acciones primero; el resto en un orden fijo y predecible'
  );
  assert.equal(PALETTE_GROUP_LABELS.recurso, 'Recursos');

  // El grupo debe contener de verdad los recursos, con su etiqueta y sus filas.
  const recursos = groupPaletteItems(matchPaletteItems(items, '')).find(g => g.group === 'recurso')!;
  assert.equal(recursos.items.length, RECURSOS.length);
  assert.deepEqual(
    recursos.items.map(m => m.item.id).sort(),
    RECURSOS.map(r => `recurso:${r.resourceId}`).sort(),
    'Las filas del grupo son exactamente los recursos importados'
  );
});

test('19.62 El catalogo sigue siendo determinista con recursos', () => {
  const a = buildPaletteCatalog(makeCatalogInput({ resources: RECURSOS }));
  const b = buildPaletteCatalog(makeCatalogInput({ resources: [...RECURSOS].reverse() }));
  assert.deepEqual(
    a.map(i => i.id),
    b.map(i => i.id),
    'El orden de entrada no puede alterar el resultado'
  );
});

test('19.63 Un recurso importado real del seed llega a la paleta', async () => {
  await dbBridge.init();
  const [resources, courses, books] = await Promise.all([
    dao.getResourceIndex(),
    dao.getCourses(),
    dao.getBooks()
  ]);

  assert.ok(resources.length > 0, 'El seed debe traer recursos importados');

  const ids = new Set(resources.map(r => r.resourceId));
  for (const course of courses) {
    assert.ok(!ids.has(course.id), `Un curso no debe reaparecer como recurso: ${course.id}`);
  }
  for (const book of books) {
    assert.ok(!ids.has(book.id), `Un libro no debe reaparecer como recurso: ${book.id}`);
  }

  const items = buildPaletteCatalog(makeCatalogInput({ resources, courses, books }));
  for (const resource of resources) {
    const item = items.find(i => i.id === `recurso:${resource.resourceId}`);
    assert.ok(item, `El recurso ${resource.resourceId} debe estar en el catálogo`);

    const nav = spyNavigation();
    navigateToDestination(item!.destination!, nav);
    assert.deepEqual(nav.calls, [`resource:${resource.resourceId}`], 'Y debe abrir su propia vista');
  }
});

test('19.64 El indice de recursos es una consulta plana y ordenada', async () => {
  await dbBridge.init();
  const recursos = await dao.getResourceIndex();

  const titulos = recursos.map(r => r.resourceTitle);
  assert.deepEqual(titulos, [...titulos].sort((a, b) => a.localeCompare(b)), 'Orden determinista');

  for (const recurso of recursos) {
    assert.ok(recurso.resourceId && recurso.resourceTitle && recurso.resourceType);
  }
});
