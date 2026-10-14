import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'crossedarts-theme';

/**
 * Reads the persisted theme. CrossedArts defaults to LIGHT/CREAM; dark/charcoal
 * is an explicit user choice.
 */
export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * Applies the theme to the root element. The `index.css` tokens live under
 * `[data-theme="dark"]`, so the dark theme is defined explicitly (not as an
 * inversion of the light one).
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
}

export function persistTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the theme stays in effect for the session.
  }
}

type ThemeListener = (mode: ThemeMode) => void;

const listeners = new Set<ThemeListener>();
let currentMode: ThemeMode | null = null;

/**
 * Theme state shared across every consumer of the hook.
 *
 * `useTheme()` is used today by two different `ThemeToggle`s (header and
 * Settings) and also by the command palette. With local state per consumer, the
 * palette label would fall out of date as soon as the user toggled the theme
 * from the header button: three diverging sources of truth.
 *
 * Here there is only one. `setThemeMode` applies, persists, and notifies, while
 * `useTheme` merely subscribes. The inline `index.html` script still applies the
 * stored value before the first paint; this hook only keeps React in sync.
 */
function readMode(): ThemeMode {
  if (currentMode === null) currentMode = getStoredTheme();
  return currentMode;
}

/** Sets the theme from anywhere and notifies every subscriber. */
export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  applyTheme(mode);
  persistTheme(mode);
  for (const listener of listeners) listener(mode);
}

/**
 * Persistent theme state. The inline `index.html` script already applies the
 * stored value before the first paint; this hook keeps React in sync and
 * toggles it.
 */
export function useTheme(): [ThemeMode, () => void] {
  const [theme, setTheme] = useState<ThemeMode>(readMode);

  useEffect(() => {
    const listener = (mode: ThemeMode) => setTheme(mode);
    listeners.add(listener);
    // Re-syncs in case the theme changed between render and effect.
    setTheme(readMode());
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const toggle = useCallback(() => {
    setThemeMode(readMode() === 'dark' ? 'light' : 'dark');
  }, []);

  return [theme, toggle];
}