import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.ts';

interface ThemeToggleProps {
  /** Variante compacta para la cabecera. */
  compact?: boolean;
}

/**
 * Cambio de tema claro/oscuro con nombre accesible, estado anunciado y
 * persistencia local. No depende del color para comunicar el estado actual.
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ compact = false }) => {
  const [theme, toggle] = useTheme();
  const isDark = theme === 'dark';

  const label = isDark ? 'Cambiar al tema claro' : 'Cambiar al tema oscuro';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      aria-pressed={isDark}
      title={label}
      className={`flex items-center justify-center rounded-lg border border-line text-muted hover:text-ink hover:bg-accent-soft/60 transition-colors duration-fast ${
        compact ? 'h-9 w-9' : 'h-10 w-10'
      }`}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
    </button>
  );
};
