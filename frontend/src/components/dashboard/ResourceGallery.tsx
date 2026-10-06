import React from 'react';
import { ArrowRight, Layers } from 'lucide-react';
import { Badge, ProgressBar, SectionHeading, cn } from '../ui/index.tsx';
import type { ResourceStatus } from '../../types/models.ts';
import { resourceInitials, type GalleryItem } from '../../services/galleryItems.ts';

/** Elemento de la galería con su acción de apertura ya resuelta por la página. */
export interface GalleryEntry extends GalleryItem {
  onOpen: () => void;
}

interface ResourceGalleryProps {
  items: GalleryEntry[];
  title?: string;
  description?: string;
  /** Acción "ver todo" (normalmente navegar a la Biblioteca). */
  onSeeAll?: () => void;
  /** Nº máximo de tarjetas visibles; el resto queda tras "ver todo". */
  limit?: number;
  emptyHint?: string;
  className?: string;
}

/** Etiqueta de estado en español, consistente en toda la aplicación. */
const STATUS_LABELS: Record<ResourceStatus, { text: string; tone: 'neutral' | 'accent' | 'success' }> = {
  NOT_STARTED: { text: 'Sin empezar', tone: 'neutral' },
  IN_PROGRESS: { text: 'En progreso', tone: 'accent' },
  COMPLETED: { text: 'Completado', tone: 'success' }
};

/**
 * Galería visual de recursos de aprendizaje.
 *
 * Es agnóstica al dominio: solo conoce `GalleryItem`, así que sirve igual para
 * cursos, libros, documentos importados o cualquier artefacto de aprendizaje
 * futuro. Cada tarjeta es un `<button>` con nombre accesible explícito y el
 * progreso usa `ProgressBar` (nunca color como único indicador).
 */
export const ResourceGallery: React.FC<ResourceGalleryProps> = ({
  items,
  title = 'Tu aprendizaje de un vistazo',
  description = 'Galería visual de los recursos que estás trabajando.',
  onSeeAll,
  limit = 6,
  emptyHint = 'Aún no hay recursos. Importa un documento o crea tu primer curso desde la Biblioteca.',
  className
}) => {
  const visible = items.slice(0, Math.max(0, limit));

  return (
    <section className={cn('space-y-4', className)} aria-label={title}>
      <SectionHeading
        title={title}
        description={description}
        action={
          onSeeAll ? (
            <button
              type="button"
              onClick={onSeeAll}
              className="inline-flex items-center gap-1 text-meta font-medium text-accent hover:underline"
            >
              Ver toda la Biblioteca
              <ArrowRight size={12} aria-hidden="true" />
            </button>
          ) : undefined
        }
      />

      {visible.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-6">
          <Layers size={18} className="shrink-0 text-faint" aria-hidden="true" />
          <p className="type-secondary">{emptyHint}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {visible.map((item) => {
            const status = item.status ? STATUS_LABELS[item.status] : undefined;
            const progress = Math.min(100, Math.max(0, Math.round(item.progress)));
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={item.onOpen}
                  aria-label={`Abrir ${item.kindLabel.toLowerCase()} ${item.title}${status ? ` (${status.text})` : ''}`}
                  className="group flex h-full w-full flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-all duration-fast hover:border-accent/40 hover:shadow-pop focus:outline-none focus:ring-2 focus:ring-focus"
                >
                  <span className="relative block aspect-[3/4] w-full overflow-hidden border-b border-line bg-accent-soft">
                    {item.coverPath ? (
                      <img
                        src={item.coverPath}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-base group-hover:scale-105"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="flex h-full w-full items-center justify-center font-serif text-2xl font-semibold text-accent"
                      >
                        {resourceInitials(item.title)}
                      </span>
                    )}
                    {status && (
                      <span className="absolute left-2 top-2">
                        <Badge tone={status.tone}>{status.text}</Badge>
                      </span>
                    )}
                  </span>

                  <span className="flex flex-1 flex-col gap-1.5 p-3">
                    <span className="type-item line-clamp-2 text-ink group-hover:text-accent">
                      {item.title}
                    </span>
                    <span className="type-meta truncate text-muted">
                      {item.kindLabel}
                      {item.category ? ` · ${item.category}` : ''}
                    </span>
                    <span className="mt-auto block pt-1.5">
                      <ProgressBar value={progress} label={`Progreso de ${item.title}`} />
                      <span className="mt-1 flex items-center justify-between">
                        <span className="type-meta truncate text-faint">{item.meta ?? ''}</span>
                        <span className="type-meta font-semibold text-muted">{progress}%</span>
                      </span>
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
