import type { LanguageCode } from '../i18n/languages.ts';
import { resolveAppLanguage } from '../i18n/resolveAppLanguage.ts';

let current: LanguageCode = resolveAppLanguage();

/** Module-level UI language for the data layer (mirrors Settings). */
export function setDaoLanguage(lang: LanguageCode): void {
  current = lang;
}

/** Current data-layer language. Defaults to the persisted/auto choice. */
export function daoLang(): LanguageCode {
  return current;
}
