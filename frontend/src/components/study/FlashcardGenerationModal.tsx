import React, { useState, useEffect, useRef } from 'react';
import { X, Sparkles, Trash2, Check, AlertCircle, BookOpen } from 'lucide-react';
import type { GeneratedFlashcard, StudyDifficulty } from '../../lib/studyGeneration/types.ts';
import { aiService } from '../../ai/aiService.ts';
import { dao } from '../../db/dao.ts';
import { Button, InlineStatus, cn } from '../ui/index.tsx';

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
        lesson_id: lessonId,
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

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gen-cards-title"
        className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-line bg-raised shadow-pop"
      >
        {/* Cabecera */}
        <div className="flex items-center justify-between border-b border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-accent/25 bg-accent-soft p-2 text-accent">
              <Sparkles size={20} aria-hidden="true" />
            </div>
            <div>
              <h2 id="gen-cards-title" className="type-section text-ink">Generar flashcards fundamentadas</h2>
              <p className="type-meta">Creación pedagógica local basada en tus fuentes y notas</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar diálogo"
            className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Cuerpo */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {/* Opciones del formulario */}
          <div className="space-y-4 rounded-xl border border-line bg-canvas p-4">
            <div>
              <label className="mb-1 block text-meta font-semibold text-muted" htmlFor="gen-topic">Tema o consulta guía</label>
              <input
                id="gen-topic"
                ref={topicInputRef}
                type="text"
                value={topic}
                onChange={e => setTopic(e.target.value)}
                placeholder="Ej. Hooks en React, Algoritmo SM-2, Estado…"
                className={INPUT_CLS}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-meta font-semibold text-muted" htmlFor="gen-count">
                  Cantidad ({count} tarjetas)
                </label>
                <input
                  id="gen-count"
                  type="range"
                  min="3"
                  max="8"
                  value={count}
                  onChange={e => setCount(parseInt(e.target.value, 10))}
                  className="w-full cursor-pointer accent-accent"
                />
                <div className="mt-0.5 flex justify-between text-micro">
                  <span>3</span>
                  <span>5</span>
                  <span>8</span>
                </div>
              </div>

              <div>
                <span className="mb-1 block text-meta font-semibold text-muted" id="gen-difficulty-label">Dificultad</span>
                <div
                  className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface p-1"
                  role="group"
                  aria-labelledby="gen-difficulty-label"
                >
                  {(['easy', 'medium', 'hard'] as StudyDifficulty[]).map(d => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDifficulty(d)}
                      aria-pressed={difficulty === d}
                      className={cn(
                        'rounded-lg py-1.5 text-meta capitalize transition-colors',
                        difficulty === d ? 'bg-ink font-semibold text-canvas' : 'text-muted hover:text-ink'
                      )}
                    >
                      {d === 'easy' ? 'Fácil' : d === 'medium' ? 'Media' : 'Difícil'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Button variant="solid" className="w-full" onClick={handleGenerate} disabled={isGenerating}>
                <Sparkles size={14} className={isGenerating ? 'animate-spin' : ''} aria-hidden="true" />
                {isGenerating ? 'Recuperando contexto y generando…' : 'Generar tarjetas'}
              </Button>
            </div>
          </div>

          {/* Feedback / error */}
          {errorMsg && (
            <InlineStatus tone="warning">
              <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>Aviso pedagógico:</strong> {errorMsg}
              </span>
            </InlineStatus>
          )}

          {/* Mensaje de éxito */}
          {saveSuccessCount !== null && (
            <InlineStatus tone="success">
              <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                ¡Se han guardado con éxito <strong>{saveSuccessCount}</strong> flashcards en tu mazo SM-2!
              </span>
            </InlineStatus>
          )}

          {/* Fuentes */}
          {sources.length > 0 && (
            <div className="space-y-1">
              <span className="type-micro">Fuentes de aprendizaje respaldadas:</span>
              <div className="flex flex-wrap gap-1.5">
                {sources.map((s, idx) => (
                  <span key={idx} className="inline-flex items-center gap-1 rounded-full border border-line bg-canvas px-2.5 py-0.5 text-meta text-muted">
                    <BookOpen size={11} aria-hidden="true" /> {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Lista de previsualización */}
          {previewCards.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-item font-semibold text-ink">
                  Previsualización ({previewCards.length} tarjetas generadas)
                </span>
                <span className="text-micro">Edita cualquier campo antes de guardar</span>
              </div>

              <div className="space-y-3">
                {previewCards.map((c, i) => (
                  <div key={c.id || i} className="relative space-y-2 rounded-xl border border-line bg-canvas p-3.5">
                    <button
                      onClick={() => handleDeleteCard(i)}
                      className="absolute right-2.5 top-2.5 rounded p-1 text-faint transition hover:text-error"
                      title="Descartar esta tarjeta"
                      aria-label={`Descartar tarjeta ${i + 1}`}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                    <div>
                      <label className="text-micro text-accent" htmlFor={`card-front-${i}`}>Anverso (Pregunta)</label>
                      <input
                        id={`card-front-${i}`}
                        type="text"
                        value={c.front}
                        onChange={e => handleCardChange(i, 'front', e.target.value)}
                        className="mt-0.5 w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body text-ink focus:border-accent/50 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-micro" htmlFor={`card-back-${i}`}>Reverso (Respuesta)</label>
                      <textarea
                        id={`card-back-${i}`}
                        rows={2}
                        value={c.back}
                        onChange={e => handleCardChange(i, 'back', e.target.value)}
                        className="mt-0.5 w-full resize-none rounded-lg border border-line bg-surface px-2.5 py-1.5 text-body text-ink focus:border-accent/50 focus:outline-none"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Pie */}
        {previewCards.length > 0 && (
          <div className="flex items-center justify-between border-t border-line bg-surface p-4">
            <span className="text-meta text-muted">
              Se programarán con SM-2 (intervalo inicial: 1 día)
            </span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="quiet" onClick={() => setPreviewCards([])}>
                Descartar todas
              </Button>
              <Button size="sm" variant="solid" onClick={handleSaveToDeck} disabled={isSaving}>
                <Check size={14} aria-hidden="true" />
                {isSaving ? 'Guardando…' : `Guardar ${previewCards.length} tarjetas en SQLite`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
