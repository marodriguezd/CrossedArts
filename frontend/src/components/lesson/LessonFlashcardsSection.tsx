import React from 'react';
import {
  Brain,
  Play,
  Plus,
  Sparkles,
  X,
  Save,
  Edit3,
  Trash2
} from 'lucide-react';
import type { Flashcard } from '../../types/models.ts';
import { parseUtcTimestamp } from '../../services/domainLogic.ts';
import { Button, Badge, EmptyState, INPUT_CLS, cn } from '../ui/index.tsx';
import { useLanguage } from '../../hooks/useLanguage.ts';

export interface LessonFlashcardsSectionProps {
  flashcards: Flashcard[];
  isCreatingCard: boolean;
  setIsCreatingCard: (creating: boolean | ((v: boolean) => boolean)) => void;
  cardForm: { front: string; back: string };
  setCardForm: React.Dispatch<React.SetStateAction<{ front: string; back: string }>>;
  isSavingCard: boolean;
  onCreateCard: (e: React.FormEvent) => Promise<void>;
  editingCardId: string | null;
  setEditingCardId: (id: string | null) => void;
  editCardForm: { front: string; back: string };
  setEditCardForm: React.Dispatch<React.SetStateAction<{ front: string; back: string }>>;
  onUpdateCard: (cardId: string) => Promise<void>;
  onStartEditCard: (card: Flashcard) => void;
  onDeleteCardClick: (cardId: string) => void;
  onStudyFlashcards: () => void;
  onOpenGenerateModal: () => void;
}

