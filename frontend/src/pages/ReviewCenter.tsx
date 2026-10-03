import React, { useState } from 'react';
import { Flashcard } from '../types/models.ts';
import { Brain, CheckCircle2, RotateCcw, Sparkles, ThumbsUp, ArrowRight } from 'lucide-react';
import { dao } from '../db/dao.ts';
import confetti from 'canvas-confetti';

interface ReviewCenterProps {
  flashcards: Flashcard[];
  onRefresh: () => void;
}

export const ReviewCenter: React.FC<ReviewCenterProps> = ({ flashcards, onRefresh }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [completedSession, setCompletedSession] = useState(false);

  const card = flashcards[currentIndex];

  const handleGrade = async (grade: number) => {
    if (!card) return;
    await dao.reviewFlashcardSM2(card.id, grade);

    if (currentIndex + 1 < flashcards.length) {
      setCurrentIndex(currentIndex + 1);
      setShowAnswer(false);
    } else {
      setCompletedSession(true);
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 }
      });
      onRefresh();
    }
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setShowAnswer(false);
    setCompletedSession(false);
    onRefresh();
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-semibold">
          <Brain size={14} /> Active Recall & Repetición Espaciada SM-2
        </div>
        <h1 className="text-2xl font-extrabold text-white">Centro de Repaso Cognitivo</h1>
        <p className="text-xs text-slate-400">
          Afianza tus aprendizajes evaluando tu recuerdo activo. El algoritmo SM-2 calculará el próximo intervalo óptimo.
        </p>
      </div>

      {!completedSession && card ? (
        <div className="space-y-6">
          {/* Progress bar */}
          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Tarjeta {currentIndex + 1} de {flashcards.length}</span>
            <span>Factor de facilidad: {card.ease_factor}</span>
          </div>
          <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
            <div 
              className="bg-purple-600 h-full rounded-full transition-all duration-300"
              style={{ width: `${((currentIndex + 1) / flashcards.length) * 100}%` }}
            />
          </div>

          {/* Flashcard interactive flip card */}
          <div 
            onClick={() => setShowAnswer(!showAnswer)}
            className="min-h-[280px] p-8 rounded-2xl bg-gradient-to-br from-slate-900 via-slate-900/90 to-purple-950/30 border border-purple-500/30 shadow-2xl flex flex-col justify-between cursor-pointer hover:border-purple-400/50 transition-all duration-300"
          >
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-purple-400">
                {showAnswer ? 'Reverso / Respuesta' : 'Anverso / Pregunta'}
              </span>
              <h2 className="text-lg md:text-xl font-bold text-white mt-4 leading-relaxed">
                {card.front}
              </h2>
            </div>

            {showAnswer ? (
              <div className="mt-6 pt-6 border-t border-purple-500/20 animate-fade-in">
                <p className="text-sm md:text-base text-slate-200 leading-relaxed font-normal">
                  {card.back}
                </p>
              </div>
            ) : (
              <div className="text-center pt-8">
                <span className="text-xs text-purple-300/70 inline-flex items-center gap-1.5">
                  <Sparkles size={13} /> Haz clic en cualquier lugar para revelar la respuesta
                </span>
              </div>
            )}
          </div>

          {/* SM-2 Grading buttons */}
          {showAnswer && (
            <div className="space-y-2 animate-fade-in">
              <p className="text-center text-xs text-slate-400 font-medium">¿Qué tan fácil recordaste este concepto?</p>
              <div className="grid grid-cols-4 gap-2">
                <button
                  onClick={() => handleGrade(1)}
                  className="p-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-semibold transition"
                >
                  1 - Olvidado
                  <span className="block text-[10px] text-rose-400 font-normal mt-0.5">Repetir hoy</span>
                </button>
                <button
                  onClick={() => handleGrade(3)}
                  className="p-3 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-semibold transition"
                >
                  3 - Difícil
                  <span className="block text-[10px] text-amber-400 font-normal mt-0.5">Intervalo corto</span>
                </button>
                <button
                  onClick={() => handleGrade(4)}
                  className="p-3 rounded-xl bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold transition"
                >
                  4 - Bien
                  <span className="block text-[10px] text-indigo-400 font-normal mt-0.5">Intervalo normal</span>
                </button>
                <button
                  onClick={() => handleGrade(5)}
                  className="p-3 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-semibold transition"
                >
                  5 - Perfecto
                  <span className="block text-[10px] text-emerald-400 font-normal mt-0.5">Retención alta</span>
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800 text-center space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-purple-500/20 text-purple-300 flex items-center justify-center mx-auto">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-xl font-bold text-white">¡Sesión de Repaso Completada!</h2>
          <p className="text-xs text-slate-300 max-w-md mx-auto">
            Has repasado todas tus tarjetas pendientes. Tus intervalos SM-2 han sido actualizados en la base de datos local SQLite.
          </p>
          <button
            onClick={handleRestart}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition"
          >
            <RotateCcw size={14} /> Repasar de nuevo
          </button>
        </div>
      )}
    </div>
  );
};
