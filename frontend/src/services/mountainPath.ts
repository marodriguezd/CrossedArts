/**
 * Matemática determinista de la "vista de progreso tipo montaña" y del panel de
 * galería visual. Vive fuera del componente React a propósito: son cálculos
 * puros (sin DOM, sin red) y por tanto se prueban directamente con node:test.
 *
 * Convención de coordenadas: espacio normalizado 0..100 con el eje Y hacia
 * abajo (igual que un viewBox SVG), de modo que la cima de la montaña tiene un
 * valor de `y` pequeño.
 */

export interface TrailPoint {
  x: number;
  y: number;
}

/** Sendero ascendente de la montaña: base (izquierda-abajo) → cumbre. */
export const MOUNTAIN_TRAIL: readonly TrailPoint[] = [
  { x: 8, y: 92 },
  { x: 24, y: 78 },
  { x: 30, y: 60 },
  { x: 48, y: 52 },
  { x: 54, y: 36 },
  { x: 70, y: 28 },
  { x: 82, y: 12 }
];

export interface MountainMilestone {
  /** Porcentaje de progreso que marca el hito (0..100). */
  percent: number;
  /** Etiqueta corta en español. */
  label: string;
  /** true cuando el progreso actual ya alcanzó el hito. */
  reached: boolean;
}

/**
 * Hitos genéricos del camino (vista global de la biblioteca).
 *
 * Son posiciones honestas sobre el recorrido, NO etapas psicológicas: el modelo
 * de datos no guarda "fundamentos" ni "nivel intermedio", así que no se finge
 * que existan. Cuando hay estructura real (los módulos de un curso), se usa esa
 * estructura en su lugar: ver `deriveStagesFromModules`. */
export const MOUNTAIN_MILESTONES: readonly MountainStageDefinition[] = [
  { percent: 0, label: 'Inicio' },
  { percent: 25, label: 'Base' },
  { percent: 50, label: 'Media altura' },
  { percent: 75, label: 'Cima a la vista' },
  { percent: 100, label: 'Cumbre' }
];

/** Definición de un hito del camino: posición (0..100) y etiqueta en español. */
export interface MountainStageDefinition {
  percent: number;
  label: string;
}

/**
 * Deriva hitos REALES a partir de la estructura de un curso: cada módulo ocupa
 * el tramo de lecciones que contiene, de modo que el hito marca el final de ese
 * módulo. Si el curso no declara lecciones se devuelve `[]` y la vista conserva
 * sus hitos genéricos: nunca se inventan etapas.
 */
export function deriveStagesFromModules(
  modules: readonly { title: string; lessons?: readonly { is_completed: boolean }[] }[],
  maxLabelLength = 40
): MountainStageDefinition[] {
  const totalLessons = modules.reduce((sum, mod) => sum + (mod.lessons?.length || 0), 0);
  if (totalLessons <= 0) return [];

  const truncate = (value: string): string => {
    const clean = value.trim();
    if (clean.length <= maxLabelLength) return clean;
    return `${clean.slice(0, Math.max(1, maxLabelLength - 1)).trimEnd()}…`;
  };

  const stages: MountainStageDefinition[] = [{ percent: 0, label: 'Inicio' }];
  let covered = 0;
  for (const mod of modules) {
    const count = mod.lessons?.length || 0;
    if (count === 0) continue;
    covered += count;
    stages.push({
      percent: clampPercent(Math.round((covered / totalLessons) * 100)),
      label: truncate(mod.title)
    });
  }
  return stages;
}

/** Acota un valor al rango [0, 100] y descarta NaN/Infinity. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/** Distancia euclídea entre dos puntos del sendero. */
export function distanceBetween(a: TrailPoint, b: TrailPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Longitud total del sendero (suma de segmentos). */
export function trailLength(points: readonly TrailPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceBetween(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Punto del sendero a una fracción de avance `0..1`.
 *
 * Recorre los segmentos acumulando longitud y devuelve la posición
 * interpolada. Sin dependencias del DOM (no usa `getPointAtLength`), por lo que
 * el marcador puede calcularse sin medir el SVG renderizado.
 */
export function pointAtFraction(points: readonly TrailPoint[], fraction: number): TrailPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };

  const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
  const total = trailLength(points);
  if (total <= 0) return { ...points[0] };

  const target = total * clamped;
  let covered = 0;

  for (let i = 1; i < points.length; i += 1) {
    const segment = distanceBetween(points[i - 1], points[i]);
    if (covered + segment >= target) {
      const local = segment === 0 ? 0 : (target - covered) / segment;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * local,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * local
      };
    }
    covered += segment;
  }

  return { ...points[points.length - 1] };
}

/** Punto del sendero a un porcentaje de progreso (0..100). */
export function pointAtPercent(points: readonly TrailPoint[], percent: number): TrailPoint {
  return pointAtFraction(points, clampPercent(percent) / 100);
}

/** Hitos del camino con su estado `reached` resuelto para un progreso dado. */
export function resolveMilestones(
  progress: number,
  definitions: readonly MountainStageDefinition[] = MOUNTAIN_MILESTONES
): MountainMilestone[] {
  const current = clampPercent(progress);
  return definitions.map((definition) => ({
    percent: definition.percent,
    label: definition.label,
    reached: current >= definition.percent
  }));
}

/** Cadena del atributo `points` de un `<polyline>` SVG. */
export function toPolylinePoints(points: readonly TrailPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

export interface ProgressSource {
  /** Porcentaje propio del recurso (0..100). */
  percent: number;
}

/**
 * Progreso global de la biblioteca: media de los porcentajes de cada recurso.
 * Devuelve 0 con una biblioteca vacía (nunca divide por cero ni inventa datos).
 */
export function computeOverallProgress(inputs: readonly ProgressSource[]): number {
  if (inputs.length === 0) return 0;
  const total = inputs.reduce((sum, item) => sum + clampPercent(item.percent), 0);
  return Math.round(total / inputs.length);
}
