/**
 * Supported UI languages: the five most widely spoken European languages
 * (English, Spanish, German, French, Italian) plus Simplified Chinese.
 *
 * English is the canonical base catalogue and the deterministic fallback.
 * `auto` (the default) follows the OS/browser language.
 */
export type LanguageCode = 'en' | 'es' | 'de' | 'fr' | 'it' | 'zh';

export const AUTO_LANGUAGE = 'auto' as const;

export type StoredLanguage = LanguageCode | typeof AUTO_LANGUAGE;

export interface LanguageMeta {
  code: LanguageCode;
  /** BCP 47 tag used for Intl APIs and <html lang>. */
  tag: string;
  /** Display name, always written in the language itself. */
  nativeName: string;
}

export const SUPPORTED_LANGUAGES: readonly LanguageMeta[] = [
  { code: 'en', tag: 'en', nativeName: 'English' },
  { code: 'es', tag: 'es', nativeName: 'Español' },
  { code: 'de', tag: 'de', nativeName: 'Deutsch' },
  { code: 'fr', tag: 'fr', nativeName: 'Français' },
  { code: 'it', tag: 'it', nativeName: 'Italiano' },
  { code: 'zh', tag: 'zh-CN', nativeName: '中文（简体）' },
] as const;

export const SUPPORTED_CODES: readonly LanguageCode[] = SUPPORTED_LANGUAGES.map(
  (l) => l.code,
);

export function isSupportedCode(code: string | null | undefined): code is LanguageCode {
  return (
    typeof code === 'string' &&
    (SUPPORTED_CODES as readonly string[]).includes(code.trim())
  );
}

/**
 * Maps a raw browser/OS locale to a supported app language.
 * Regional variants fall back to their base language; Traditional Chinese
 * script variants (TW/HK/MO/Hant) fall back to English rather than
 * receiving Simplified text; anything unknown resolves to English.
 */
export function systemDefaultCode(
  language?: string | null,
  script?: string | null,
  region?: string | null,
): LanguageCode {
  const lang = (language ?? '').toLowerCase();
  switch (lang) {
    case 'en':
    case 'es':
    case 'de':
    case 'fr':
    case 'it':
      return lang;
    case 'zh': {
      const s = (script ?? '').toLowerCase();
      const r = (region ?? '').toUpperCase();
      if (s === 'hant' || r === 'TW' || r === 'HK' || r === 'MO') return 'en';
      return 'zh';
    }
    default:
      return 'en';
  }
}

/** Splits a BCP 47 tag like "es-ES" into language/script/region parts. */
export function splitLocaleTag(tag: string): {
  language: string;
  script?: string;
  region?: string;
} {
  const parts = tag.replace(/_/g, '-').split('-');
  const language = parts[0] ?? '';
  let script: string | undefined;
  let region: string | undefined;
  for (const part of parts.slice(1)) {
    if (part.length === 4) script = part;
    else if (part.length === 2 || part.length === 3) region = part;
  }
  return { language, script, region };
}

/**
 * Resolves a persisted language value: blank/`auto` (first run) is detected
 * from the browser locale, a supported code is kept as-is, and any unknown
 * value deterministically falls back to English.
 */
export function resolveStoredLanguage(
  stored: string | null | undefined,
  browserTag?: string | null,
): LanguageCode {
  const trimmed = (stored ?? '').trim();
  if (trimmed === '' || trimmed === AUTO_LANGUAGE) {
    if (!browserTag) return 'en';
    const { language, script, region } = splitLocaleTag(browserTag);
    return systemDefaultCode(language, script, region);
  }
  return isSupportedCode(trimmed) ? trimmed : 'en';
}

export function nativeNameOf(code: LanguageCode): string {
  return SUPPORTED_LANGUAGES.find((l) => l.code === code)?.nativeName ?? code;
}
