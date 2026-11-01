/**
 * Bloque 8 — contratos de la UI (ARIA real, capas de overlay y hora local).
 *
 * Numeración propia del bloque (37.x) para no chocar con 36.x, que cubre las
 * primitivas de progreso y el shell.
 *
 * Lo que estos tests SÍ prueban y lo que no:
 *  - `renderToStaticMarkup` (react-dom/server) da salida renderizada real, así
 *    que 37.1 verifica el DOM resultante, no el código fuente.
 *  - El proyecto no tiene DOM (jsdom no está instalado y no se añade por un
 *    test), así que la resolución de referencias ARIA y la de capas se
 *    comprueban sobre la ESTRUCTURA de las fuentes: qué id declara un fichero y
 *    a qué referencia apunta. Es una comprobación de resolución, no un
 *    `includes('aria-controls="x"')` sobre una cadena concreta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SectionHeading } from '../src/components/ui/primitives.ts';
import { formatLocalClockTime } from '../src/services/localDate.ts';
import {
  getOverlayStack,
  isTopOverlay,
  pushOverlay,
  removeOverlay,
  resetOverlayStack,
  type OverlayId
} from '../src/services/overlayStack.ts';

const SRC = new URL('../src/', import.meta.url);

function readSource(relative: string): string {
  return readFileSync(new URL(relative, SRC), 'utf8');
}

function uiFiles(): string[] {
  const dir = fileURLToPath(SRC);
  const out: string[] = [];
  const walk = (path: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.tsx?$/.test(entry.name)) out.push(child);
    }
  };
  walk(join(dir, 'components'));
  walk(join(dir, 'pages'));
  return out;
}

/* -------------------------------------------------------------------------- */
/* 37.1 SectionHeading expone el id que sus secciones necesitan                */
/* -------------------------------------------------------------------------- */

test('37.1 SectionHeading pone el id en el encabezado renderizado (no sólo lo acepta)', () => {
  const html = renderToStaticMarkup(
    createElement(SectionHeading, { id: 'settings-storage', title: 'Almacenamiento y respaldos' })
  );
  assert.match(html, /<h2 id="settings-storage"/, 'El id viaja al <h2>, que es el destino de aria-labelledby');

  const sinId = renderToStaticMarkup(createElement(SectionHeading, { title: 'Apariencia' }));
  assert.match(sinId, /<h2 class=/, 'Sin id el encabezado sigue renderizándose igual');
  assert.ok(!sinId.includes('id='), 'Sin id no se emite un id vacío');
});

/* -------------------------------------------------------------------------- */
/* 37.2 Toda referencia ARIA resuelve a un id declarado en su fichero          */
/* -------------------------------------------------------------------------- */

