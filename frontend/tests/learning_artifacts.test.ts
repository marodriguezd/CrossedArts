import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { Book, Course, LearningResource, PracticeWork } from '../src/types/models.ts';
import {
  ARTIFACT_ID_PREFIX,
  ARTIFACT_KIND_LABELS,
  buildGalleryItems,
  galleryStatusOfPracticeWork,
  groupGalleryItems,
  statusPercent,
  type GalleryItem
} from '../src/services/galleryItems.ts';

const readSource = (relative: string): string =>
  readFileSync(new URL(relative, import.meta.url), 'utf8');

const course = (overrides: Partial<Course> = {}): Course => ({
  id: 'c1',
  title: 'Curso de prueba',
  category: 'Programación',
  status: 'IN_PROGRESS',
  type: 'course',
  difficulty: 'BEGINNER',
  completed_lessons: 3,
  total_lessons: 6,
  ...overrides
});

const book = (overrides: Partial<Book> = {}): Book => ({
  id: 'b1',
  title: 'Libro de prueba',
  category: 'Aprendizaje',
  status: 'IN_PROGRESS',
  type: 'book',
  reading_percentage: 40,
  page_count: 100,
  current_page: 40,
  ...overrides
});

const resource = (overrides: Partial<LearningResource> = {}): LearningResource => ({
  id: 'r1',
  title: 'Documento importado',
  category: 'Documentos',
  status: 'NOT_STARTED',
  type: 'learning_resource',
  ...overrides
});

const practice = (overrides: Partial<PracticeWork> = {}): PracticeWork => ({
  id: 'p1',
  title: 'Resolver ejercicios',
  kind: 'exercise',
  status: 'IN_PROGRESS',
  ...overrides
});

/* -------------------------------------------------------------------------- */
/* 31.x — Proyección de artefactos                                             */
/* -------------------------------------------------------------------------- */

test('31.1 every artifact kind has a Spanish label and an id prefix', () => {
  const kinds = Object.keys(ARTIFACT_KIND_LABELS) as Array<keyof typeof ARTIFACT_KIND_LABELS>;
  assert.deepEqual(kinds.sort(), ['book', 'course', 'practice', 'resource']);
  for (const kind of kinds) {
    assert.ok(ARTIFACT_KIND_LABELS[kind].length > 0, `Falta la etiqueta de ${kind}`);
    assert.ok(ARTIFACT_ID_PREFIX[kind].endsWith(':'), `El prefijo de ${kind} debe terminar en ':'`);
  }
});

test('31.2 practice work and imported resources are projected to the same shape', () => {
  const items = buildGalleryItems([course()], [book()], {
    resources: [resource()],
    practiceWork: [practice(), practice({ id: 'p2', kind: 'essay', status: 'DONE' })]
  });

  const resourceItem = items.find((item) => item.id === 'resource:r1');
  assert.ok(resourceItem, 'El recurso importado debe proyectarse');
  assert.equal(resourceItem!.kind, 'resource');
  assert.equal(resourceItem!.progressSource, 'status');

  const practiceItems = items.filter((item) => item.kind === 'practice');
  assert.equal(practiceItems.length, 2);
  const done = practiceItems.find((item) => item.id === 'practice:p2');
  assert.ok(done);
  assert.equal(done!.status, 'COMPLETED');
  assert.equal(done!.meta, 'Ensayo', 'El metadato muestra el tipo de artefacto');
  assert.equal(done!.coverPath, undefined);
});

test('31.3 imported resources never duplicate courses or books already projected', () => {
  const items = buildGalleryItems([course({ id: 'c1' })], [book({ id: 'b1' })], {
    resources: [
      resource({ id: 'c1', type: 'course' }),
      resource({ id: 'b1', type: 'book' }),
      resource({ id: 'r2', type: 'learning_resource' })
    ]
  });
  assert.equal(items.filter((item) => item.id === 'course:c1').length, 1);
  assert.equal(items.filter((item) => item.id === 'book:b1').length, 1);
  assert.equal(items.filter((item) => item.kind === 'resource').length, 1);
});

test('31.4 status-based progress never pretends to be a measured percentage', () => {
  // El curso y el libro son medidas reales (lecciones/páginas).
  const measured = buildGalleryItems([course()], [book()]);
  for (const item of measured) {
    assert.equal(item.progressSource, 'measured');
  }
  assert.equal(measured.find((i) => i.id === 'course:c1')!.progress, 50);
  assert.equal(measured.find((i) => i.id === 'book:b1')!.progress, 40);

  // Los artefactos sin porcentaje real se marcan como `status`.
  const notMeasured = buildGalleryItems([], [], {
    resources: [resource({ status: 'COMPLETED' })],
    practiceWork: [practice({ status: 'PLANNED' })]
  });
  for (const item of notMeasured) {
    assert.equal(item.progressSource, 'status');
  }
});

