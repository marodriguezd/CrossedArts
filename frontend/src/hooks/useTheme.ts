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
 * explícita (no como una inversión del claro).
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

type ThemeListener = (mode: ThemeMode) => void;

const listeners = new Set<ThemeListener>();
let currentMode: ThemeMode | null = null;

/**
 * Estado de tema compartido entre todos los consumidores del hook.
 *
 * `useTheme()` se usa hoy en dos `ThemeToggle` distintos (cabecera y Ajustes) y
 * lo usa además la paleta de comandos. Con estado local en cada consumidor, la
 * etiqueta de la paleta se quedaría desfasada en cuanto el usuario alternara el
 * tema desde el botón de la cabecera: tres fuentes de verdad divergentes.
 *
 * Aquí hay una sola. `setThemeMode` aplica, persiste y notifica, y `useTheme` se
 * limita a suscribirse. El script inline de `index.html` sigue siendo el que
 * aplica el valor guardado antes del primer pintado; este hook solo mantiene
 * React en sincronía.
 */
function readMode(): ThemeMode {
  if (currentMode === null) currentMode = getStoredTheme();
  return currentMode;
}

/** Fija el tema desde cualquier punto y notifica a todos los suscriptores. */
export function setThemeMode(mode: ThemeMode): void {
  currentMode = mode;
  applyTheme(mode);
  persistTheme(mode);
  for (const listener of listeners) listener(mode);
}

/**
 * Estado de tema persistente. El script inline de `index.html` ya aplica el
 * valor guardado antes del primer pintado; este hook mantiene React en
 * sincronía y lo alterna.
 */
export function useTheme(): [ThemeMode, () => void] {
  const [theme, setTheme] = useState<ThemeMode>(readMode);

  useEffect(() => {
    const listener = (mode: ThemeMode) => setTheme(mode);
    listeners.add(listener);
    // Re-sincroniza por si el tema cambió entre el render y el efecto.
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