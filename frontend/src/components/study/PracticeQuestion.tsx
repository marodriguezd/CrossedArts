import React from 'react';
import { CheckCircle, XCircle, ArrowRight, BookOpen } from 'lucide-react';
import type { GeneratedQuestion } from '../../lib/studyGeneration/types.ts';

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
      if (idx === question.correctIndex) return 'border-emerald-500/50 bg-emerald-500/20 text-emerald-300 font-semibold';
      if (idx === selectedOption) return 'border-rose-500/50 bg-rose-500/20 text-rose-300';
      return 'border-slate-800/50 bg-slate-950/30 text-slate-500';
    }
    if (selectedOption === idx) return 'border-indigo-500 bg-indigo-500/20 text-white font-medium';
    return 'border-slate-800 bg-slate-900/50 hover:bg-slate-800/80 text-slate-200';
  };

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800">
        <h3 className="text-sm font-semibold text-white leading-relaxed">{question.question}</h3>
      </div>

      <div role="radiogroup" aria-label="Opciones de respuesta" className="space-y-2">
        {question.options.map((opt, idx) => (
          <label
            key={idx}
            className={`w-full text-left p-3 rounded-xl border text-xs transition flex items-start gap-3 cursor-pointer focus-within:ring-2 focus-within:ring-indigo-500 ${optionStyle(idx)} ${isAnswerSubmitted ? 'cursor-default' : ''}`}
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
            <span aria-hidden="true" className="w-5 h-5 rounded-full border border-current flex items-center justify-center shrink-0 text-[10px] font-bold">
              {String.fromCharCode(65 + idx)}
            </span>
            <span className="flex-1">{opt}</span>
          </label>
        ))}
      </div>

      {isAnswerSubmitted && (
        <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3" aria-live="polite">
          <div className="flex items-center gap-2">
            {isCorrect ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
                <CheckCircle size={15} /> ¡Correcto!
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-400">
                <XCircle size={15} /> Incorrecto
              </span>
            )}
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">{question.explanation}</p>
          {question.sourceTitles.length > 0 && (
            <div className="pt-2 border-t border-slate-800/60 flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-slate-400 font-medium">Fuentes respaldadas:</span>
              {question.sourceTitles.map((t, i) => (
                <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-indigo-300">
                  <BookOpen size={10} /> {t}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end">
        {!isAnswerSubmitted ? (
          <button
            type="button"
            onClick={onSubmit}
            disabled={selectedOption === null}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white shadow-lg shadow-indigo-600/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            Comprobar respuesta
          </button>
        ) : (
          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-600/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
          >
            {nextLabel || (isLast ? 'Ver resumen' : 'Siguiente pregunta')} <ArrowRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
};
