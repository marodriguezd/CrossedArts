import React from 'react';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { Button, cn } from '../ui/index.tsx';

export interface ReviewSummaryProps {
  phase: 'completed' | 'cancelled';
  sessionSummary: {
    itemsReviewed: number;
    flashcards: number;
    questions: number;
    correct: number;
    incorrect: number;
    durationMinutes: number;
  };
  onReset: () => void;
}

export const ReviewSummary: React.FC<ReviewSummaryProps> = ({
  phase,
  sessionSummary,
  onReset
}) => {
  const { t } = useLanguage();

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface p-6 text-center shadow-card sm:p-8">
      <div className={cn(
        'mx-auto flex h-14 w-14 items-center justify-center rounded-xl border',
        phase === 'completed' ? 'border-success/30 bg-success-soft text-success' : 'border-line bg-canvas text-muted'
      )}>
        {phase === 'completed' ? <CheckCircle2 size={28} aria-hidden="true" /> : <X size={28} aria-hidden="true" />}
      </div>
      <div>
        <h2 className="type-title text-ink">
          {phase === 'completed' ? t('review.completedTitle') : t('review.cancelledTitle')}
        </h2>
        <p className="type-secondary mt-1">
          {phase === 'completed' ? t('review.completedBody') : t('review.cancelledBody')}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-left sm:grid-cols-4">
        <div className="rounded-xl border border-line bg-canvas p-3">
          <p className="type-micro">Ítems repasados</p>
          <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.itemsReviewed}</p>
        </div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <p className="type-micro">Tarjetas</p>
          <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.flashcards}</p>
        </div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <p className="type-micro">Preguntas</p>
          <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.questions}</p>
        </div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <p className="type-micro">Duración</p>
          <p className="mt-1 text-lg font-semibold text-ink">{sessionSummary.durationMinutes} min</p>
        </div>
      </div>

      {sessionSummary.questions > 0 && (
        <p className="text-secondary text-muted">
          Práctica: <strong className="text-success">{sessionSummary.correct}</strong> correctas ·{' '}
          <strong className="text-error">{sessionSummary.incorrect}</strong> incorrectas
        </p>
      )}

      <Button variant="solid" onClick={onReset}>
        <RotateCcw size={14} aria-hidden="true" /> Nueva sesión
      </Button>
    </div>
  );
};
