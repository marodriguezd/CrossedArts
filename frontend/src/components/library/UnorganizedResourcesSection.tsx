import React from 'react';
import { ArrowUpRight, Brain, Link2 } from 'lucide-react';
import type { Course, UnorganizedResource } from '../../types/models.ts';
import { Button, Panel } from '../ui/index.tsx';

export interface UnorganizedResourcesSectionProps {
  unorganized: UnorganizedResource[];
  organizeFeedback: string | null;
  organizeTarget: Record<string, string>;
  onOrganizeTargetChange: (resourceId: string, courseId: string) => void;
  onOrganizeResource: (resourceId: string) => void;
  courses: Course[];
  onOpenResource?: (resourceId: string) => void;
  onStudyResource?: (resourceId: string, mode?: 'flashcards' | 'practice' | 'mixed') => void;
}

export const UnorganizedResourcesSection: React.FC<UnorganizedResourcesSectionProps> = ({
  unorganized,
  organizeFeedback,
  organizeTarget,
  onOrganizeTargetChange,
  onOrganizeResource,
  courses,
  onOpenResource,
  onStudyResource,
}) => {
  if (unorganized.length === 0) return null;

  return (
    <Panel className="border-warning/40 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="type-micro flex items-center gap-2 text-warning">
          <Link2 size={13} aria-hidden="true" />
          Recursos sin organizar ({unorganized.length})
        </h2>
        {organizeFeedback && <span className="type-meta">{organizeFeedback}</span>}
      </div>
      <p className="type-meta">
        Documentos importados que aún no están asociados a ningún curso, libro o concepto.
      </p>
      <ul className="mt-3 space-y-2">
        {unorganized.map((item) => (
          <li
            key={item.resource.id}
            className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3 sm:flex-row sm:items-center"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-meta font-semibold text-ink">{item.resource.title}</p>
              <p className="type-meta">{item.noteCount} fragmentos de estudio · sin conexiones</p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => onOpenResource?.(item.resource.id)}
                aria-label={`Abrir recurso ${item.resource.title}`}
              >
                <ArrowUpRight size={12} aria-hidden="true" /> Abrir
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onStudyResource?.(item.resource.id, 'mixed')}
                aria-label={`Estudiar recurso ${item.resource.title}`}
              >
                <Brain size={12} aria-hidden="true" /> Estudiar
              </Button>
              <select
                value={organizeTarget[item.resource.id] || ''}
                onChange={(e) => onOrganizeTargetChange(item.resource.id, e.target.value)}
                className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-meta text-ink focus:border-accent/50 focus:outline-none"
                aria-label={`Asociar ${item.resource.title} a un curso`}
              >
                <option value="">Elegir curso…</option>
                {courses.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              <Button
                size="sm"
                variant="solid"
                onClick={() => onOrganizeResource(item.resource.id)}
                disabled={!organizeTarget[item.resource.id]}
              >
                Asociar
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
};
