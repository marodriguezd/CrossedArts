/**
 * Guardia de la i18n: el copy en español no puede crecer fuera de los diccionarios.
 *
 * Contexto medido: la app soporta seis idiomas (en/es/de/fr/it/zh) y su catálogo
 * tiene ~950 claves. El copy de vista, los mensajes de error, las etiquetas de
 * presentación, los atributos ARIA y los placeholders viven en
 * `src/i18n/locales/*` y se resuelven con `translateKey`/`useLanguage`.
 *
 * Fija el máximo POR FICHERO, así que:
 *
 *   - un fichero nuevo no puede empezar con copy en español (máximo 0);
 *   - un fichero existente no puede sumar ni un literal más;
 *   - al migrar copy, BAJA su número en `SPANISH_LITERAL_BUDGET`. Nunca sube.
 *
 * `SPANISH_LITERAL_BUDGET` sólo conserva las entradas que NO son copy: un signo
 * de puntuación que el tokenizador necesita y dos identificadores de dominio que
 * se persisten tal cual. Todo lo demás está en cero, y un fichero ausente del
 * mapa también vale cero.
 *
 * Es una guardia de estructura (lee el fuente y nombra fichero y línea), no un
 * contador de menciones. Su límite conocido: es un proxy que detecta literales
 * entre comillas con caracteres acentuados, así que no ve el texto JSX suelto ni
 * el español sin tildes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { extname, join, relative } from 'node:path';

import { en } from '../src/i18n/locales/en.ts';
import { es } from '../src/i18n/locales/es.ts';
import { de } from '../src/i18n/locales/de.ts';
import { fr } from '../src/i18n/locales/fr.ts';
import { it } from '../src/i18n/locales/it.ts';
import { zh } from '../src/i18n/locales/zh.ts';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SOURCE_ROOTS = ['components', 'pages', 'services'].map((dir) => join(SRC, dir));

/** Un literal con caracteres exclusivamente españoles no puede ser otra cosa. */
const SPANISH_LITERAL = /["'][^"']*[áéíóúñ¿¡][^"']*["']/;

/**
 * Máximo actual por fichero. SÓLO BAJA: al migrar copy a `translateKey`, baja su
 * número aquí en el mismo cambio.
 */
const SPANISH_LITERAL_BUDGET: Record<string, number> = {
  // Un solo «¡» en la lista de separadores de palabra: es un signo que el
  // tokenizador de la paleta necesita, no texto de interfaz.
  'services/commandPalette.ts': 1,
};

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (['.ts', '.tsx'].includes(extname(path))) found.push(path);
  }
  return found;
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('{/*')
  );
}

/** Spanish literals per source file, with the line that proves it. */
function measure(): { counts: Map<string, number>; firstOffender: Map<string, string> } {
  const counts = new Map<string, number>();
  const firstOffender = new Map<string, string>();

  for (const root of SOURCE_ROOTS) {
    for (const file of sourceFiles(root)) {
      const key = relative(SRC, file).split('\\').join('/');
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (isComment(line)) return;
          if (!SPANISH_LITERAL.test(line)) return;
          counts.set(key, (counts.get(key) ?? 0) + 1);
          if (!firstOffender.has(key)) {
            firstOffender.set(key, `${key}:${index + 1}: ${line.trim()}`);
          }
        });
    }
  }

  return { counts, firstOffender };
}

test('el copy en español fuera de los diccionarios no crece en ningún fichero', () => {
  const { counts, firstOffender } = measure();
  const regressions: string[] = [];

  for (const [file, count] of counts) {
    const budget = SPANISH_LITERAL_BUDGET[file] ?? 0;
    if (count > budget) {
      regressions.push(
        `${file}: ${count} literales (presupuesto ${budget}) — p. ej. ${firstOffender.get(file)}`
      );
    }
  }

  assert.deepEqual(
    regressions,
    [],
    `copy en español fuera de i18n/locales/ (usa translateKey):\n${regressions.join('\n')}`
  );
});

test('el presupuesto total sólo puede bajar', () => {
  const { counts } = measure();
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const budget = Object.values(SPANISH_LITERAL_BUDGET).reduce((sum, value) => sum + value, 0);
  assert.ok(
    total <= budget,
    `los literales en español crecieron de ${budget} a ${total}: migra el copy a translateKey`
  );
});

test('los seis diccionarios tienen exactamente las mismas claves', () => {
  const base = Object.keys(en).sort();
  assert.ok(base.length > 700, `el catálogo base debe estar completo (${base.length} claves)`);

  for (const [code, table] of Object.entries({ es, de, fr, it, zh })) {
    assert.deepEqual(
      Object.keys(table).sort(),
      base,
      `el diccionario «${code}» no cubre exactamente las mismas claves que «en»`
    );
  }
});

test('ninguna clave del catálogo base queda vacía', () => {
  const empty = Object.entries(en).filter(([, value]) => value.trim() === '');
  assert.deepEqual(empty, [], 'una clave vacía se rendería como hueco silencioso');
});
