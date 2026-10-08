import { useEffect, useRef } from 'react';
import { isPaletteHotkey } from '../services/commandPalette.ts';

/**
 * Atajo global de la paleta de comandos (Ctrl+K / Cmd+K).
 *
 * El listener se registra UNA sola vez mientras el componente está montado, no
 * solo cuando la paleta está abierta: el atajo debe funcionar desde cualquier
 * vista, incluida la lección con el reproductor en marcha y la sesión de repaso
 * SM-2.
 *
 * Por qué no se solapa con los demás atajos del proyecto: los handlers de medios
 * (`LessonWorkspace`) y de repaso (`ReviewCenter`) comprueban teclas SIN
 * verificar modificadores, de modo que `Ctrl+K` les llegaría como una `k` suelta.
 * Por eso esos handlers incorporan su propia guarda de modificadores y aquí se
 * exige `isPaletteHotkey`, que además descarta las combinaciones de tres
 * modificadores reservadas al sistema y al navegador.
 *
 * La función se guarda en un ref para que cambiar de identidad en cada render no
 * desmonte y remonte el listener, y con ello no pierda el atajo.
 */
export function useCommandPaletteHotkey(onToggle: () => void): void {
  const handlerRef = useRef(onToggle);

  useEffect(() => {
    handlerRef.current = onToggle;
  }, [onToggle]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Otro control de la propia página ya resolvió esta pulsación.
      if (event.defaultPrevented) return;
      if (!isPaletteHotkey(event)) return;
      event.preventDefault();
      handlerRef.current();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}