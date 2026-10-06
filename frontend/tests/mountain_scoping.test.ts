import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MOUNTAIN_MILESTONES,
  MOUNTAIN_TRAIL,
  computeOverallProgress,
  deriveStagesFromModules,
  pointAtPercent,
  resolveMilestones
} from '../src/services/mountainPath.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const done = { is_completed: true };
const pending = { is_completed: false };

/* -------------------------------------------------------------------------- */
/* 33.x — Hitos derivados de la estructura REAL                                */
/* -------------------------------------------------------------------------- */

test('33.1 no lessons means no invented stages', () => {
  assert.deepEqual(deriveStagesFromModules([]), []);
  assert.deepEqual(deriveStagesFromModules([{ title: 'Módulo vacío', lessons: [] }]), []);
  assert.deepEqual(deriveStagesFromModules([{ title: 'Sin lecciones' }]), []);
});

test('33.2 each module ends at its cumulative lesson boundary', () => {
  const stages = deriveStagesFromModules([
    { title: 'Fundamentos', lessons: [done, pending] },
    { title: 'Práctica', lessons: [pending, pending] }
  ]);

  assert.deepEqual(stages, [
    { percent: 0, label: 'Inicio' },
    { percent: 50, label: 'Fundamentos' },
    { percent: 100, label: 'Práctica' }
  ]);

  // Los tramos son proporcionales al nº de lecciones, no al nº de módulos.
  const uneven = deriveStagesFromModules([
    { title: 'Corto', lessons: [pending] },
    { title: 'Largo', lessons: [pending, pending, pending] },
    { title: 'Último', lessons: [pending] }
  ]);
  assert.deepEqual(uneven.map((s) => s.percent), [0, 20, 80, 100]);
});

test('33.3 module labels are trimmed and truncated, never dropped', () => {
  const longTitle = '   Un módulo con un título extraordinariamente largo que no cabe   ';
  const stages = deriveStagesFromModules([{ title: longTitle, lessons: [pending] }], 20);
  assert.equal(stages[1].label.length <= 20, true, 'La etiqueta larga debe acortarse');
  assert.ok(stages[1].label.startsWith('Un módulo con un t'));
  assert.ok(stages[1].label.endsWith('…'));

  const short = deriveStagesFromModules([{ title: '  Corto  ', lessons: [pending] }]);
  assert.equal(short[1].label, 'Corto', 'El título se recorta en los extremos');
});

test('33.4 resolveMilestones honours custom stages and their boundaries', () => {
  const stages = deriveStagesFromModules([
    { title: 'A', lessons: [pending, pending] },
    { title: 'B', lessons: [pending, pending] }
  ]);

  const atZero = resolveMilestones(0, stages);
  assert.equal(atZero.find((m) => m.percent === 0)?.reached, true);
  assert.equal(atZero.find((m) => m.percent === 50)?.reached, false);

  const half = resolveMilestones(50, stages);
  assert.equal(half.find((m) => m.percent === 50)?.reached, true);
  assert.equal(half.find((m) => m.label === 'B')?.reached, false);

  assert.ok(resolveMilestones(100, stages).every((m) => m.reached));
});

test('33.5 the default global milestones are preserved when no structure is provided', () => {
  assert.deepEqual(MOUNTAIN_MILESTONES.map((m) => m.percent), [0, 25, 50, 75, 100]);
  const fallback = resolveMilestones(40);
  assert.equal(fallback.length, MOUNTAIN_MILESTONES.length);
  assert.equal(fallback.find((m) => m.percent === 25)?.reached, true);
  assert.equal(fallback.find((m) => m.percent === 50)?.reached, false);
});

test('33.6 a scoped mountain reuses exactly the same trail mathematics', () => {
  // El curso al 40% debe colocar el marcador donde lo pondría la biblioteca al 40%:
  // hay una sola implementación del sendero, no una por ámbito.
  const globalMarker = pointAtPercent(MOUNTAIN_TRAIL, 40);
  const scopedMarker = pointAtPercent(MOUNTAIN_TRAIL, computeOverallProgress([{ percent: 40 }]));
  assert.deepEqual(scopedMarker, globalMarker);
  assert.equal(computeOverallProgress([{ percent: 40 }]), 40);
  assert.equal(computeOverallProgress([{ percent: 150 }]), 100, 'Se acota, no se desborda');
});

/* -------------------------------------------------------------------------- */
/* 33.x — Integración en las vistas                                            */
/* -------------------------------------------------------------------------- */

test('33.7 MountainProgress accepts a scoped progress, custom stages and an accessible scope', () => {
  const source = readSource('../src/components/dashboard/MountainProgress.tsx');
  assert.ok(source.includes('stages'), 'La vista debe aceptar hitos propios');
  assert.ok(source.includes('scopeLabel'), 'La etiqueta accesible debe poder describir el ámbito');
  assert.ok(source.includes('progressOverride'), 'Debe poder recibir un progreso ya calculado');
  assert.ok(source.includes('Hitos del camino'), 'Los hitos siguen disponibles en texto (no solo en SVG)');
  assert.ok(source.includes('role="img"') && source.includes('aria-label'), 'El SVG sigue siendo accesible');
});

test('33.8 the course view renders the scoped mountain with real modules as milestones', () => {
  const source = readSource('../src/pages/CourseDetail.tsx');
  assert.ok(source.includes('MountainProgress'), 'El detalle de curso debe montar la vista de montaña');
  assert.ok(source.includes('deriveStagesFromModules'), 'Los hitos deben venir de los módulos reales');
  assert.ok(source.includes('stages={courseStages}'), 'Debe pasar los hitos derivados');
  assert.ok(source.includes('progress={coursePercentValue}'), 'Debe pasar el progreso real del curso');
});
