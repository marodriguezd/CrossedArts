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

/** Merges conditional classes without losing tailwind-merge overrides. */
export function cn(...inputs: ClassValue[]): string {
  return customTwMerge(clsx(inputs));
}

export interface ProgressBarProps {
  value: number;
  max?: number;
  /**
   * Accessible label. Required: a nameless progress bar is mute for a screen
   * reader.
   */
  label: string;
  className?: string;
  tone?: 'accent' | 'success';
}

export interface ResolvedProgress {
  /** ARIA-announced value, already clamped to [0, max]. */
  value: number;
  /** Effective maximum (> 0). */
  max: number;
  /** Rounded visual percent, derived from the SAME clamped value. */
  percent: number;
}

/**
 * Derives both the visual value and the ARIA value from ONE clamped source.
 *
 * Previously `aria-valuenow` got the raw value while the width used a clamped
 * percentage: with `value > max` (or negative) the bar showed 100%/0% and the
 * tree announced a contradictory value (`aria-valuenow > aria-valuemax`). Here
 * both come from the same clamped value. Pure, and living in a `.ts` so the
 * test runner can verify it.
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

/** Progress with full accessible state (value, range, and label). */
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
   * Optional on purpose: it reproduces `React.FC` semantics (which added
   * `children?: ReactNode`), letting callers use `createElement(Kbd, props,
   * child)` without listing `children` inside props.
   */
  children?: ReactNode;
  className?: string;
}

/** Visual keyboard shortcut. A `<kbd>` styled with the design-system type scale. */
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