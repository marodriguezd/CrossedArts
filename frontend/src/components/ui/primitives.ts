import { createElement, type ReactNode } from 'react';
import { type ClassValue } from 'clsx';
import clsx from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

const customTwMerge = extendTailwindMerge({
  extend: {
    theme: {
      color: [
        'canvas',
        'surface',
        'raised',
        'line',
        'line-strong',
        'ink',
        'muted',
        'faint',
        'accent',
        'accent-soft',
        'on-accent',
        'success',
        'success-soft',
        'warning',
        'warning-soft',
        'error',
        'error-soft',
        'info',
        'info-soft',
        'focus',
      ],
    },
    classGroups: {
      'font-size': [{ text: ['display', 'title', 'section', 'item', 'body', 'secondary', 'meta', 'micro'] }],
      shadow: [{ shadow: ['card', 'pop', 'header'] }],
      duration: [{ duration: ['fast', 'base'] }],
    },
  },
});

/** Combina clases condicionales sin perder los overrides de tailwind-merge. */
export function cn(...inputs: ClassValue[]): string {
  return customTwMerge(clsx(inputs));
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  /**
   * Etiqueta accesible. Obligatoria: una barra de progreso sin nombre es muda
   * para un lector de pantalla.
   */
  label: string;
  className?: string;
  tone?: 'accent' | 'success';
}

export interface ResolvedProgress {
  /** Valor anunciado por ARIA, ya acotado a [0, max]. */
  value: number;
  /** Máximo efectivo (> 0). */
  max: number;
  /** Porcentaje visual redondeado, derivado del MISMO valor acotado. */
  percent: number;
}

/**
 * Deriva el valor visual y el valor ARIA de una única fuente acotada.
 *
 * Antes `aria-valuenow` recibía el valor crudo mientras el ancho se calculaba
 * con un porcentaje acotado: con `value > max` (o negativo) la barra mostraba
 * 100%/0% y el árbol anunciaba un valor contradictorio (`aria-valuenow >
 * aria-valuemax`). Aquí ambos salen del mismo valor acotado.
 *
 * Es puro y vive en un `.ts` para poder verificarse desde el runner de pruebas.
 */
export function resolveProgress(value: number, max: number = 100): ResolvedProgress {
  const safeMax = Number.isFinite(max) && max > 0 ? max : 100;
  const safeValue = Number.isFinite(value) ? value : 0;
  const clamped = Math.min(safeMax, Math.max(0, safeValue));
  return {
    value: clamped,
    max: safeMax,
    percent: Math.min(100, Math.max(0, Math.round((clamped / safeMax) * 100)))
  };
}

/** Progreso con estado accesible completo (valor, rango y etiqueta). */
export function ProgressBar({ value, max = 100, label, className, tone = 'accent' }: ProgressBarProps) {
  const progress = resolveProgress(value, max);
  return createElement(
    'div',
    {
      role: 'progressbar',
      'aria-valuenow': progress.value,
      'aria-valuemin': 0,
      'aria-valuemax': progress.max,
      'aria-label': label,
      className: cn('h-1.5 w-full overflow-hidden rounded-full bg-line', className)
    },
    createElement('div', {
      className: cn(
        'h-full rounded-full transition-[width] duration-base',
        tone === 'success' ? 'bg-success' : 'bg-accent'
      ),
      style: { width: `${progress.percent}%` }
    })
  );
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