import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  AUTO_LANGUAGE,
  isSupportedCode,
  resolveStoredLanguage,
  type LanguageCode,
  type StoredLanguage,
} from '../i18n/languages.ts';
import { translateKey } from '../i18n/dictionaries.ts';

const STORAGE_KEY = 'crossedarts-language';

function readBrowserTag(): string | null {
  if (typeof navigator === 'undefined') return null;
  const nav = navigator as Navigator & { userLanguage?: string };
  const langs = navigator.languages;
  if (langs && langs.length > 0) return langs[0];
  return navigator.language || nav.userLanguage || null;
}

/** Persisted value: 'auto' or a supported code. Defaults to 'auto'. */
export function getStoredLanguage(): StoredLanguage {
  if (typeof window === 'undefined') return AUTO_LANGUAGE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === null) return AUTO_LANGUAGE;
    const trimmed = stored.trim();
    if (trimmed === '' || trimmed === AUTO_LANGUAGE) return AUTO_LANGUAGE;
    return isSupportedCode(trimmed) ? trimmed : AUTO_LANGUAGE;
  } catch {
    return AUTO_LANGUAGE;
  }
}

export function persistLanguage(value: StoredLanguage): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage unavailable: the language still applies to the session.
  }
}

/** Effective language after resolving 'auto' from the browser locale. */
export function getEffectiveLanguage(
  stored: StoredLanguage = getStoredLanguage(),
): LanguageCode {
  return resolveStoredLanguage(stored, readBrowserTag());
}

/** Keeps <html lang> in sync so screen readers pick the right voice. */
export function applyDocumentLanguage(code: LanguageCode): void {
  if (typeof document === 'undefined') return;
  const tag = code === 'zh' ? 'zh-CN' : code;
  document.documentElement.lang = tag;
}

type LanguageListener = (stored: StoredLanguage) => void;

const listeners = new Set<LanguageListener>();
let currentStored: StoredLanguage | null = null;

function currentSnapshot(): StoredLanguage {
  if (currentStored === null) {
    currentStored = getStoredLanguage();
    applyDocumentLanguage(getEffectiveLanguage(currentStored));
  }
  return currentStored;
}

function subscribe(listener: LanguageListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setStored(value: StoredLanguage): void {
  currentStored = value;
  persistLanguage(value);
  applyDocumentLanguage(getEffectiveLanguage(value));
  for (const listener of listeners) listener(value);
}

/**
 * Shared UI-language state, mirroring the `useTheme` pattern: every
 * consumer reads the same module-level snapshot, so switching the language
 * in Settings re-renders the whole interface consistently.
 */
export function useLanguage(): {
  /** Raw stored value: 'auto' or a supported code. */
  language: StoredLanguage;
  /** Resolved language actually used for lookups. */
  effective: LanguageCode;
  setLanguage: (value: StoredLanguage) => void;
  /** Translation lookup with English fallback and {name} interpolation. */
  t: (key: string, params?: Record<string, string | number | null | undefined>) => string;
} {
  const stored = useSyncExternalStore(subscribe, currentSnapshot, currentSnapshot);
  const effective = getEffectiveLanguage(stored);
  const setLanguage = useCallback((value: StoredLanguage) => {
    setStored(value);
  }, []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number | null | undefined>) =>
      translateKey(effective, key, params),
    [effective],
  );

  useEffect(() => {
    applyDocumentLanguage(effective);
  }, [effective]);

  return { language: stored, effective, setLanguage, t };
}
