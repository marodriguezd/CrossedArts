import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'crossedarts-theme';

/**
 * Lee el tema persistido. Por defecto el tema de CrossedArts es CLARO/CREMA;
 * el oscuro/carbón es una opción explícita del usuario.
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
 * Aplica el tema al elemento raíz. Los tokens de `index.css` viven bajo
 * `[data-theme="dark"]`, de modo que el tema oscuro se define de forma
 * explícita (nunca como inversión del claro).
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = mode;
}

export function persistTheme(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Almacenamiento no disponible: el tema sigue vigente en la sesión.
  }
}

/**
 * Estado de tema persistente. El script inline de `index.html` ya aplica el
 * valor guardado antes del primer pintado; este hook mantiene React en
 * sincronía y lo alterna.
 */
export function useTheme(): [ThemeMode, () => void] {
  const [theme, setTheme] = useState<ThemeMode>(() => getStoredTheme());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      persistTheme(next);
      return next;
    });
  }, []);

  return [theme, toggle];
}
