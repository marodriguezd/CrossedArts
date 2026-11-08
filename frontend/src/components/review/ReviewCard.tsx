import React from 'react';
import {
  Sparkles,
  Volume2,
  VolumeX
} from 'lucide-react';
import type { Flashcard } from '../../types/models.ts';
import { parseImageOcclusionData } from '../../services/imageOcclusion.ts';
import { ImageOcclusionViewer } from '../study/ImageOcclusionViewer.tsx';
import { Kbd } from '../ui/index.tsx';

export interface ReviewCardProps {
  card: Flashcard;
  showAnswer: boolean;
  onToggleAnswer: () => void;
  isPlayingAudio: boolean;
  onToggleAudio: () => void;
  activeMaskIndex: number;
  onSelectMask: (index: number) => void;
}

export const ReviewCard: React.FC<ReviewCardProps> = ({
  card,
  showAnswer,
  onToggleAnswer,
  isPlayingAudio,
  onToggleAudio,
  activeMaskIndex,
  onSelectMask
}) => {
  if (card.card_type === 'image_occlusion' && card.extra_data) {
    const occlusionData = parseImageOcclusionData(card.extra_data);
    if (occlusionData) {
      return (
        <div className="space-y-4 rounded-xl border border-line bg-raised p-5 shadow-pop sm:p-7">
          <div className="flex items-center justify-between">
            <span className="type-micro text-accent">
              Oclusión de imagen · {showAnswer ? 'Respuestas visibles' : 'Área oculta'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleAudio();
                }}
                aria-label={isPlayingAudio ? 'Detener lectura en voz alta' : 'Leer tarjeta en voz alta (R)'}
                className="p-1.5 rounded-lg border border-line bg-canvas text-muted hover:text-ink hover:bg-accent-soft transition-colors cursor-pointer"
                title="Leer en voz alta (R)"
              >
                {isPlayingAudio ? (
                  <VolumeX size={14} className="text-accent animate-pulse" aria-hidden="true" />
                ) : (
                  <Volume2 size={14} aria-hidden="true" />
                )}
              </button>
              <span className="text-meta text-muted">
                SM-2 · {card.interval_days}d
              </span>
            </div>
          </div>
          <h2 className="font-serif text-lg font-bold leading-snug text-ink md:text-xl">
            {card.front}
          </h2>

          <ImageOcclusionViewer
            data={occlusionData}
            activeMaskIndex={activeMaskIndex}
            isRevealed={showAnswer}
            onToggleReveal={onToggleAnswer}
            onSelectMask={onSelectMask}
          />

          {showAnswer && card.back && (
            <div className="border-t border-line pt-3 text-meta text-muted">
              <p className="whitespace-pre-line leading-relaxed">{card.back}</p>
            </div>
          )}
        </div>
      );
    }
  }

  return (
    <button
      type="button"
      onClick={onToggleAnswer}
      aria-expanded={showAnswer}
      aria-label={showAnswer ? 'Ocultar respuesta de la tarjeta' : 'Revelar respuesta de la tarjeta'}
      className="flex min-h-[240px] w-full flex-col justify-between rounded-xl border border-line bg-raised p-7 text-left shadow-pop transition-colors duration-fast hover:border-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:p-9"
    >
      <div>
        <div className="flex items-center justify-between">
          <span className="type-micro text-accent">
            {showAnswer ? 'Reverso / Respuesta' : 'Anverso / Pregunta'}
          </span>
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onToggleAudio();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                onToggleAudio();
              }
            }}
            aria-label={isPlayingAudio ? 'Detener lectura en voz alta' : 'Leer tarjeta en voz alta (R)'}
            className="p-1.5 rounded-lg border border-line bg-canvas text-muted hover:text-ink hover:bg-accent-soft transition-colors cursor-pointer"
            title="Leer en voz alta (R)"
          >
            {isPlayingAudio ? (
              <VolumeX size={14} className="text-accent animate-pulse" aria-hidden="true" />
            ) : (
              <Volume2 size={14} aria-hidden="true" />
            )}
          </span>
        </div>
        <h2 className="mt-4 font-serif text-xl font-bold leading-relaxed text-ink md:text-2xl">
          {card.front}
        </h2>
      </div>
      {showAnswer ? (
        <div className="mt-6 border-t border-line pt-6">
          <p className="text-body leading-relaxed text-ink" style={{ lineHeight: 1.7 }}>
            {card.back}
          </p>
        </div>
      ) : (
        <div className="pt-8 text-center">
          <span className="inline-flex items-center gap-1.5 text-meta text-faint">
            <Sparkles size={13} aria-hidden="true" /> Pulsa o presiona <Kbd>Espacio</Kbd> para revelar la respuesta
          </span>
        </div>
      )}
    </button>
  );
};
