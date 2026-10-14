import { useEffect, useRef } from 'react';
import { isPaletteHotkey } from '../services/commandPalette.ts';

/**
 * Global command-palette hotkey (Ctrl+K / Cmd+K).
 *
 * The listener registers ONCE while the component is mounted, not only while
 * the palette is open: the hotkey must work from any view, including a lesson
 * with the player running and an SM-2 review session.
 *
 * Why it does not clash with the project's other shortcuts: the media
 * (`LessonWorkspace`) and review (`ReviewCenter`) handlers check keys WITHOUT
 * verifying modifiers, so `Ctrl+K` would reach them as a bare `k`. Those
 * handlers therefore carry their own modifier guard, and here `isPaletteHotkey`
 * is required, which also discards the triple-modifier combos reserved by the
 * OS and the browser.
 *
 * The callback is kept in a ref so a new identity each render does not unmount
 * and remount the listener and lose the hotkey.
 */
export function useCommandPaletteHotkey(onToggle: () => void): void {
  const handlerRef = useRef(onToggle);

  useEffect(() => {
    handlerRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Another control on the page already handled this keypress.
      if (event.defaultPrevented) return;
      if (!isPaletteHotkey(event)) return;
      event.preventDefault();
      handlerRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}