export const LessonFlashcardsSection: React.FC<LessonFlashcardsSectionProps> = ({
  flashcards,
  isCreatingCard,
  setIsCreatingCard,
  cardForm,
  setCardForm,
  isSavingCard,
  onCreateCard,
  editingCardId,
  setEditingCardId,
  editCardForm,
  setEditCardForm,
  onUpdateCard,
  onStartEditCard,
  onDeleteCardClick,
  onStudyFlashcards,
  onOpenGenerateModal
}) => {
  const { t } = useLanguage();

  return (
    <section className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5" aria-label={t('lessonWorkspace.cardsSectionLabel')}>
      <div className="mb-4 flex flex-col gap-3 border-b border-line pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Brain size={18} className="text-accent" aria-hidden="true" />
          <h3 className="type-section text-ink">Tarjetas de estudio ({flashcards.length})</h3>
          <Badge tone={flashcards.length > 0 ? 'success' : 'neutral'} className="font-mono text-micro">
            SM-2
          </Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {flashcards.length > 0 && (
            <Button size="sm" variant="solid" onClick={onStudyFlashcards}>
              <Play size={12} aria-hidden="true" /> Repasar tarjetas
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setIsCreatingCard(v => !v)}>
            <Plus size={12} aria-hidden="true" /> {isCreatingCard ? 'Cerrar' : 'Nueva tarjeta'}
          </Button>
          <Button size="sm" variant="quiet" onClick={onOpenGenerateModal}>
            <Sparkles size={12} aria-hidden="true" /> Generar con IA
          </Button>
        </div>
      </div>

      {isCreatingCard && (
        <form onSubmit={onCreateCard} className="mb-4 space-y-3 rounded-lg border border-accent/30 bg-accent-soft/40 p-4">
          <p className="text-meta font-semibold text-ink">Nueva tarjeta de estudio para esta lección</p>
          <div>
            <label className="mb-1 block text-meta font-medium text-muted" htmlFor="new-card-front">
              Anverso (pregunta, concepto o prompt)
            </label>
            <textarea
              id="new-card-front"
              rows={2}
              value={cardForm.front}
              onChange={e => setCardForm(f => ({ ...f, front: e.target.value }))}
              placeholder={t('lessonWorkspace.cardFrontPlaceholder')}
              required
              className={cn(INPUT_CLS, 'resize-y')}
            />
          </div>
          <div>
            <label className="mb-1 block text-meta font-medium text-muted" htmlFor="new-card-back">
              Reverso (respuesta esperada o explicación clave)
            </label>
            <textarea
              id="new-card-back"
              rows={3}
              value={cardForm.back}
              onChange={e => setCardForm(f => ({ ...f, back: e.target.value }))}
              placeholder="La respuesta clave fundamentada en el contenido..."
              required
              className={cn(INPUT_CLS, 'resize-y')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="quiet" onClick={() => setIsCreatingCard(false)}>
              <X size={12} aria-hidden="true" /> Cancelar
            </Button>
            <Button size="sm" variant="solid" type="submit" disabled={isSavingCard}>
              <Save size={12} aria-hidden="true" /> {isSavingCard ? 'Guardando…' : 'Guardar tarjeta'}
            </Button>
          </div>
        </form>
      )}

      {flashcards.length === 0 && !isCreatingCard ? (
        <EmptyState
          title={t('lessonWorkspace.emptyCardsTitle')}
          hint={t('lessonWorkspace.emptyCardsHint')}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {flashcards.map(card => {
            const isEditingThis = editingCardId === card.id;
            const isDueToday = parseUtcTimestamp(card.due_date) <= Date.now();

            if (isEditingThis) {
              return (
                <div key={card.id} className="col-span-full space-y-3 rounded-lg border border-accent bg-surface p-4 shadow-sm">
                  <p className="text-meta font-semibold text-ink">Editando tarjeta</p>
                  <div>
                    <label className="mb-1 block text-meta font-medium text-muted" htmlFor={`edit-front-${card.id}`}>Anverso</label>
                    <textarea
                      id={`edit-front-${card.id}`}
                      rows={2}
                      value={editCardForm.front}
                      onChange={e => setEditCardForm(f => ({ ...f, front: e.target.value }))}
                      className={cn(INPUT_CLS, 'resize-y')}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-meta font-medium text-muted" htmlFor={`edit-back-${card.id}`}>Reverso</label>
                    <textarea
                      id={`edit-back-${card.id}`}
                      rows={3}
                      value={editCardForm.back}
                      onChange={e => setEditCardForm(f => ({ ...f, back: e.target.value }))}
                      className={cn(INPUT_CLS, 'resize-y')}
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="quiet" onClick={() => setEditingCardId(null)}>
                      <X size={12} aria-hidden="true" /> Cancelar
                    </Button>
                    <Button size="sm" variant="solid" onClick={() => void onUpdateCard(card.id)}>
                      <Save size={12} aria-hidden="true" /> Guardar cambios
                    </Button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={card.id}
                className="flex flex-col justify-between rounded-lg border border-line bg-canvas p-3.5 transition hover:border-line-strong"
              >
                <div className="space-y-2">
                  <div>
                    <span className="text-micro font-semibold uppercase tracking-wider text-faint">Anverso</span>
                    <p className="mt-0.5 text-meta font-medium text-ink break-words">{card.front}</p>
                  </div>
                  <div className="border-t border-line/60 pt-2">
                    <span className="text-micro font-semibold uppercase tracking-wider text-faint">Reverso</span>
                    <p className="mt-0.5 text-secondary text-muted break-words">{card.back}</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2.5 text-micro">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={isDueToday ? 'warning' : 'neutral'} className="font-mono">
                      {isDueToday ? 'Para repasar' : `${card.interval_days}d`}
                    </Badge>
                    <span className="text-faint font-mono">
                      Reps: {card.repetition_count} · EF: {card.ease_factor.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => onStartEditCard(card)}
                      aria-label="Editar tarjeta"
                      className="h-7 px-2"
                    >
                      <Edit3 size={11} aria-hidden="true" />
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onDeleteCardClick(card.id)}
                      aria-label="Eliminar tarjeta"
                      className="h-7 px-2"
                    >
                      <Trash2 size={11} aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
