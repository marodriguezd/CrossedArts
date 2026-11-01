import React, { useEffect, useState } from 'react';
import type { ImageOcclusionData, OcclusionMask } from '../../types/models.ts';
import { cn } from '../ui/index.tsx';
import { Eye, EyeOff } from 'lucide-react';
import { dao } from '../../db/dao.ts';

interface ImageOcclusionViewerProps {
  data: ImageOcclusionData;
  activeMaskIndex?: number;
  isRevealed: boolean;
  onToggleReveal?: () => void;
  onSelectMask?: (index: number) => void;
  className?: string;
}

export const ImageOcclusionViewer: React.FC<ImageOcclusionViewerProps> = ({
  data,
  activeMaskIndex = 0,
  isRevealed,
  onToggleReveal,
  onSelectMask,
  className
}) => {
  const { imageUrl, imageId, mode, masks } = data;
  const safeMasks = Array.isArray(masks) ? masks : [];

  // Cards created from now on store only `imageId`; the bitmap lives once in
  // `media_asset`. Older cards still carry `imageUrl` and render without a read.
  const [resolvedUrl, setResolvedUrl] = useState<string | null>(imageUrl ?? null);

  useEffect(() => {
    if (imageUrl) {
      setResolvedUrl(imageUrl);
      return;
    }
    if (!imageId) {
      setResolvedUrl(null);
      return;
    }

    let cancelled = false;
    dao
      .getMediaAsset(imageId)
      .then(asset => {
        if (!cancelled) setResolvedUrl(asset?.data ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolvedUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [imageUrl, imageId]);

  return (
    <div className={cn('relative flex flex-col items-center w-full select-none', className)}>
      <div className="relative inline-block max-w-full overflow-hidden rounded-xl border border-[var(--c-line)] bg-[var(--c-surface)] shadow-sm">
        {resolvedUrl ? (
          <img
            src={resolvedUrl}
            alt="Lámina de estudio con oclusión"
            className="block max-h-[60vh] max-w-full object-contain pointer-events-none"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center text-sm text-[var(--c-faint)]">
            Sin imagen disponible
          </div>
        )}

        {safeMasks.map((mask: OcclusionMask, idx: number) => {
          const isActive = idx === activeMaskIndex;
          const hideAll = mode === 'hide_all_reveal_one';
          const isCovered = isActive ? !isRevealed : hideAll;

          return (
            <button
              key={mask.id || idx}
              type="button"
              onClick={() => {
                if (onSelectMask) onSelectMask(idx);
                if (isActive && onToggleReveal) onToggleReveal();
              }}
              style={{
                left: `${mask.x}%`,
                top: `${mask.y}%`,
                width: `${mask.width}%`,
                height: `${mask.height}%`
              }}
              aria-label={`Máscara ${idx + 1}: ${isActive ? (isRevealed ? mask.label || 'Revelada' : 'Activa oculta') : 'Secundaria'}`}
              className={cn(
                'absolute rounded flex items-center justify-center transition-all duration-150 text-xs font-semibold cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--c-accent)]',
                isActive && isCovered && 'bg-[var(--c-accent)]/85 text-[var(--c-on-accent)] shadow-md border-2 border-[var(--c-accent)] animate-pulse',
                isActive && !isCovered && 'bg-[var(--c-accent)]/20 text-[var(--c-ink)] border-2 border-[var(--c-accent)] shadow-inner backdrop-blur-[2px]',
                !isActive && isCovered && 'bg-[var(--c-raised)]/90 text-[var(--c-muted)] border border-[var(--c-line)] shadow-sm',
                !isActive && !isCovered && 'bg-transparent border border-dashed border-[var(--c-line)] text-[var(--c-faint)] opacity-60'
              )}
            >
              {isCovered ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--c-canvas)]/40 text-[11px]">
                  {idx + 1}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-[var(--c-canvas)]/90 text-[var(--c-ink)] shadow-sm max-w-full truncate text-[11px]">
                  {mask.label || `Área ${idx + 1}`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 w-full px-2 text-xs text-[var(--c-muted)]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--c-ink)]">
            Máscara {activeMaskIndex + 1} de {safeMasks.length}
          </span>
          <span className="text-[var(--c-faint)]">•</span>
          <span>
            Modo: {mode === 'hide_all_reveal_one' ? 'Ocultar todas' : 'Ocultar una'}
          </span>
        </div>

        {onToggleReveal && (
          <button
            type="button"
            onClick={onToggleReveal}
            className="flex items-center gap-1.5 font-medium text-[var(--c-accent)] hover:underline cursor-pointer"
          >
            {isRevealed ? (
              <>
                <EyeOff className="w-3.5 h-3.5" />
                Ocultar respuesta
              </>
            ) : (
              <>
                <Eye className="w-3.5 h-3.5" />
                Revelar máscara activa (Espacio)
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
};
