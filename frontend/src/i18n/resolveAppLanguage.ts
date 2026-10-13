import { resolveStoredLanguage, type LanguageCode } from './languages.ts';

const STORAGE_KEY = 'crossedarts-language';

/**
 * Synchronous read of the effective UI language for non-React modules
 * (DAO, sqliteBridge). Same resolution as the `useLanguage` hook:
 * persisted choice, or the browser locale when set to automatic.
 */
export function resolveAppLanguage(): LanguageCode {
  try {
    const stored =
      typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    const nav = typeof navigator !== 'undefined' ? navigator : null;
    const tag = nav ? (nav.languages?.[0] ?? nav.language ?? null) : null;
    return resolveStoredLanguage(stored, tag);
  } catch {
    return 'en';
  }
}