const ARIA_REF_RE = /aria-(?:controls|labelledby|describedby|activedescendant|owns)=\{?["'`]([^"'`}]*)\}?/g;
const ARIA_IDENT_RE = /aria-(?:controls|labelledby|describedby|activedescendant|owns)=\{[A-Za-z_$]/g;
const ID_STATIC_RE = /id=\{?["'`]([^"'`}]+)["'`]?\}?/g;

/**
 * Quita comentarios antes de analizar: un docblock que EXPLICA `aria-labelledby`
 * no es una referencia real, y contarla produciría un fallo fantasma (y silenciar
 * el análisis una excusa para esconder referencias reales dentro de código).
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function referencesIn(text: string): string[] {
  const refs: string[] = [];
  for (const match of stripComments(text).matchAll(ARIA_REF_RE)) {
    refs.push(match[1]);
  }
  return refs;
}

function idsIn(text: string): string[] {
  const ids: string[] = [];
  for (const match of stripComments(text).matchAll(ID_STATIC_RE)) {
    ids.push(match[1]);
  }
  return ids;
}

test('37.2 ninguna referencia ARIA de components/ o pages/ apunta a un id inexistente', () => {
  const unresolved: string[] = [];
  let checked = 0;
  let declaredIds = 0;

  for (const file of uiFiles()) {
    const text = readFileSync(file, 'utf8');
    const ids = idsIn(text);
    declaredIds += ids.length;
    const prefixIds = ids.filter((id) => id.includes('${'));

    for (const ref of referencesIn(text)) {
      checked += 1;
      if (!ref) continue; // `aria-labelledby=""` es una referencia vacía: no resuelve, pero no es un id perdido
      const resolvesStatic = ids.includes(ref);
      const resolvesByPrefix = prefixIds.some((id) => id.split('${')[0] === ref.split('${')[0]);
      if (!resolvesStatic && !resolvesByPrefix) {
        unresolved.push(`${file.slice(file.indexOf('/src/') + 5)} → aria-*="${ref}"`);
      }
    }
  }

  // Sin estas dos comprobaciones el test podría pasar por no encontrar nada.
  assert.ok(checked >= 12, `Se esperaban varias referencias ARIA; se encontraron ${checked}`);
  assert.ok(declaredIds >= 20, `Se esperaban ids declarados en la UI; se encontraron ${declaredIds}`);

  assert.deepEqual(
    unresolved,
    [],
    `Referencias ARIA sin destino:\n  ${unresolved.join('\n  ')}`
  );
});

test('37.2b las referencias dinámicas (por variable) se reconocen y no cuentan como resueltas por texto', () => {
  const count = (text: string) => [...text.matchAll(ARIA_IDENT_RE)].length;
  assert.equal(count('<div aria-labelledby={titleId} />'), 1);
  assert.equal(count('<div aria-labelledby="title-id" />'), 0);
  assert.equal(referencesIn('/* aria-controls="solo-en-un-comentario" */').length, 0, 'Un comentario no es una referencia');
  assert.equal(idsIn("// id=\"tampoco\"").length, 0, 'Un id comentado no existe');
});

/* -------------------------------------------------------------------------- */
/* 37.3 Capas: el cajón de IA vive por debajo de los diálogos modales          */
/* -------------------------------------------------------------------------- */

function layerOf(text: string, pattern: RegExp): number[] {
  return [...text.matchAll(pattern)].map((match) => Number(match[1]));
}

const DIALOG_FILES: Array<[string, string]> = [
  ['pages/Library.tsx', 'los tres diálogos de Biblioteca'],
  ['pages/KnowledgeGraph.tsx', 'el diálogo de conexiones del grafo'],
  ['components/study/FlashcardGenerationModal.tsx', 'el modal de generación de tarjetas'],
  ['components/study/ImageOcclusionEditor.tsx', 'el editor de oclusión']
];

test('37.3 todo diálogo modal de página queda por encima del cajón de IA', () => {
  const drawer = layerOf(readSource('components/ai/AIAssistantDrawer.tsx'), /right-0 z-\[?(\d+)\]?/g);
  assert.equal(drawer.length, 1, 'El cajón debe declarar una única capa');
  const drawerLayer = drawer[0];

  for (const [file, label] of DIALOG_FILES) {
    const layers = layerOf(readSource(file), /fixed inset-0 z-\[?(\d+)\]?/g);
    assert.ok(layers.length > 0, `${label}: no se encontró su capa modal en ${file}`);
    for (const layer of layers) {
      assert.ok(
        layer > drawerLayer,
        `${label} (${file}): capa ${layer} no supera la del cajón de IA (${drawerLayer}); sus botones quedarían tapados`
      );
    }
  }
});

test('37.3b el orden documentado de capas se respeta: cajón < diálogos < confirmación < palette', () => {
  const drawer = layerOf(readSource('components/ai/AIAssistantDrawer.tsx'), /right-0 z-\[?(\d+)\]?/g)[0];
  const confirm = layerOf(readSource('components/common/ConfirmDialog.tsx'), /fixed inset-0 z-\[?(\d+)\]?/g)[0];
  const palette = layerOf(readSource('components/common/CommandPalette.ts'), /fixed inset-0 z-\[?(\d+)\]?/g)[0];
  const dialogLayers = DIALOG_FILES.flatMap(([file]) => layerOf(readSource(file), /fixed inset-0 z-\[?(\d+)\]?/g));

  assert.ok(confirm > Math.max(...dialogLayers), 'Una confirmación siempre va por encima del diálogo que la abre');
  assert.ok(palette > confirm, 'El palette es la capa superior');
  assert.ok(drawer < Math.min(...dialogLayers));
});

/* -------------------------------------------------------------------------- */
/* 37.4 Hora local: 24 h fijas, nunca el locale del navegador                  */
/* -------------------------------------------------------------------------- */

test('37.4 formatLocalClockTime usa 24 h y no depende del locale del navegador', () => {
  const midnight = new Date(2026, 9, 27, 0, 0, 0);
  assert.equal(formatLocalClockTime(midnight), '00:00:00', 'Medianoche es 00:00:00, nunca 24:00:00');

  const afternoon = new Date(2026, 9, 27, 18, 27, 1);
  assert.equal(formatLocalClockTime(afternoon), '18:27:01');

  const formatted = formatLocalClockTime(Date.UTC(2026, 9, 27, 6, 5, 4));
  assert.match(formatted, /^\d{2}:\d{2}:\d{2}$/, 'Formato HH:MM:SS sin sufijo de meridiano');
  assert.ok(!/AM|PM/i.test(formatted), 'La salida no puede llevar AM/PM en un equipo en inglés');

  assert.equal(formatLocalClockTime('no-es-una-fecha'), '', 'Un instante inválido no inventa una hora');
});

test('37.4b Ajustes formatea la persistencia con el helper local, no con el locale del navegador', () => {
  const source = readSource('pages/SettingsView.tsx');
  assert.match(source, /import \{ formatLocalClockTime \} from '\.\.\/services\/localDate\.ts'/, 'Usa el helper compartido');
  assert.match(source, /formatLocalClockTime\(storageReport\.lastPersistedTimestamp\)/);
  assert.doesNotMatch(
    source,
    /toLocaleTimeString\(\s*\)/,
    'Un toLocaleTimeString() sin locale lo resuelve el navegador y rompe el formato español'
  );
});

/* -------------------------------------------------------------------------- */
/* 37.5 Registro de overlays: sólo el de arriba responde a Escape              */
/* -------------------------------------------------------------------------- */

test('37.5 el registro de overlays respeta el orden de apertura', () => {
  resetOverlayStack();
  pushOverlay('ai-drawer');
  assert.equal(isTopOverlay('ai-drawer'), true);
  assert.equal(isTopOverlay('confirm-dialog'), false, 'Un overlay que no está abierto nunca es el de arriba');

  pushOverlay('confirm-dialog');
  assert.equal(isTopOverlay('confirm-dialog'), true);
  assert.equal(isTopOverlay('ai-drawer'), false, 'Con la confirmación encima, el cajón ya no responde');
  assert.deepEqual(getOverlayStack(), ['ai-drawer', 'confirm-dialog']);

  removeOverlay('confirm-dialog');
  assert.equal(isTopOverlay('ai-drawer'), true, 'Al cerrarse el de arriba, el de abajo vuelve a responder');
  removeOverlay('ai-drawer');
  assert.deepEqual(getOverlayStack(), []);
  assert.equal(isTopOverlay('ai-drawer'), false);
});

test('37.5b dos instancias del mismo overlay se apilan por apertura y salen en orden inverso', () => {
  resetOverlayStack();
  const nested = 'confirm-dialog' as const;
  pushOverlay(nested);
  pushOverlay('ai-drawer');
  pushOverlay(nested);
  assert.deepEqual(getOverlayStack(), [nested, 'ai-drawer', nested], 'La instancia recién abierta va arriba');
  assert.equal(isTopOverlay(nested), true, 'La instancia nueva responde, aunque su tipo ya estuviera abierto');

  removeOverlay(nested);
  assert.deepEqual(getOverlayStack(), [nested, 'ai-drawer'], 'Se retira la instancia más reciente, no la de abajo');
  assert.equal(isTopOverlay('ai-drawer'), true);
  assert.equal(isTopOverlay(nested), false, 'La instancia antigua sigue viva pero ya no está arriba');

  removeOverlay(nested);
  assert.deepEqual(getOverlayStack(), ['ai-drawer']);
  removeOverlay('ai-drawer');
  resetOverlayStack();
  assert.deepEqual(getOverlayStack(), []);
});

/* -------------------------------------------------------------------------- */
/* 37.6 Cableado: cada overlay se registra y consulta si está arriba           */
/* -------------------------------------------------------------------------- */

const OVERLAY_OWNERS: Array<[string, OverlayId]> = [
  ['components/ai/AIAssistantDrawer.tsx', 'ai-drawer'],
  ['components/common/ConfirmDialog.tsx', 'confirm-dialog'],
  ['components/common/CommandPalette.ts', 'command-palette'],
  ['pages/Library.tsx', 'library-dialogs'],
  ['pages/KnowledgeGraph.tsx', 'graph-connection-dialog'],
  ['components/study/FlashcardGenerationModal.tsx', 'flashcard-modal'],
  ['components/study/ImageOcclusionEditor.tsx', 'occlusion-editor']
];

test('37.6 cada overlay con Escape se registra y sólo actúa si está arriba', () => {
  for (const [file, id] of OVERLAY_OWNERS) {
    const source = readSource(file);
    assert.ok(source.includes(`pushOverlay('${id}')`), `${file}: se registra al abrirse`);
    assert.ok(source.includes(`removeOverlay('${id}')`), `${file}: se da de baja al cerrarse`);
    assert.ok(source.includes(`isTopOverlay('${id}')`), `${file}: no responde a Escape si hay otro encima`);
  }
});
