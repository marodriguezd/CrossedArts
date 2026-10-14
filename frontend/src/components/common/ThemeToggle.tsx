import React from 'react';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme.ts';

interface ThemeToggleProps {
  /** Compact variant for the header. */
  compact?: boolean;
}

/**
 * Light/dark theme toggle with an accessible name, announced state, and local
 * persistence. State is never communicated by color alone.
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
