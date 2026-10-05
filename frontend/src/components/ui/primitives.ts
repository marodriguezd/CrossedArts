import { createElement, type ReactNode } from 'react';
import { type ClassValue } from 'clsx';
import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Primitivas importables desde el runner de pruebas.
 *
 * Este módulo existe por una razón concreta: `node --test --experimental-strip-types`
 * elimina tipos pero NO JSX, así que **no puede importar un `.tsx`**. `ui/index.tsx`
 * es `.tsx` y por tanto era una puerta cerrada para cualquier componente `.ts` que
 * quisiera usar `cn` o `Kbd` en sus pruebas.
 *
 * La salida es mover esas dos piezas a un `.ts` escrito con `createElement` y
 * reexportarlas desde `ui/index.tsx`, de modo que sus 17 consumidores no cambian.
 * Es el mismo precio que ya pagó `components/ai/MarkdownMessage.ts`.
 *
 * NO añadas aquí componentes con JSX: perderían justo esta propiedad.
 */

/** Combina clases condicionales sin perder los overrides de tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export interface KbdProps {
  /**
   * Opcional a propósito: reproduce la semántica de `React.FC` (que añadía
   * `children?: ReactNode`), que es lo que permite llamar a `createElement(Kbd,
   * props, hijo)` sin incluir `children` dentro de las props.
   */
  children?: ReactNode;
  className?: string;
}

/** Atajo de teclado visual. Es `<kbd>` con la tipografía del sistema de diseño. */
export function Kbd({ children, className }: KbdProps) {
  return createElement(
    'kbd',
    {
      className: cn(
        'inline-flex items-center justify-center rounded border border-line-strong bg-canvas px-1.5 py-0.5 font-mono text-micro font-semibold text-muted shadow-sm',
        className
      )
    },
    children
  );
}