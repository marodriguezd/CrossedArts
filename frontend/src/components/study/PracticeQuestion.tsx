import React from 'react';
import { CheckCircle, XCircle, ArrowRight, BookOpen } from 'lucide-react';
import type { GeneratedQuestion } from '../../lib/studyGeneration/types.ts';
import { Button, cn } from '../ui/index.tsx';

interface PracticeQuestionProps {
  question: GeneratedQuestion;
  selectedOption: number | null;
  isAnswerSubmitted: boolean;
  onSelectOption: (index: number) => void;
  onSubmit: () => void;
  onNext: () => void;
  isLast: boolean;
  nextLabel?: string;
}

/**
 * Tarjeta presentacional de pregunta de práctica (opción múltiple).
 * Reutilizada por la sesión de estudio unificada. Usa radios nativos para
 * obtener semántica de grupo accesible y navegación por teclado por defecto.
 */
export const PracticeQuestion: React.FC<PracticeQuestionProps> = ({
  question,
  selectedOption,
  isAnswerSubmitted,
  onSelectOption,
  onSubmit,
  onNext,
  isLast,
  nextLabel
}) => {
  const isCorrect = isAnswerSubmitted && selectedOption === question.correctIndex;

  const optionStyle = (idx: number) => {
    if (isAnswerSubmitted) {
      if (idx === question.correctIndex) return 'border-success/50 bg-success-soft text-success font-semibold';
      if (idx === selectedOption) return 'border-error/50 bg-error-soft text-error';
      return 'border-line/60 bg-canvas text-faint';
    }
    if (selectedOption === idx) return 'border-accent bg-accent-soft text-ink font-medium';
    return 'border-line bg-canvas text-ink hover:border-line-strong hover:bg-surface';
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-line bg-surface p-4 shadow-card">
        <h3 className="text-body font-semibold leading-relaxed text-ink">{question.question}</h3>
      </div>

      <div role="radiogroup" aria-label="Opciones de respuesta" className="space-y-2">
        {question.options.map((opt, idx) => (
          <label
            key={idx}
            className={cn(
              'flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-body transition-colors duration-fast',
              'focus-within:ring-2 focus-within:ring-focus',
              optionStyle(idx),
              isAnswerSubmitted ? 'cursor-default' : ''
            )}
          >
            <input
              type="radio"
              name={`practice-${question.id}`}
              value={idx}
              checked={selectedOption === idx}
              disabled={isAnswerSubmitted}
              onChange={() => onSelectOption(idx)}
              className="sr-only"
            />
            <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-micro font-bold">
              {String.fromCharCode(65 + idx)}
            </span>
            <span className="flex-1">{opt}</span>
          </label>
        ))}
      </div>

      {isAnswerSubmitted && (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-4" aria-live="polite">
          <div className="flex items-center gap-2">
            {isCorrect ? (
              <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-success">
                <CheckCircle size={15} aria-hidden="true" /> ¡Correcto!
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-error">
                <XCircle size={15} aria-hidden="true" /> Incorrecto
              </span>
            )}
          </div>
          <p className="text-body leading-relaxed text-ink">{question.explanation}</p>
          {question.sourceTitles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
              <span className="text-micro font-medium">Fuentes respaldadas:</span>
              {question.sourceTitles.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2 py-0.5 text-micro text-muted">
                  <BookOpen size={10} aria-hidden="true" /> {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        {!isAnswerSubmitted ? (
          <Button variant="solid" onClick={onSubmit} disabled={selectedOption === null}>
            Comprobar respuesta
          </Button>
        ) : (
          <Button variant="solid" onClick={onNext}>
            {nextLabel || (isLast ? 'Ver resumen' : 'Siguiente pregunta')} <ArrowRight size={14} aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  );
};
