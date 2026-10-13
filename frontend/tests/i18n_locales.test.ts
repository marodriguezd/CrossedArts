import test from 'node:test';
import assert from 'node:assert/strict';

import { en } from '../src/i18n/locales/en.ts';
import { es } from '../src/i18n/locales/es.ts';
import { de } from '../src/i18n/locales/de.ts';
import { fr } from '../src/i18n/locales/fr.ts';
import { it } from '../src/i18n/locales/it.ts';
import { zh } from '../src/i18n/locales/zh.ts';

const LOCALES: Array<[string, Record<string, string>]> = [
  ['es', es as Record<string, string>],
  ['de', de as Record<string, string>],
  ['fr', fr as Record<string, string>],
  ['it', it as Record<string, string>],
  ['zh', zh as Record<string, string>]
];

const base = en as Record<string, string>;
const baseKeys = Object.keys(base);

const placeholderOf = (text: string): string[] => {
  const found = text.match(/\{[^}]+\}/g);
  return found ? [...found].sort() : [];
};

test('i18n every locale exposes exactly the English key set', () => {
  assert.ok(baseKeys.length > 500, 'base inventory must stay complete');
  for (const [code, table] of LOCALES) {
    assert.deepEqual(
      Object.keys(table).sort(),
      [...baseKeys].sort(),
      `${code}: key set must match English`
    );
  }
});

test('i18n no blank values and no key echoes', () => {
  const all: Array<{ code: string; table: Record<string, string> }> = [
    { code: 'en', table: base },
    ...LOCALES.map(([code, table]) => ({ code, table }))
  ];
  for (const { code, table } of all) {
    for (const key of baseKeys) {
      const value = table[key];
      assert.ok(value !== undefined, `${code}:${key} missing`);
      assert.ok(value.trim().length > 0, `${code}:${key} is blank`);
      assert.notEqual(value, key, `${code}:${key} echoes the key`);
    }
  }
});

test('i18n no placeholder is dropped in any locale (extra plural markers allowed)', () => {
  for (const key of baseKeys) {
    const expected = placeholderOf(base[key]);
    if (expected.length === 0) continue;
    for (const [code, table] of LOCALES) {
      const actual = placeholderOf(table[key]);
      for (const ph of expected) {
        assert.ok(actual.includes(ph), `${code}:${key} dropped placeholder ${ph}`);
      }
    }
  }
});

test('i18n representative values are genuinely translated', () => {
  const t = (code: string) => LOCALES.find(([c]) => c === code)![1];
  assert.equal(t('es')['shell.skipLink'], 'Saltar al contenido principal');
  assert.equal(t('de')['shell.skipLink'], 'Zum Hauptinhalt springen');
  assert.equal(t('fr')['shell.skipLink'], 'Aller au contenu principal');
  assert.equal(t('it')['shell.skipLink'], 'Vai al contenuto principale');
  assert.equal(t('zh')['shell.skipLink'], '跳到主要内容');
  assert.equal(t('es')['graph.focusSr'], 'Enfoque del vecindario del nodo seleccionado');
  assert.match(t('zh')['graph.legendMain'], /拖拽|缩放/);
});
