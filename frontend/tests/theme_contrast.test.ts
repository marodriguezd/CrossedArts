import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * 30.x — Contraste real del tema (WCAG 2.1).
 *
 * Este test NO comprueba que "usamos tokens semánticos": recalcula el contraste
 * WCAG efectivo leyendo los valores RGB de `src/index.css` para el tema claro y
 * el oscuro. Es la verificación de accesibilidad que sí se puede ejecutar sin
 * navegador, y protege la regresión más habitual de un sistema de tokens: que
 * un valor se retoque a ojo y el metadato de 12px quede por debajo del umbral.
 *
 * Umbrales:
 *  - Texto normal (12–15px): 4.5:1
 *  - Texto principal: 7:1 (AAA, holgura para texto sobre superficies elevadas)
 *  - Indicadores no textuales (foco): 3:1
 */

type RGB = readonly [number, number, number];

/** Convierte un canal sRGB (0..255) a luminancia lineal. */
function channelToLinear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG de un color. */
function relativeLuminance([r, g, b]: RGB): number {
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}

/** Ratio de contraste WCAG entre dos colores (siempre ≥ 1). */
export function contrastRatio(a: RGB, b: RGB): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

const CSS_SOURCE = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');

/** Extrae el bloque de declaraciones de un selector concreto. */
function themeBlock(selector: string): string {
  const start = CSS_SOURCE.indexOf(selector);
  assert.ok(start >= 0, `No se encontró el bloque de tema ${selector}`);
  const open = CSS_SOURCE.indexOf('{', start);
  const close = CSS_SOURCE.indexOf('}', open);
  return CSS_SOURCE.slice(open + 1, close);
}

/** Lee los tokens `--c-*: R G B;` de un bloque de tema. */
function readTokens(selector: string): Map<string, RGB> {
  const tokens = new Map<string, RGB>();
  const block = themeBlock(selector);
  const re = /--c-([a-z0-9-]+)\s*:\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*;/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    tokens.set(match[1], [Number(match[2]), Number(match[3]), Number(match[4])]);
  }
  return tokens;
}

const light = readTokens(':root');
const dark = readTokens("[data-theme='dark']");

function token(theme: Map<string, RGB>, name: string): RGB {
  const value = theme.get(name);
  assert.ok(value, `Falta el token --c-${name}`);
  return value!;
}

/** Pareja de contraste requerida. */
interface Pair {
  fg: string;
  bg: string;
  min: number;
  why: string;
}

const PAIRS: Pair[] = [
  { fg: 'ink', bg: 'canvas', min: 7, why: 'texto principal sobre el fondo de página' },
  { fg: 'ink', bg: 'surface', min: 7, why: 'texto principal sobre paneles' },
  { fg: 'ink', bg: 'raised', min: 7, why: 'texto principal sobre diálogos' },
  { fg: 'muted', bg: 'canvas', min: 4.5, why: 'texto secundario sobre el fondo de página' },
  { fg: 'muted', bg: 'surface', min: 4.5, why: 'texto secundario sobre paneles' },
  { fg: 'muted', bg: 'raised', min: 4.5, why: 'texto secundario sobre diálogos' },
  { fg: 'faint', bg: 'canvas', min: 4.5, why: 'metadatos de 12px sobre el fondo de página' },
  { fg: 'faint', bg: 'surface', min: 4.5, why: 'metadatos de 12px sobre paneles' },
  { fg: 'faint', bg: 'raised', min: 4.5, why: 'metadatos de 12px sobre diálogos' },
  { fg: 'accent', bg: 'canvas', min: 4.5, why: 'acento como texto/enlace sobre el fondo de página' },
  { fg: 'accent', bg: 'surface', min: 4.5, why: 'acento como texto/enlace sobre paneles' },
  { fg: 'accent', bg: 'raised', min: 4.5, why: 'acento como texto/enlace sobre diálogos' },
  { fg: 'accent', bg: 'accent-soft', min: 4.5, why: 'acento sobre su propio fondo tenue (badges)' },
  { fg: 'on-accent', bg: 'accent', min: 4.5, why: 'texto de botón sólido sobre el relleno de acento' },
  { fg: 'on-accent', bg: 'success', min: 4.5, why: 'texto sobre relleno de éxito' },
  { fg: 'on-accent', bg: 'warning', min: 4.5, why: 'texto sobre relleno de aviso' },
  { fg: 'on-accent', bg: 'error', min: 4.5, why: 'texto sobre relleno de error' },
  { fg: 'success', bg: 'surface', min: 4.5, why: 'estado de éxito como texto' },
  { fg: 'warning', bg: 'surface', min: 4.5, why: 'estado de aviso como texto' },
  { fg: 'error', bg: 'surface', min: 4.5, why: 'estado de error como texto' },
  { fg: 'info', bg: 'surface', min: 4.5, why: 'estado informativo como texto' },
  { fg: 'focus', bg: 'canvas', min: 3, why: 'anillo de foco visible (indicador no textual)' }
];

for (const [themeName, themeTokens] of [['claro', light], ['oscuro', dark]] as const) {
  test(`30.1 tema ${themeName}: todas las parejas de texto cumplen contraste`, () => {
    for (const pair of PAIRS) {
      const ratio = contrastRatio(token(themeTokens, pair.fg), token(themeTokens, pair.bg));
      assert.ok(
        ratio >= pair.min,
        `Tema ${themeName}: --c-${pair.fg} sobre --c-${pair.bg} = ${ratio.toFixed(2)}:1 ` +
          `(mínimo ${pair.min}:1) — ${pair.why}`
      );
    }
  });
}

test('30.2 ambos temas definen exactamente el mismo conjunto de tokens', () => {
  const lightNames = Array.from(light.keys()).sort();
  const darkNames = Array.from(dark.keys()).sort();
  assert.deepEqual(
    darkNames,
    lightNames,
    'El tema oscuro debe definir los mismos tokens que el claro (sin huecos que hereden valores no intencionados)'
  );
});

test('30.3 la jerarquía de tinta se conserva: ink > muted > faint en contraste', () => {
  for (const [themeName, themeTokens] of [['claro', light], ['oscuro', dark]] as const) {
    const canvas = token(themeTokens, 'canvas');
    const ink = contrastRatio(token(themeTokens, 'ink'), canvas);
    const muted = contrastRatio(token(themeTokens, 'muted'), canvas);
    const faint = contrastRatio(token(themeTokens, 'faint'), canvas);
    assert.ok(ink > muted, `Tema ${themeName}: ink (${ink.toFixed(2)}) debe destacar más que muted (${muted.toFixed(2)})`);
    assert.ok(muted > faint, `Tema ${themeName}: muted (${muted.toFixed(2)}) debe destacar más que faint (${faint.toFixed(2)})`);
  }
});

test('30.4 los tests de contraste cubren todos los tokens de texto relevantes', () => {
  const covered = new Set(PAIRS.flatMap((p) => [p.fg, p.bg]));
  for (const name of ['ink', 'muted', 'faint', 'accent', 'on-accent', 'success', 'warning', 'error', 'info', 'focus', 'canvas', 'surface', 'raised']) {
    assert.ok(covered.has(name), `--c-${name} no está cubierto por ninguna pareja de contraste`);
  }
});
