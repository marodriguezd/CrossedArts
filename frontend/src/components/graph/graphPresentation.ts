import React from 'react';
import { GraduationCap, BookOpen, Layers, FileText, ClipboardList, Lightbulb } from 'lucide-react';
import type { Options } from 'vis-network/esnext';
import type { GraphNodeType } from '../../types/models.ts';

/**
 * Knowledge-graph presentation: palette, tokens, and vis-network options.
 *
 * Pure extraction (no React state) from the KnowledgeGraph.tsx module so canvas
 * appearance can be tested without mounting the component and without
 * duplicating the palette: colors are READ from the real index.css tokens.
 */

export type ThemeMode = 'light' | 'dark';

/**
 * vis-network draws on <canvas> and CANNOT consume CSS variables, so it needs
 * concrete colors. To keep the canvas from ever drifting out of sync with the
 * theme, values are READ from the real `index.css` tokens at runtime instead of
 * duplicating the palette in code: a single source of truth.
 */
export interface GraphTokens {
  ink: string;
  faint: string;
  accent: string;
  accentSoft: string;
  /** Muted tone for derived edges (foreign-key relations). */
  derived: string;
}

const FALLBACK_TOKENS: Record<ThemeMode, GraphTokens> = {
  light: { ink: '#252220', faint: '#6C6559', accent: '#5E4B8B', accentSoft: '#ECE6F4', derived: '#9C968A' },
  dark: { ink: '#E7E2D9', faint: '#A29B91', accent: '#A794CE', accentSoft: '#322C42', derived: '#57544E' }
};

/**
 * Blends a color toward white/black by ratio to derive node borders from their
 * fill. Avoids inventing new tones: borders come from each type's own accent
 * token.
 */
export function shade(hex: string, amount: number): string {
  const m = hex.trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return hex;
  const to = amount > 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  const channel = (c: number) => Math.round(c + (to - c) * ratio);
  const r = channel((num >> 16) & 255);
  const g = channel((num >> 8) & 255);
  const b = channel(num & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/**
 * Translucent node fill: the accent color softened over the canvas. Expressed
 * in `rgba` because vis-network composites the node over the background.
 */
export function translucent(hex: string, alpha: number): string {
  const m = hex.trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return hex;
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/** Reads an RGB token (`R G B`) from `index.css` and returns it as `#rrggbb`. */
export function readToken(varName: string, fallback: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const raw = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue(varName)
    .trim();
  if (!raw) return fallback;
  if (raw.startsWith('#')) return raw;
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length < 3) return fallback;
  const [r, g, b] = parts;
  const toHex = (v: string) => Number(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Resolves the graph palette from the live tokens of the active theme. */
export function resolveGraphTokens(theme: ThemeMode): GraphTokens {
  const fb = FALLBACK_TOKENS[theme];
  return {
    ink: readToken('--c-ink', fb.ink),
    faint: readToken('--c-muted', fb.faint),
    accent: readToken('--c-accent', fb.accent),
    accentSoft: readToken('--c-accent-soft', fb.accentSoft),
    derived: readToken('--c-faint', fb.derived)
  };
}

/**
 * Accent per node type. All types share the product's single plum family so the
 * map reads as one palette rather than new colors; the translucent background
 * keeps the canvas always legible.
 */
export const NODE_ACCENT_VAR: Record<GraphNodeType, string> = {
  course: '--c-accent',
  module: '--c-accent',
  concept: '--c-accent',
  book: '--c-info',
  lesson: '--c-info',
  // Notes and practice work share the "user-produced content" tone: they are
  // what the learner writes/creates, not material read.
  note: '--c-success',
  practice: '--c-success',
  resource: '--c-warning'
};

/** Node fill and border, derived from its type's accent token. */
export function nodeColors(type: GraphNodeType, theme: ThemeMode): { background: string; border: string } {
  const base = readToken(NODE_ACCENT_VAR[type], FALLBACK_TOKENS[theme].accent);
  const isDark = theme === 'dark';
  // On dark the fill leans toward black; on light, toward paper.
  return {
    background: translucent(base, isDark ? 0.22 : 0.14),
    border: shade(base, isDark ? 0.12 : -0.12)
  };
}

export const NODE_ICONS: Record<GraphNodeType, React.ComponentType<{ size?: number; className?: string }>> = {
  course: GraduationCap,
  book: BookOpen,
  module: Layers,
  lesson: FileText,
  note: FileText,
  practice: ClipboardList,
  concept: Lightbulb,
  resource: BookOpen
};

export const FILTER_ORDER: GraphNodeType[] = ['course', 'book', 'module', 'lesson', 'note', 'concept', 'practice', 'resource'];

export function buildNetworkOptions(theme: ThemeMode): Options {
  const t = resolveGraphTokens(theme);
  return {
    nodes: {
      shape: 'box',
      margin: { top: 10, right: 12, bottom: 10, left: 12 },
      font: { color: t.ink, face: 'system-ui, sans-serif', size: 12 },
      borderWidth: 1.5,
      shapeProperties: { borderRadius: 8 }
    },
    edges: {
      arrows: 'to',
      font: { color: t.faint, size: 9, align: 'middle' },
      smooth: { enabled: true, type: 'dynamic', roundness: 0.4 }
    },
    physics: {
      barnesHut: { gravitationalConstant: -3000, springLength: 130, springConstant: 0.04 },
      stabilization: { enabled: true, iterations: 150, updateInterval: 25 }
    },
    interaction: { hover: true, zoomView: true, dragView: true, tooltipDelay: 200 }
  };
}

