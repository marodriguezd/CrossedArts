import React from 'react';
import type { ImageOcclusionData, OcclusionMask } from '../../types/models.ts';
import { cn } from '../ui/index.tsx';
import { Eye, EyeOff } from 'lucide-react';

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
  const { imageUrl, mode, masks } = data;
  const safeMasks = Array.isArray(masks) ? masks : [];

  return (
    <div className={cn('relative flex flex-col items-center w-full select-none', className)}>
      {/* Contenedor relativo de imagen y máscaras */}
      <div className="relative inline-block max-w-full overflow-hidden rounded-xl border border-[var(--c-border)] bg-[var(--c-canvas-subtle)] shadow-sm">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt="Lámina de estudio con oclusión"
            className="block max-h-[60vh] max-w-full object-contain pointer-events-none"
          />
        ) : (
          <div className="flex h-64 w-96 items-center justify-center text-sm text-[var(--c-ink-faint)]">
            Sin imagen disponible
          </div>
        )}

        {/* Capa de Máscaras */}
        {safeMasks.map((mask: OcclusionMask, idx: number) => {
          const isActive = idx === activeMaskIndex;
          const hideAll = mode === 'hide_all_reveal_one';

          // Determinar si esta máscara debe estar tapada
          let isCovered = false;
          if (isActive) {
            isCovered = !isRevealed;
          } else if (hideAll) {
            isCovered = true;
          } else {
            isCovered = false;
          }

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
                isActive && isCovered && 'bg-[var(--c-accent)]/85 text-[var(--c-accent-contrast)] shadow-md border-2 border-[var(--c-accent)] animate-pulse',
                isActive && !isCovered && 'bg-[var(--c-accent)]/20 text-[var(--c-ink)] border-2 border-[var(--c-accent)] shadow-inner backdrop-blur-[2px]',
                !isActive && isCovered && 'bg-[var(--c-canvas-inset)]/90 text-[var(--c-ink-muted)] border border-[var(--c-border)] shadow-xs',
                !isActive && !isCovered && 'bg-transparent border border-dashed border-[var(--c-border)] text-[var(--c-ink-faint)] opacity-60'
              )}
            >
              {isCovered ? (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[var(--c-canvas)]/40 text-[11px]">
                  {idx + 1}
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded bg-[var(--c-canvas)]/90 text-[var(--c-ink)] shadow-xs max-w-full truncate text-[11px]">
                  {mask.label || `Área ${idx + 1}`}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Barra de estado inferior */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 w-full px-2 text-xs text-[var(--c-ink-muted)]">
        <div className="flex items-center gap-2">
          <span className="font-medium text-[var(--c-ink)]">
            Máscara {activeMaskIndex + 1} de {safeMasks.length}
          </span>
          <span className="text-[var(--c-ink-faint)]">•</span>
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
