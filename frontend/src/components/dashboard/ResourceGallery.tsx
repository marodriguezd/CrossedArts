import React from 'react';
import { ArrowRight, ClipboardList, Layers } from 'lucide-react';
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
  /** Texto del enlace de `onSeeAll`. */
  seeAllLabel?: string;
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
 * Galería visual de artefactos de aprendizaje.
 *
 * Es agnóstica al dominio: solo conoce `GalleryItem`, así que sirve igual para
 * cursos, libros, documentos importados o trabajo práctico. Cada tarjeta es un
 * `<button>` con nombre accesible explícito y el progreso usa `ProgressBar`
 * (nunca color como único indicador).
 *
 * Dos tratamientos dentro de la MISMA lengua visual:
 *  - Portada (`cover`): cursos, libros y recursos, con portada 3:4 e iniciales de
 *    respaldo cuando no hay imagen.
 *  - Ficha (`row`): trabajo práctico, que no tiene portada; se presenta como
 *    artefacto con icono, estado y tipo.
 *
 * El progreso solo se dibuja como barra cuando es `measured`. Si el modelo solo
 * guarda un estado (`status`), se muestra el estado y NUNCA un porcentaje
 * inventado (ver docs/PROGRESS.md).
 */
export const ResourceGallery: React.FC<ResourceGalleryProps> = ({
  items,
  title = 'Tu aprendizaje de un vistazo',
  description = 'Galería visual de los recursos que estás trabajando.',
  onSeeAll,
  seeAllLabel = 'Ver toda la Biblioteca',
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
              {seeAllLabel}
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
            const isMeasured = item.progressSource !== 'status';
            const progress = Math.min(100, Math.max(0, Math.round(item.progress)));
            const accessibleName = `Abrir ${item.kindLabel.toLowerCase()} ${item.title}${status ? ` (${status.text})` : ''}`;

            if (item.kind === 'practice') {
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={item.onOpen}
                    aria-label={accessibleName}
                    className="group flex h-full w-full flex-col gap-2 rounded-xl border border-line bg-surface p-3 text-left shadow-card transition-all duration-fast hover:border-accent/40 hover:shadow-pop focus:outline-none focus:ring-2 focus:ring-focus"
                  >
                    <span className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-accent-soft text-accent"
                      >
                        <ClipboardList size={14} />
                      </span>
                      {status && <Badge tone={status.tone}>{status.text}</Badge>}
                    </span>
                    <span className="type-item line-clamp-3 text-ink group-hover:text-accent">
                      {item.title}
                    </span>
                    <span className="type-meta mt-auto truncate text-muted">{item.meta ?? item.kindLabel}</span>
                  </button>
                </li>
              );
            }

            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={item.onOpen}
                  aria-label={accessibleName}
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
                      {isMeasured ? (
                        <>
                          <ProgressBar value={progress} label={`Progreso de ${item.title}`} />
                          <span className="mt-1 flex items-center justify-between">
                            <span className="type-meta truncate text-faint">{item.meta ?? ''}</span>
                            <span className="type-meta font-semibold text-muted">{progress}%</span>
                          </span>
                        </>
                      ) : (
                        <span className="flex items-center justify-between gap-2">
                          <span className="type-meta truncate text-faint">{item.meta ?? ''}</span>
                          <span className="type-meta shrink-0 text-muted">
                            {status ? status.text : 'Sin estado'}
                          </span>
                        </span>
                      )}
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
