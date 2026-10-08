import React from 'react';
import { GraduationCap, BookOpen, Layers, FileText, ClipboardList, Lightbulb } from 'lucide-react';
import type { Options } from 'vis-network/esnext';
import type { GraphNodeType } from '../../types/models.ts';

/**
 * Presentación del grafo de conocimiento: paleta, tokens y opciones de vis-network.
 *
 * Extracción pura (sin estado de React) del módulo KnowledgeGraph.tsx, para que
 * la apariencia del lienzo se pueda probar sin montar el componente y sin
 * duplicar la paleta: los colores se LEEN de los tokens reales de index.css.
 */

export type ThemeMode = 'light' | 'dark';

/**
 * vis-network dibuja sobre <canvas> y NO puede consumir variables CSS, así que
 * necesita colores concretos. Para que el lienzo nunca se desincronice del tema,
 * los valores se LEEN de los tokens reales de `index.css` en tiempo de ejecución
 * en lugar de duplicar la paleta en código: una única fuente de verdad.
 */
export interface GraphTokens {
  ink: string;
  faint: string;
  accent: string;
  accentSoft: string;
  /** Tono apagado para las aristas derivadas (relaciones de claves foráneas). */
  derived: string;
}

const FALLBACK_TOKENS: Record<ThemeMode, GraphTokens> = {
  light: { ink: '#252220', faint: '#6C6559', accent: '#5E4B8B', accentSoft: '#ECE6F4', derived: '#9C968A' },
  dark: { ink: '#E7E2D9', faint: '#A29B91', accent: '#A794CE', accentSoft: '#322C42', derived: '#57544E' }
};

/**
 * Mezcla un color con blanco/negro por proporción para derivar los bordes de
 * los nodos a partir de su relleno. Evita inventar tonos nuevos: los bordes
 * nacen del propio token de acento de cada tipo.
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
 * Relleno translúcido del nodo: el color de acento atenuado sobre el lienzo.
 * Se expresa en `rgba` porque vis-network compone el nodo sobre el fondo.
 */
export function translucent(hex: string, alpha: number): string {
  const m = hex.trim().replace('#', '');
  const full = m.length === 3 ? m.split('').map(c => c + c).join('') : m;
  const num = parseInt(full, 16);
  if (Number.isNaN(num) || full.length !== 6) return hex;
  return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

/** Lee un token RGB (`R G B`) de `index.css` y lo devuelve como `#rrggbb`. */
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

/** Resuelve la paleta del grafo desde los tokens vivos del tema activo. */
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
 * Acento por tipo de nodo. Los siete tipos comparten la misma familia ciruela
 * del producto para que el mapa se lea como una sola paleta y no como siete
 * colores nuevos; el fondo translúcido mantiene el lienzo siempre legible.
 */
export const NODE_ACCENT_VAR: Record<GraphNodeType, string> = {
  course: '--c-accent',
  module: '--c-accent',
  concept: '--c-accent',
  book: '--c-info',
  lesson: '--c-info',
  // Notas y trabajo práctico comparten el tono de "contenido producido por el
  // usuario": son las dos cosas que el estudiante escribe/crea, no material leído.
  note: '--c-success',
  practice: '--c-success',
  resource: '--c-warning'
};

/** Relleno y borde de un nodo, derivados del token de acento de su tipo. */
export function nodeColors(type: GraphNodeType, theme: ThemeMode): { background: string; border: string } {
  const base = readToken(NODE_ACCENT_VAR[type], FALLBACK_TOKENS[theme].accent);
  const isDark = theme === 'dark';
  // En oscuro el relleno se apoya hacia el negro; en claro, hacia el papel.
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

