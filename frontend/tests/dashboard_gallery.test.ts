import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOUNTAIN_TRAIL,
  clampPercent,
  computeOverallProgress,
  distanceBetween,
  pointAtFraction,
  pointAtPercent,
  resolveMilestones,
  toPolylinePoints,
  trailLength
} from '../src/services/mountainPath.ts';
import {
  bookPercent,
  buildGalleryItems,
  coursePercent,
  resourceInitials,
  resourceStatusRank,
  sortGalleryItems,
  type GalleryItem
} from '../src/services/galleryItems.ts';

/* -------------------------------------------------------------------------- */
/* 27.x — Sendero de la montaña (matemática pura, sin DOM)                     */
/* -------------------------------------------------------------------------- */

test('27.1 pointAtFraction hits both endpoints exactly', () => {
  const start = pointAtFraction(MOUNTAIN_TRAIL, 0);
  const end = pointAtFraction(MOUNTAIN_TRAIL, 1);

  assert.deepEqual(start, { ...MOUNTAIN_TRAIL[0] });
  assert.deepEqual(end, { ...MOUNTAIN_TRAIL[MOUNTAIN_TRAIL.length - 1] });
});

test('27.2 pointAtFraction clamps out-of-range and non-finite fractions', () => {
  const below = pointAtFraction(MOUNTAIN_TRAIL, -5);
  const above = pointAtFraction(MOUNTAIN_TRAIL, 9);
  const nan = pointAtFraction(MOUNTAIN_TRAIL, Number.NaN);

  assert.deepEqual(below, { ...MOUNTAIN_TRAIL[0] });
  assert.deepEqual(above, { ...MOUNTAIN_TRAIL[MOUNTAIN_TRAIL.length - 1] });
  assert.deepEqual(nan, { ...MOUNTAIN_TRAIL[0] }, 'NaN nunca debe producir coordenadas NaN');
});

test('27.3 the marker ascends monotonically as progress grows', () => {
  const heights = [0, 25, 50, 75, 100].map((p) => pointAtPercent(MOUNTAIN_TRAIL, p).y);
  for (let i = 1; i < heights.length; i += 1) {
    assert.ok(
      heights[i] <= heights[i - 1],
      `El marcador no debe bajar: ${heights[i - 1]} -> ${heights[i]}`
    );
  }
  assert.ok(heights[0] > heights[heights.length - 1], 'La cima debe estar más arriba (y menor)');
});

test('27.4 pointAtPercent handles a single-point trail without dividing by zero', () => {
  const single = [{ x: 10, y: 20 }];
  assert.deepEqual(pointAtFraction(single, 0.5), { x: 10, y: 20 });
  assert.deepEqual(pointAtFraction([], 0.5), { x: 0, y: 0 });
});

test('27.5 trailLength equals the sum of its segments', () => {
  const expected = MOUNTAIN_TRAIL.slice(1).reduce(
    (sum, point, index) => sum + distanceBetween(MOUNTAIN_TRAIL[index], point),
    0
  );
  assert.equal(trailLength(MOUNTAIN_TRAIL), expected);
  assert.ok(trailLength(MOUNTAIN_TRAIL) > 0);
});

test('27.6 clampPercent guards out-of-range and non-finite values', () => {
  assert.equal(clampPercent(-10), 0);
  assert.equal(clampPercent(150), 100);
  assert.equal(clampPercent(42.5), 42.5);
  assert.equal(clampPercent(Number.NaN), 0);
  assert.equal(clampPercent(Number.POSITIVE_INFINITY), 0);
});

test('27.7 resolveMilestones marks hitos at their exact boundary', () => {
  const atZero = resolveMilestones(0);
  assert.equal(atZero.find((m) => m.percent === 0)?.reached, true);
  assert.equal(atZero.find((m) => m.percent === 25)?.reached, false);

  const atTwentyFive = resolveMilestones(25);
  assert.equal(atTwentyFive.find((m) => m.percent === 25)?.reached, true);
  assert.equal(atTwentyFive.find((m) => m.percent === 50)?.reached, false);

  assert.ok(resolveMilestones(100).every((m) => m.reached));
});

test('27.8 computeOverallProgress averages real data and never divides by zero', () => {
  assert.equal(computeOverallProgress([]), 0);
  assert.equal(computeOverallProgress([{ percent: 0 }]), 0);
  assert.equal(computeOverallProgress([{ percent: 100 }, { percent: 0 }]), 50);
  assert.equal(computeOverallProgress([{ percent: 30 }, { percent: 60 }, { percent: 90 }]), 60);
  // Los valores fuera de rango se acotan antes de promediar.
  assert.equal(computeOverallProgress([{ percent: 500 }]), 100);
});

test('27.9 toPolylinePoints emits the SVG points attribute format', () => {
  assert.equal(toPolylinePoints([{ x: 1, y: 2 }, { x: 3, y: 4 }]), '1,2 3,4');
});

/* -------------------------------------------------------------------------- */
/* 27.x — Galería: normalización agnóstica al dominio                          */
/* -------------------------------------------------------------------------- */

test('27.10 resourceInitials ignores stop-words, punctuation and caps at two letters', () => {
  assert.equal(resourceInitials('The Pragmatic Programmer'), 'PP');
  assert.equal(resourceInitials('Deep Work'), 'DW');
  assert.equal(resourceInitials('Bases de Datos Relacionales'), 'BD');
  assert.equal(resourceInitials('Arte'), 'A');
  assert.equal(resourceInitials('   '), '·');
  assert.equal(resourceInitials('la de el'), 'LD', 'Si todo son palabras vacías, cae a las dos primeras reales');
  assert.equal(resourceInitials('C++ para Gráficos'), 'CG');
});

