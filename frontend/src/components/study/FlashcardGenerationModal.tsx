import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Plus, Trash2, Check, AlertCircle, BookOpen, Layers } from 'lucide-react';
import type { GeneratedFlashcard, StudyDifficulty } from '../../lib/studyGeneration/types.ts';
import { aiService } from '../../ai/aiService.ts';
import { dao } from '../../db/dao.ts';

interface FlashcardGenerationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCardsSaved: () => void;
  initialTopic?: string;
  resourceId?: string;
  /** Ámbito de lección para priorizar su contenido al generar tarjetas. */
  lessonId?: string;
}

export const FlashcardGenerationModal: React.FC<FlashcardGenerationModalProps> = ({
  isOpen,
  onClose,
  onCardsSaved,
  initialTopic = '',
  resourceId,
  lessonId
}) => {
  const [topic, setTopic] = useState(initialTopic);
  const [count, setCount] = useState<number>(4);
  const [difficulty, setDifficulty] = useState<StudyDifficulty>('medium');
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewCards, setPreviewCards] = useState<GeneratedFlashcard[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [saveSuccessCount, setSaveSuccessCount] = useState<number | null>(null);
  const topicInputRef = useRef<HTMLInputElement>(null);

  // Accesibilidad: Escape cierra el diálogo y el foco inicial va al primer campo.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    const focusTimer = setTimeout(() => topicInputRef.current?.focus(), 30);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(focusTimer);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleGenerate = async () => {
    setIsGenerating(true);
    setErrorMsg(null);
    setSaveSuccessCount(null);
    setPreviewCards([]);
    setSources([]);

    try {
      const res = await aiService.generateFlashcards({
        count,
        difficulty,
        topic: topic.trim() || undefined,
        resourceId,
        lessonId
      });

      if (res.error) {
        setErrorMsg(res.error);
      } else {
        setPreviewCards(res.cards);
        setSources(res.sourceTitles);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error inesperado al generar tarjetas.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCardChange = (index: number, field: 'front' | 'back', value: string) => {
    setPreviewCards(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const handleDeleteCard = (index: number) => {
    setPreviewCards(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveToDeck = async () => {
    if (previewCards.length === 0) return;
    setIsSaving(true);
    setErrorMsg(null);

    try {
      const cardsToPersist = previewCards.map(c => ({
        resource_id: resourceId,
        front: c.front.trim(),
        back: c.back.trim()
      })).filter(c => c.front && c.back);

      const inserted = await dao.createFlashcards(cardsToPersist);
      setSaveSuccessCount(inserted.length);
      setPreviewCards([]);
      onCardsSaved();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Error al guardar las tarjetas en la base de datos.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
              <Sparkles size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Generar Flashcards Fundamentadas</h2>
              <p className="text-xs text-slate-400">Creación pedagógica local basada en tus fuentes y notas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-5 flex-1">
          {/* Form Options */}
          <div className="space-y-4 bg-slate-950/40 p-4 rounded-xl border border-slate-800/80">
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Tema o Consulta Guía</label>
              <input
                ref={topicInputRef}
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="Ej. Hooks en React, Algoritmo SM-2, Estado..."
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Cantidad ({count} tarjetas)
                </label>
                <input
                  type="range"
                  min="3"
                  max="8"
                  value={count}
                  onChange={e => setCount(parseInt(e.target.value, 10))}
                  className="w-full accent-purple-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>3</span>
                  <span>5</span>
                  <span>8</span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Dificultad</label>
                <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                  {(['easy', 'medium', 'hard'] as StudyDifficulty[]).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      className={`py-1 rounded-lg text-[11px] font-medium capitalize transition ${
                        difficulty === d ? 'bg-purple-600 text-white font-semibold' : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {d === 'easy' ? 'Fácil' : d === 'medium' ? 'Media' : 'Difícil'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white shadow-lg shadow-purple-600/20 transition"
              >
                <Sparkles size={14} className={isGenerating ? 'animate-spin' : ''} />
                {isGenerating ? 'Recuperando contexto y generando...' : 'Generar Tarjetas'}
              </button>
            </div>
          </div>

          {/* Feedback / Error */}
          {errorMsg && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Aviso pedagógico:</span> {errorMsg}
              </div>
            </div>
          )}

          {/* Success Message */}
          {saveSuccessCount !== null && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
              <Check size={16} />
              <span>¡Se han guardado con éxito <strong>{saveSuccessCount}</strong> flashcards en tu mazo SM-2!</span>
            </div>
          )}

          {/* Sources Badge */}
          {sources.length > 0 && (
            <div className="space-y-1">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Fuentes de Aprendizaje Respaldadas:</span>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 text-[11px] px-2.5 py-0.5 rounded-md bg-slate-800 text-purple-300 border border-slate-700">
                    <BookOpen size={11} /> {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Cards Preview List */}
          {previewCards.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-300">
                  Previsualización ({previewCards.length} tarjetas generadas)
                </span>
                <span className="text-[10px] text-slate-400">Edita cualquier campo antes de guardar</span>
              </div>

              <div className="space-y-3">
                {previewCards.map((c, i) => (
                  <div key={c.id || i} className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 space-y-2 relative group">
                    <button
                      onClick={() => handleDeleteCard(i)}
                      className="absolute top-2.5 right-2.5 p-1 text-slate-500 hover:text-red-400 rounded transition"
                      title="Descartar esta tarjeta"
                    >
                      <Trash2 size={13} />
                    </button>
                    <div>
                      <label className="text-[10px] font-bold text-purple-400 uppercase">Anverso (Pregunta)</label>
                      <input
                        type="text"
                        value={c.front}
                        onChange={e => handleCardChange(i, 'front', e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-800 text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Reverso (Respuesta)</label>
                      <textarea
                        rows={2}
                        value={c.back}
                        onChange={e => handleCardChange(i, 'back', e.target.value)}
                        className="w-full mt-0.5 px-2.5 py-1.5 text-xs rounded-lg bg-slate-900 border border-slate-800 text-slate-200 focus:outline-none focus:border-purple-500 resize-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {previewCards.length > 0 && (
          <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              Se programarán con SM-2 (intervalo inicial: 1 día)
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPreviewCards([])}
                className="px-3 py-1.5 text-xs text-slate-400 hover:text-white transition"
              >
                Descartar todas
              </button>
              <button
                onClick={handleSaveToDeck}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20 transition disabled:opacity-50"
              >
                <Check size={14} />
                {isSaving ? 'Guardando...' : `Guardar ${previewCards.length} tarjetas en SQLite`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
