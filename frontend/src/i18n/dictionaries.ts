import type { LanguageCode } from './languages.ts';
import { en, type LocaleKey } from './locales/en.ts';
import { es } from './locales/es.ts';
import { de } from './locales/de.ts';
import { fr } from './locales/fr.ts';
import { it } from './locales/it.ts';
import { zh } from './locales/zh.ts';

const dictionaries: Record<LanguageCode, Record<LocaleKey, string>> = {
  en,
  es,
  de,
  fr,
  it,
  zh,
};

/**
 * Looks up a UI string with cascading fallback (active language → English
 * → key). `{name}` placeholders are substituted from `params`.
 */
export function translateKey(
  code: LanguageCode,
  key: string,
  params?: Record<string, string | number | null | undefined>,
): string {
  const table = dictionaries[code] ?? en;
  let value: string =
    (table as Record<string, string>)[key] ??
    (en as Record<string, string>)[key] ??
    key;
  if (params) {
    for (const [name, v] of Object.entries(params)) {
      value = value.split(`{${name}}`).join(String(v ?? ''));
    }
  }
  return value;
}

export function dictionaryKeys(): LocaleKey[] {
  return Object.keys(en) as LocaleKey[];
}
