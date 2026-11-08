import {
  type ThemeMode,
  getStoredTheme,
  setThemeMode
} from '../hooks/useTheme.ts';

export type { ThemeMode };

/**
 * Convenience service functions for reading and setting theme mode,
 * delegating to the single shared source of truth in hooks/useTheme.ts.
 */
export function getTheme(): ThemeMode {
  return getStoredTheme();
}

export function setTheme(mode: ThemeMode): void {
  setThemeMode(mode);
}
