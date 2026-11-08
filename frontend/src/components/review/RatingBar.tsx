import React from 'react';
import { ArrowRight } from 'lucide-react';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { Button, Kbd, cn } from '../ui/index.tsx';

const GRADE_OPTIONS: Array<{ grade: number; labelKey: string; hintKey: string; tone: string }> = [
  { grade: 0, labelKey: 'review.grade.0.label', hintKey: 'review.grade.0.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 1, labelKey: 'review.grade.1.label', hintKey: 'review.grade.1.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 2, labelKey: 'review.grade.2.label', hintKey: 'review.grade.2.hint', tone: 'border-error/30 bg-error-soft text-error hover:bg-error-soft/70' },
  { grade: 3, labelKey: 'review.grade.3.label', hintKey: 'review.grade.3.hint', tone: 'border-warning/30 bg-warning-soft text-warning hover:bg-warning-soft/70' },
  { grade: 4, labelKey: 'review.grade.4.label', hintKey: 'review.grade.4.hint', tone: 'border-info/30 bg-info-soft text-info hover:bg-info-soft/70' },
  { grade: 5, labelKey: 'review.grade.5.label', hintKey: 'review.grade.5.hint', tone: 'border-success/30 bg-success-soft text-success hover:bg-success-soft/70' }
];

export interface RatingBarProps {
  gradeFeedback: { label: string; nextReview: string } | null;
  onGrade: (grade: number) => void;
  onAdvance: () => void;
  isLastItem: boolean;
}

export const RatingBar: React.FC<RatingBarProps> = ({
  gradeFeedback,
  onGrade,
  onAdvance,
  isLastItem
}) => {
  const { t } = useLanguage();

  if (gradeFeedback) {
    return (
      <div className="space-y-3 rounded-xl border border-success/30 bg-success-soft p-5 text-center" aria-live="polite">
        <p className="text-body font-semibold text-ink">Repaso registrado · {gradeFeedback.label}</p>
        <p className="text-secondary text-muted">
          Próximo repaso: <strong className="text-success">{gradeFeedback.nextReview}</strong>
        </p>
        <Button variant="solid" onClick={onAdvance} className="gap-2">
          {isLastItem ? t('review.viewSummary') : t('review.nextItem')} <ArrowRight size={14} aria-hidden="true" />
          <Kbd className="border-current/25 bg-black/10 text-inherit">Espacio</Kbd>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-center text-meta font-medium text-muted">¿Qué tan fácil recordaste este concepto?</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
        {GRADE_OPTIONS.map(opt => (
          <button
            key={opt.grade}
            onClick={() => onGrade(opt.grade)}
            aria-label={t('review.gradeAria', { label: t(opt.labelKey), hint: t(opt.hintKey) })}
            className={cn(
              'flex flex-col justify-between rounded-xl border p-3 text-meta font-semibold transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              opt.tone
            )}
          >
            <div className="flex w-full items-center justify-between gap-1">
              <span>{opt.grade} · {t(opt.labelKey)}</span>
              <Kbd className="border-current/30 bg-transparent text-current opacity-80">{opt.grade}</Kbd>
            </div>
            <span className="mt-0.5 block text-left text-micro font-normal opacity-80">{t(opt.hintKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
