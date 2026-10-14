/**
 * Deterministic math for the "mountain-style progress view" and the visual
 * gallery panel. Deliberately kept outside the React component: these are pure
 * calculations (no DOM, no network) and are therefore tested directly with
 * node:test.
 *
 * Coordinate convention: normalized 0..100 space with the Y axis pointing down
 * (like an SVG viewBox), so the mountain summit has a small `y` value.
 */

export interface TrailPoint {
  x: number;
  y: number;
}

/** Ascending mountain trail: base (bottom-left) -> summit. */
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
  /** Progress percent marking the milestone (0..100). */
  percent: number;
  /** Short localized label. */
  label: string;
  /** True when the current progress already reached the milestone. */
  reached: boolean;
}

/**
 * Generic trail milestones (library-wide view).
 *
 * They are honest positions along the route, NOT psychological stages: the data
 * model stores neither "fundamentals" nor "intermediate level", so their
 * existence is never faked. When real structure exists (a course's modules),
 * that structure is used instead: see `deriveStagesFromModules`. */
export const MOUNTAIN_MILESTONES: readonly MountainStageDefinition[] = [
  { percent: 0, label: 'Inicio' },
  { percent: 25, label: 'Base' },
  { percent: 50, label: 'Media altura' },
  { percent: 75, label: 'Cima a la vista' },
  { percent: 100, label: 'Cumbre' }
];

/** Trail milestone definition: position (0..100) and localized label. */
export interface MountainStageDefinition {
  percent: number;
  label: string;
}

/**
 * Derives REAL milestones from a course structure: each module covers the
 * lesson span it contains, so the milestone marks that module's end. A course
 * declaring no lessons returns `[]` and the view keeps its generic milestones:
 * stages are never invented.
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

/** Clamps a value to [0, 100] and discards NaN/Infinity. */
export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

/** Euclidean distance between two trail points. */
export function distanceBetween(a: TrailPoint, b: TrailPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Total trail length (sum of segments). */
export function trailLength(points: readonly TrailPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += distanceBetween(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Trail point at an advance fraction `0..1`.
 *
 * Walks the segments accumulating length and returns the interpolated position.
 * No DOM dependencies (it does not use `getPointAtLength`), so the marker can
 * be computed without measuring the rendered SVG.
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

/** Trail point at a progress percent (0..100). */
export function pointAtPercent(points: readonly TrailPoint[], percent: number): TrailPoint {
  return pointAtFraction(points, clampPercent(percent) / 100);
}

/** Trail milestones with their `reached` state resolved for a given progress. */
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

/** Value of the `points` attribute of an SVG `<polyline>`. */
export function toPolylinePoints(points: readonly TrailPoint[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

export interface ProgressSource {
  /** The resource's own percent (0..100). */
  percent: number;
}

/**
 * Library-wide progress: mean of each resource's percent. Returns 0 for an
 * empty library (never divides by zero or invents data).
 */
export function computeOverallProgress(inputs: readonly ProgressSource[]): number {
  if (inputs.length === 0) return 0;
  const total = inputs.reduce((sum, item) => sum + clampPercent(item.percent), 0);
  return Math.round(total / inputs.length);
}
