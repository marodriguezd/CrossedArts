import React from 'react';
import {
  Play,
  Sparkles,
  Layers,
  ListChecks,
  Shuffle,
  Filter,
  GraduationCap,
  BookOpen,
  AlertCircle
} from 'lucide-react';
import type { Flashcard, LearningResource, StudySessionMode } from '../../types/models.ts';
import type { StudyDifficulty } from '../../lib/studyGeneration/types.ts';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { Button, InlineStatus, Chip, INPUT_CLS, cn } from '../ui/index.tsx';

function isDue(dueDate: string): boolean {
  if (!dueDate) return true;
  const normalized = dueDate.includes('T') ? dueDate : `${dueDate.replace(' ', 'T')}Z`;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) return true;
  return parsed <= Date.now();
}

export interface ReviewConfigPanelProps {
  mode: StudySessionMode;
  onModeChange: (mode: StudySessionMode) => void;
  dueCount: number;
  originFilter: 'all' | 'course' | 'book' | 'general';
  onOriginFilterChange: (filter: 'all' | 'course' | 'book' | 'general') => void;
  flashcards: Flashcard[];
  resources: LearningResource[];
  selectedResourceId: string;
  onSelectedResourceChange: (id: string) => void;
  selectedLessonId: string;
  onClearSelectedLesson: () => void;
  lessonOptions: Array<{ id: string; title: string; courseTitle: string }>;
  topic: string;
  onTopicChange: (topic: string) => void;
  count: number;
  onCountChange: (count: number) => void;
  difficulty: StudyDifficulty;
  onDifficultyChange: (difficulty: StudyDifficulty) => void;
  onStart: () => void;
  onOpenFlashcardModal: () => void;
  onOpenOcclusionModal: () => void;
  error?: string | null;
}

export const ReviewConfigPanel: React.FC<ReviewConfigPanelProps> = ({
  mode,
  onModeChange,
  dueCount,
  originFilter,
  onOriginFilterChange,
  flashcards,
  resources,
  selectedResourceId,
  onSelectedResourceChange,
  selectedLessonId,
  onClearSelectedLesson,
  lessonOptions,
  topic,
  onTopicChange,
  count,
  onCountChange,
  difficulty,
  onDifficultyChange,
  onStart,
  onOpenFlashcardModal,
  onOpenOcclusionModal,
  error
}) => {
  const { t } = useLanguage();

  return (
    <section className="space-y-5 rounded-xl border border-line bg-surface p-5 shadow-card sm:p-6" aria-label={t('review.sessionConfigLabel')}>
      <div className="space-y-2">
        <span className="type-micro">Modalidad</span>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {([
            { id: 'flashcards', label: t('review.mode.flashcards'), icon: Layers, desc: t('review.modeDesc.flashcards', { n: dueCount }) },
            { id: 'practice', label: t('review.modeShort.practice'), icon: ListChecks, desc: t('review.modeDesc.practice') },
            { id: 'mixed', label: t('review.modeShort.mixed'), icon: Shuffle, desc: t('review.modeDesc.mixed') }
          ] as Array<{ id: StudySessionMode; label: string; icon: any; desc: string }>).map(opt => {
            const Icon = opt.icon;
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => onModeChange(opt.id)}
                aria-pressed={active}
                className={cn(
                  'rounded-xl border p-3 text-left transition-colors duration-fast',
                  active
                    ? 'border-accent/50 bg-accent-soft font-semibold text-ink shadow-card'
                    : 'border-line bg-canvas text-muted hover:border-line-strong hover:text-ink'
                )}
              >
                <span className="flex items-center gap-2 text-secondary">
                  <Icon size={15} className={active ? 'text-accent' : ''} aria-hidden="true" /> {opt.label}
                </span>
                <span className="mt-1 block text-meta">{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="type-micro flex items-center gap-1.5">
            <Filter size={12} className="text-accent" aria-hidden="true" />
            Origen del mazo ({dueCount} pendientes)
          </span>
          {originFilter !== 'all' && (
            <button
              type="button"
              onClick={() => onOriginFilterChange('all')}
              className="text-meta text-muted underline hover:text-ink"
            >
              Restablecer
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtrar por origen">
          <Chip active={originFilter === 'all'} onClick={() => onOriginFilterChange('all')}>
            Todo ({flashcards.filter(f => isDue(f.due_date)).length})
          </Chip>
          <Chip active={originFilter === 'course'} onClick={() => onOriginFilterChange('course')}>
            <GraduationCap size={13} aria-hidden="true" className="mr-1 inline" /> Cursos
          </Chip>
          <Chip active={originFilter === 'book'} onClick={() => onOriginFilterChange('book')}>
            <BookOpen size={13} aria-hidden="true" className="mr-1 inline" /> Libros
          </Chip>
          <Chip active={originFilter === 'general'} onClick={() => onOriginFilterChange('general')}>
            General
          </Chip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-resource">Recurso específico (opcional)</label>
          <select
            id="study-resource"
            value={selectedResourceId}
            onChange={e => onSelectedResourceChange(e.target.value)}
            className={INPUT_CLS}
          >
            <option value="">Todos los recursos</option>
            {resources.map(r => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </select>
          {selectedLessonId && (
            <p className="mt-1.5 flex items-center gap-1 text-meta text-accent">
              {t('review.lessonScope', {
                title:
                  lessonOptions.find(l => l.id === selectedLessonId)?.title ||
                  t('review.lessonFallback')
              })}
              <button type="button" onClick={onClearSelectedLesson} className="underline text-muted hover:text-ink">
                quitar
              </button>
            </p>
          )}
        </div>

        {(mode === 'practice' || mode === 'mixed') && (
          <div>
            <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-topic">Tema o consulta guía</label>
            <input
              id="study-topic"
              type="text"
              value={topic}
              onChange={e => onTopicChange(e.target.value)}
              placeholder={t('review.tagPlaceholder')}
              className={INPUT_CLS}
            />
          </div>
        )}
      </div>

      {(mode === 'practice' || mode === 'mixed') && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-meta font-medium text-muted" htmlFor="study-count">Número de preguntas ({count})</label>
            <input id="study-count" type="range" min="3" max="6" value={count} onChange={e => onCountChange(parseInt(e.target.value, 10))} className="w-full cursor-pointer accent-accent" />
          </div>
          <div>
            <span className="mb-1 block text-meta font-medium text-muted" id="study-difficulty-label">Dificultad</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-canvas p-1" role="group" aria-labelledby="study-difficulty-label">
              {(['easy', 'medium', 'hard'] as StudyDifficulty[]).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => onDifficultyChange(d)}
                  aria-pressed={difficulty === d}
                  className={cn(
                    'rounded-lg py-1.5 text-meta capitalize transition-colors',
                    difficulty === d ? 'bg-ink font-semibold text-canvas' : 'text-muted hover:text-ink'
                  )}
                >
                  {t(`study.difficulty.${d}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-4">
        <Button variant="solid" onClick={onStart}>
          <Play size={14} aria-hidden="true" /> Iniciar sesión
        </Button>
        <Button variant="outline" onClick={onOpenFlashcardModal}>
          <Sparkles size={14} aria-hidden="true" /> Generar flashcards
        </Button>
        <Button variant="outline" onClick={onOpenOcclusionModal}>
          <Layers size={14} aria-hidden="true" /> Oclusión de imagen
        </Button>
      </div>

      {error && (
        <InlineStatus tone="error">
          <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </InlineStatus>
      )}
    </section>
  );
};