test('31.5 statusPercent and galleryStatusOfPracticeWork are explicit and bounded', () => {
  assert.equal(statusPercent('NOT_STARTED'), 0);
  assert.equal(statusPercent('IN_PROGRESS'), 50);
  assert.equal(statusPercent('COMPLETED'), 100);
  assert.equal(statusPercent(undefined), 0);

  assert.equal(galleryStatusOfPracticeWork('PLANNED'), 'NOT_STARTED');
  assert.equal(galleryStatusOfPracticeWork('IN_PROGRESS'), 'IN_PROGRESS');
  assert.equal(galleryStatusOfPracticeWork('DONE'), 'COMPLETED');
});

test('31.6 groupGalleryItems partitions every item into exactly one section', () => {
  const items: GalleryItem[] = [
    { id: 'course:c1', title: 'C', kind: 'course', kindLabel: 'Curso', progress: 10, progressSource: 'measured', status: 'IN_PROGRESS' },
    { id: 'course:c2', title: 'C2', kind: 'course', kindLabel: 'Curso', progress: 100, progressSource: 'measured', status: 'COMPLETED' },
    { id: 'book:b1', title: 'B', kind: 'book', kindLabel: 'Libro', progress: 0, progressSource: 'measured', status: 'NOT_STARTED' },
    { id: 'resource:r1', title: 'R', kind: 'resource', kindLabel: 'Recurso', progress: 0, progressSource: 'status', status: 'NOT_STARTED' },
    { id: 'practice:p1', title: 'P', kind: 'practice', kindLabel: 'Trabajo práctico', progress: 50, progressSource: 'status', status: 'IN_PROGRESS' }
  ];

  const { continueLearning, resources, practice: practiceSection, completed } = groupGalleryItems(items);
  assert.deepEqual(continueLearning.map((i) => i.id), ['course:c1', 'book:b1']);
  assert.deepEqual(resources.map((i) => i.id), ['resource:r1']);
  assert.deepEqual(practiceSection.map((i) => i.id), ['practice:p1']);
  assert.deepEqual(completed.map((i) => i.id), ['course:c2']);

  const total = continueLearning.length + resources.length + practiceSection.length + completed.length;
  assert.equal(total, items.length, 'Ningún artefacto se pierde ni se duplica entre secciones');
});

test('31.7 empty inputs stay empty and never fabricate placeholders', () => {
  assert.deepEqual(buildGalleryItems([], [], {}), []);
  const sections = groupGalleryItems([]);
  assert.equal(sections.continueLearning.length + sections.resources.length + sections.practice.length + sections.completed.length, 0);
});

/* -------------------------------------------------------------------------- */
/* 31.x — Panel: la galería representa los artefactos reales                   */
/* -------------------------------------------------------------------------- */

test('31.8 the Dashboard builds its gallery from the shared projection and groups it', () => {
  const dashboard = readSource('../src/pages/Dashboard.tsx');
  assert.ok(dashboard.includes('buildGalleryItems'), 'Debe usar la proyección compartida');
  assert.ok(dashboard.includes('groupGalleryItems'), 'Debe agrupar en secciones en lugar de volcar una lista');
  assert.ok(dashboard.includes('practiceWork'), 'La galería debe incluir el trabajo práctico');
  assert.ok(dashboard.includes('Trabajo práctico'), 'Debe existir una sección de trabajo práctico');
  assert.ok(dashboard.includes('Recursos importados'), 'Debe existir una sección de recursos importados');
  assert.ok(dashboard.includes('Continúa aprendiendo'), 'Debe existir la sección principal de continuación');
});

test('31.9 the gallery is rendered before the metrics strip (visual first)', () => {
  const dashboard = readSource('../src/pages/Dashboard.tsx');
  const galleryIndex = dashboard.indexOf('title="Continúa aprendiendo"');
  const metricsIndex = dashboard.indexOf('Recursos totales');
  assert.ok(galleryIndex > 0 && metricsIndex > 0);
  assert.ok(
    galleryIndex < metricsIndex,
    'La galería visual debe aparecer antes que la franja de métricas'
  );
});

test('31.10 the gallery card renders a status instead of a fake percentage', () => {
  const gallery = readSource('../src/components/dashboard/ResourceGallery.tsx');
  assert.ok(gallery.includes('progressSource'), 'La tarjeta debe conocer el origen del progreso');
  assert.ok(gallery.includes('ClipboardList'), 'Debe existir un tratamiento propio para el trabajo práctico');
  assert.ok(
    !/\bslate-\d/.test(gallery) && !/#[0-9a-fA-F]{3,6}\b/.test(gallery),
    'Sin paletas literales ni colores hexadecimales'
  );
});