test('27.11 coursePercent and bookPercent are safe with missing/negative data', () => {
  assert.equal(coursePercent({ completed_lessons: 3, total_lessons: 6 }), 50);
  assert.equal(coursePercent({ completed_lessons: 1, total_lessons: 0 }), 0);
  assert.equal(coursePercent({ completed_lessons: undefined, total_lessons: undefined }), 0);
  assert.equal(bookPercent({ reading_percentage: 34.8 }), 35);
  assert.equal(bookPercent({ reading_percentage: -3 }), 0);
  assert.equal(bookPercent({ reading_percentage: 120 }), 100);
});

test('27.12 resourceStatusRank orders attention: in-progress, not-started, completed', () => {
  assert.ok(resourceStatusRank('IN_PROGRESS') < resourceStatusRank('NOT_STARTED'));
  assert.ok(resourceStatusRank('NOT_STARTED') < resourceStatusRank('COMPLETED'));
  assert.equal(resourceStatusRank(undefined), resourceStatusRank('COMPLETED'));
});

test('27.13 sortGalleryItems is stable within each status group', () => {
  const items: GalleryItem[] = [
    { id: 'a', title: 'A', kindLabel: 'Curso', progress: 0, status: 'COMPLETED' },
    { id: 'b', title: 'B', kindLabel: 'Curso', progress: 0, status: 'IN_PROGRESS' },
    { id: 'c', title: 'C', kindLabel: 'Libro', progress: 0, status: 'IN_PROGRESS' },
    { id: 'd', title: 'D', kindLabel: 'Libro', progress: 0, status: 'NOT_STARTED' }
  ];

  const sorted = sortGalleryItems(items);
  assert.deepEqual(sorted.map((item) => item.id), ['b', 'c', 'd', 'a']);
});

test('27.14 buildGalleryItems normalizes courses and books to one shared shape', () => {
  const items = buildGalleryItems(
    [
      {
        id: 'c1',
        title: 'Curso de Prueba',
        category: 'Programación',
        status: 'IN_PROGRESS',
        type: 'course',
        difficulty: 'BEGINNER',
        completed_lessons: 5,
        total_lessons: 10
      }
    ],
    [
      {
        id: 'b1',
        title: 'Libro de Prueba',
        category: 'Aprendizaje',
        status: 'NOT_STARTED',
        type: 'book',
        reading_percentage: 20,
        page_count: 100,
        current_page: 20
      }
    ]
  );

  const course = items.find((item) => item.id === 'course:c1');
  const book = items.find((item) => item.id === 'book:b1');

  assert.ok(course && book);
  assert.equal(course!.kindLabel, 'Curso');
  assert.equal(course!.progress, 50);
  assert.equal(course!.meta, '5/10 lecciones');
  assert.equal(book!.kindLabel, 'Libro');
  assert.equal(book!.progress, 20);
  assert.equal(book!.meta, 'Pág. 20/100');
  // El orden por atención pone el curso en progreso por delante del libro sin empezar.
  assert.deepEqual(items.map((item) => item.id), ['course:c1', 'book:b1']);
});

test('27.15 buildGalleryItems is empty-safe', () => {
  assert.deepEqual(buildGalleryItems([], []), []);
});

/* -------------------------------------------------------------------------- */
/* 27.x — Integración en el panel y disciplina de estilos                      */
/* -------------------------------------------------------------------------- */

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

test('27.16 the Dashboard renders the gallery and the mountain progress view', () => {
  const source = readSource('../src/pages/Dashboard.tsx');
  assert.ok(source.includes('ResourceGallery'), 'El panel debe montar la galería visual');
  assert.ok(source.includes('MountainProgress'), 'El panel debe montar la vista de montaña');
  assert.ok(source.includes('buildGalleryItems'), 'La galería debe usar la normalización compartida');
});

test('27.17 the new dashboard components use only semantic tokens (no literal palettes)', () => {
  const files = [
    '../src/components/dashboard/ResourceGallery.tsx',
    '../src/components/dashboard/MountainProgress.tsx'
  ];
  for (const file of files) {
    const source = readSource(file);
    assert.ok(
      !/\bslate-\d/.test(source) && !/\bpurple-\d/.test(source) && !/\bindigo-\d/.test(source),
      `${file} no debe usar paletas literales de Tailwind`
    );
    assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(source), `${file} no debe usar colores hexadecimales`);
  }
});

test('27.18 the mountain view exposes an accessible description and text milestones', () => {
  const source = readSource('../src/components/dashboard/MountainProgress.tsx');
  assert.ok(source.includes('role="img"'), 'El SVG debe tener rol de imagen');
  assert.ok(source.includes('aria-label'), 'El SVG debe describir el progreso');
  assert.ok(source.includes('Hitos del camino'), 'Los hitos deben estar también en texto');
});

test('27.19 gallery cards are real buttons with effective accessible names', () => {
  const source = readSource('../src/components/dashboard/ResourceGallery.tsx');
  assert.ok(source.includes('type="button"'), 'Cada tarjeta debe ser un botón real');
  assert.ok(source.includes('aria-label'), 'Cada tarjeta debe tener nombre accesible');
  assert.ok(source.includes('ProgressBar'), 'El progreso debe reutilizar la primitiva accesible');
});
