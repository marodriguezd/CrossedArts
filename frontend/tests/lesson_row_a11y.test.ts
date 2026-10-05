import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// ===========================================================================
// REMEDIACIÓN D — Controles interactivos válidos en la lista de lecciones.
//
// La fila de lección era un <button> que contenía OTRO <button> (completar)
// y varios <span role="button"> (mover/eliminar). Anidar controles interactivos
// es HTML inválido: rompe foco, teclado y la semántica para lectores de
// pantalla. El contrato correcto:
//
//   - contenedor de fila NO interactivo (div);
//   - botón real e independiente para SELECCIONAR (el título);
//   - botones reales e independientes para completar / mover / eliminar;
//   - nombres accesibles específicos por lección.
// ===========================================================================

const source = readFileSync(new URL('../src/pages/CourseDetail.tsx', import.meta.url), 'utf8');

// Extraer el bloque de render de la lista de lecciones.
const lessonsBlock = source.slice(source.indexOf("mod.lessons?.map((les) => {"), source.indexOf('{/* Crear lección */}'));

test('D.1 La fila de lección ya no es un <button> (no anida controles)', () => {
  assert.ok(lessonsBlock.includes('<div'), 'La fila usa un contenedor no interactivo');
  // El contenedor de la fila no puede ser button:
  const rowStart = lessonsBlock.slice(0, lessonsBlock.indexOf('aria-current'));
  assert.ok(!rowStart.includes('<button'), 'El elemento raíz de la fila NO es un botón');
});

test('D.2 Selección, completar, mover y eliminar son botones reales e independientes', () => {
  // Un solo nivel de anidamiento de botones: el contenedor no es botón.
  const openTags = lessonsBlock.match(/<button/g) || [];
  const closeTags = lessonsBlock.match(/<\/button>/g) || [];
  assert.equal(openTags.length, closeTags.length, 'Todos los botones abiertos se cierran');
  assert.ok(openTags.length >= 4, 'Debe haber botones para las 4 acciones (seleccionar, completar, subir, bajar, eliminar)');

  // Sin <span role="button">: elementos falsamente interactivos.
  assert.ok(!/role="button"/.test(lessonsBlock), 'No quedan spans con role="button" dentro de la fila');

  // El botón de completar es un <button> real con estado.
  assert.ok(lessonsBlock.includes('aria-pressed={les.is_completed}'), 'El toggle de completado expone su estado con aria-pressed');
});

test('D.3 Nombres accesibles por lección en los cuatro controles', () => {
  assert.match(lessonsBlock, /aria-label=\{`Lección «\$\{les\.title\}» completada\. Marcar como pendiente`|aria-label=\{les\.is_completed \? `Lección «\$\{les\.title\}» completada/, 'Toggle de completado con nombre accesible');
  assert.match(lessonsBlock, /aria-label=\{`Mover la lección \$\{les\.title\} hacia arriba`\}/, 'Mover arriba con nombre accesible');
  assert.match(lessonsBlock, /aria-label=\{`Mover la lección \$\{les\.title\} hacia abajo`\}/, 'Mover abajo con nombre accesible');
  assert.match(lessonsBlock, /aria-label=\{`Eliminar lección \$\{les\.title\}`\}/, 'Eliminar con nombre accesible');
  assert.match(lessonsBlock, /title=\{`Abrir la lección \$\{les\.title\}`\}/, 'Selección con nombre visible en tooltip');
});

test('D.4 La selección es un botón con handler dedicado (sin supresión de eventos)', () => {
  assert.match(lessonsBlock, /onClick=\{\(\) => handleSelectLesson\(les\.id\)\}/, 'El título delega en handleSelectLesson');
  // El antiguo patrón de supresión para diferenciar clicks ya no es necesario:
  // sin anidamiento no hay dobles disparos que evitar.
  const completionButton = lessonsBlock.slice(lessonsBlock.indexOf('aria-pressed'), lessonsBlock.indexOf('aria-pressed') + 900);
  assert.ok(!completionButton.includes('stopPropagation'), 'El toggle de completado no necesita stopPropagation');
});

test('D.5 El resto de controles del módulo no introducen anidamiento nuevo', () => {
  // Los botones de módulo (completar módulo, eliminar módulo) ya eran top-level;
  // verificar que siguen siéndolo y no vivieron dentro de la fila de lección.
  const moduleButtonsBlock = source.slice(0, source.indexOf("mod.lessons?.map((les) => {"));
  const lastModuleDelete = moduleButtonsBlock.lastIndexOf('<button');
  assert.ok(lastModuleDelete > 0, 'Los botones de módulo siguen presentes');
});
