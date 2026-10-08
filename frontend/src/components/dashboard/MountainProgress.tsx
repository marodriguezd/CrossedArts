import React from 'react';
import { Mountain } from 'lucide-react';
import { Panel, cn } from '../ui/index.tsx';
import {
  MOUNTAIN_TRAIL,
  clampPercent,
  computeOverallProgress,
  pointAtPercent,
  resolveMilestones,
  toPolylinePoints,
  type MountainStageDefinition,
  type ProgressSource
} from '../../services/mountainPath.ts';

interface MountainProgressProps {
  /** Recursos reales cuya media alimenta la subida (vista global). */
  resources?: ProgressSource[];
  /**
   * Progreso ya calculado por el llamador (vista con ámbito, p. ej. un curso).
   * Si se indica, tiene prioridad sobre `resources`: la MISMA matemática del
   * sendero se reutiliza y no hay dos implementaciones de montaña.
   */
  progress?: number;
  /**
   * Hitos a mostrar. Sin ellos se usan los genéricos de la biblioteca; con
   * estructura real (módulos de un curso) se pasan los módulos como hitos.
   */
  stages?: readonly MountainStageDefinition[];
  title?: string;
  /** Texto descriptivo opcional mostrado bajo el título. */
  subtitle?: string;
  /** Etiqueta accesible del SVG cuando el contexto no es la biblioteca global. */
  scopeLabel?: string;
  className?: string;
}

/**
 * Vista de progreso tipo montaña.
 *
 * El marcador sube por el sendero en función de la media real de progreso de la
 * biblioteca; la etiqueta accesible describe la posición exacta. Es puramente
 * visual (SVG + tokens semánticos) y no introduce datos sintéticos: si no hay
 * recursos, el progreso es 0 y se indica con un texto vacío honesto.
 */
export const MountainProgress: React.FC<MountainProgressProps> = ({
  resources = [],
  progress: progressOverride,
  stages,
  title = 'Camino a la cima',
  subtitle,
  scopeLabel = 'la biblioteca',
  className
}) => {
  const progress =
    typeof progressOverride === 'number' ? clampPercent(Math.round(progressOverride)) : computeOverallProgress(resources);
  const hasCustomStages = Array.isArray(stages) && stages.length > 0;
  const milestones = resolveMilestones(progress, hasCustomStages ? stages : undefined);
  const marker = pointAtPercent(MOUNTAIN_TRAIL, progress);
  const reached = milestones.filter((milestone) => milestone.reached);

  return (
    <Panel className={cn('p-5', className)}>
      <div className="flex items-center gap-2">
        <Mountain size={16} className="text-accent" aria-hidden="true" />
        <h2 className="type-title text-ink">{title}</h2>
      </div>
      <p className="type-secondary mt-1">
        {subtitle ?? 'Progreso medio de tu biblioteca, de la base a la cumbre.'}
      </p>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-2xl font-semibold text-ink">{progress}%</span>
        <span className="type-meta">
          {!hasCustomStages && typeof progressOverride !== 'number' && resources.length === 0
            ? 'Sin recursos todavía'
            : `${reached.length}/${milestones.length} hitos alcanzados`}
        </span>
      </div>

      <svg
        viewBox="0 0 100 100"
        className="mt-3 h-40 w-full text-accent"
        role="img"
        aria-label={`Progreso de ${scopeLabel}: ${progress} por ciento del camino a la cumbre`}
        preserveAspectRatio="none"
      >
        {/* Silueta de la montaña (relleno tenue con tokens semánticos). */}
        <path
          d="M0 100 L20 74 L34 84 L56 40 L70 56 L84 12 L100 44 L100 100 Z"
          className="fill-accent-soft"
        />

        {/* Sombra de la cumbre. */}
        <polyline
          points={toPolylinePoints([{ x: 84, y: 12 }, { x: 72, y: 24 }])}
          className="stroke-line"
          fill="none"
          strokeWidth="1.2"
          strokeLinecap="round"
        />

        {/* Sendero ascendente. */}
        <polyline
          points={toPolylinePoints(MOUNTAIN_TRAIL)}
          className="stroke-ink/50"
          fill="none"
          strokeWidth="1.4"
          strokeDasharray="3 2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Hitos alcanzados. */}
        {milestones
          .filter((milestone) => milestone.reached && milestone.percent > 0)
          .map((milestone) => {
            const point = pointAtPercent(MOUNTAIN_TRAIL, milestone.percent);
            return (
              <circle
                key={milestone.percent}
                cx={point.x}
                cy={point.y}
                r="1.8"
                className="fill-success"
              />
            );
          })}

        {/* Marcador de la posición actual. */}
        <circle cx={marker.x} cy={marker.y} r="3.4" className="fill-accent" />
        <circle cx={marker.x} cy={marker.y} r="1.3" className="fill-on-accent" />
      </svg>

      {/* Hitos en texto: accesible y legible sin depender del SVG. */}
      <ol className="mt-3 space-y-1.5" aria-label="Hitos del camino">
        {milestones.map((milestone) => (
          <li key={milestone.percent} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                milestone.reached ? 'bg-success' : 'bg-line'
              )}
            />
            <span
              className={cn(
                'type-meta',
                milestone.reached ? 'font-semibold text-ink' : 'text-muted'
              )}
            >
              {milestone.label}
            </span>
            <span className="type-meta ml-auto text-faint">{milestone.percent}%</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
};
