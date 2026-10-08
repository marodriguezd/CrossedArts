import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { ProgressBar, resolveProgress, type ProgressBarProps } from '../src/components/ui/primitives.ts';

const render = (props: ProgressBarProps): string => renderToStaticMarkup(createElement(ProgressBar, props));

/* -------------------------------------------------------------------------- */
/* ProgressBar: el valor ARIA y el visual salen de la MISMA fuente acotada     */
/* -------------------------------------------------------------------------- */

test('36.1 ProgressBar acota aria-valuenow al rango visual (sin ARIA contradictoria)', () => {
  const over = render({ value: 150, max: 100, label: 'Progreso' });
  assert.match(over, /aria-valuenow="100"/, 'Un valor por encima del máximo se acota');
  assert.match(over, /aria-valuemax="100"/);
  assert.match(over, /width:100%/, 'El ancho visible coincide con el valor anunciado');

  const under = render({ value: -20, max: 100, label: 'Progreso' });
  assert.match(under, /aria-valuenow="0"/, 'Un valor negativo se acota a 0');
  assert.match(under, /width:0%/);
});

test('36.2 ProgressBar mantiene la proporción cuando el máximo no es 100', () => {
  const half = render({ value: 30, max: 60, label: 'Progreso' });
  assert.match(half, /aria-valuenow="30"/);
  assert.match(half, /aria-valuemax="60"/);
  assert.match(half, /width:50%/, 'El porcentaje visual deriva del mismo valor acotado');
});

test('36.3 resolveProgress es puro y maneja valores inválidos de forma determinista', () => {
  assert.deepEqual(resolveProgress(Number.NaN, 100), { value: 0, max: 100, percent: 0 });
  assert.deepEqual(resolveProgress(50, 0), { value: 50, max: 100, percent: 50 });
  assert.deepEqual(resolveProgress(10, 10), { value: 10, max: 10, percent: 100 });
  assert.deepEqual(resolveProgress(Number.POSITIVE_INFINITY, 100), { value: 0, max: 100, percent: 0 });
});

test('36.4 toda barra de progreso expone nombre y rango completos', () => {
  const html = render({ value: 5, label: 'Avance del curso' });
  assert.match(html, /role="progressbar"/);
  assert.match(html, /aria-label="Avance del curso"/);
  assert.match(html, /aria-valuemin="0"/);
  assert.match(html, /aria-valuemax="100"/);
  assert.match(html, /aria-valuenow="5"/);
});

/* -------------------------------------------------------------------------- */
/* Shell: salto al contenido y diálogo móvil con foco confinado                */
/* -------------------------------------------------------------------------- */

test('36.5 el shell ofrece salto al contenido principal', () => {
  const source = readFileSync(new URL('../src/components/layout/Shell.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('href="#main-content"'), 'Debe existir un enlace "Saltar al contenido principal"');
  assert.ok(source.includes('id="main-content"'), 'El destino del salto debe existir en el DOM');
  assert.ok(source.includes('Saltar al contenido principal'), 'El enlace debe tener texto visible al enfocarse');
});

test('36.6 el cajón de navegación móvil atrapa el foco, cierra con Escape y lo restaura', () => {
  const source = readFileSync(new URL('../src/components/layout/Shell.tsx', import.meta.url), 'utf8');
  assert.ok(source.includes('role="dialog"') && source.includes('aria-modal="true"'), 'Es un diálogo modal');
  assert.ok(source.includes("e.key === 'Escape'"), 'Escape cierra el cajón');
  assert.ok(source.includes('mobileNavRef'), 'El árbol del cajón se referencia para confinar el foco');
  assert.ok(source.includes("e.key !== 'Tab'"), 'La tecla Tab se intercepta dentro del cajón');
  assert.ok(source.includes('previouslyFocused?.focus'), 'El foco se devuelve al disparador al cerrar');
  assert.ok(source.includes('aria-controls="mobile-nav"'), 'El disparador declara el diálogo que controla');
});
