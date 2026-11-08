import React from 'react';
import {
  CheckCircle,
  Circle,
  Play,
  Clock,
  Check,
  Brain,
  Sparkles,
  ListChecks,
  FileText,
  ArrowUp,
  ArrowDown,
  AlertCircle
} from 'lucide-react';
import type { Lesson, LessonWorkspace as LessonWorkspaceModel, StudySessionMode } from '../../types/models.ts';
import { useLanguage } from '../../hooks/useLanguage.ts';
import { Button, Badge, InlineStatus } from '../ui/index.tsx';

const PROGRESS_LABELS: Record<LessonWorkspaceModel['progress'], string> = {
  NOT_STARTED: 'Sin empezar',
  IN_PROGRESS: 'En progreso',
  COMPLETED: 'Completada'
};

export interface LessonHeaderProps {
  moduleTitle: string;
  lesson: Lesson;
  progress: LessonWorkspaceModel['progress'];
  onMoveLesson: (direction: 'up' | 'down') => void;
  onToggleComplete: () => Promise<void>;
  onStudyLesson: (mode: StudySessionMode) => void;
  onExplainResource: () => void;
  onOpenGenerateModal: () => void;
  feedback: { type: 'success' | 'error'; text: string } | null;
}

export const LessonHeader: React.FC<LessonHeaderProps> = ({
  moduleTitle,
  lesson,
  progress,
  onMoveLesson,
  onToggleComplete,
  onStudyLesson,
  onExplainResource,
  onOpenGenerateModal,
  feedback
}) => {
  const { t } = useLanguage();

  const progressTone =
    progress === 'COMPLETED'
      ? 'success'
      : progress === 'IN_PROGRESS'
        ? 'warning'
        : 'neutral';

  return (
    <div className="rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="type-micro">{moduleTitle}</p>
          <h2 className="type-title mt-0.5 break-words text-ink">{lesson.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge tone={progressTone as any}>
              {progress === 'COMPLETED' ? <CheckCircle size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
              {PROGRESS_LABELS[progress]}
            </Badge>
            <span className="flex items-center gap-1 text-meta text-muted">
              <Clock size={12} aria-hidden="true" /> {lesson.duration_minutes} min
            </span>
            <span className="flex items-center gap-1 text-meta text-muted">
              <FileText size={12} aria-hidden="true" /> {lesson.lesson_type}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="quiet"
            onClick={() => onMoveLesson('up')}
            aria-label={`Mover la lección ${lesson.title} hacia arriba`}
          >
            <ArrowUp size={13} aria-hidden="true" /> Subir
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => onMoveLesson('down')}
            aria-label={`Mover la lección ${lesson.title} hacia abajo`}
          >
            <ArrowDown size={13} aria-hidden="true" /> Bajar
          </Button>
          <Button
            size="sm"
            variant={lesson.is_completed ? 'outline' : 'solid'}
            onClick={() => void onToggleComplete()}
            aria-label={lesson.is_completed ? t('lessonWorkspace.reopen') : t('lessonWorkspace.markDone')}
            className={lesson.is_completed ? 'border-success/40 text-success' : ''}
          >
            {lesson.is_completed ? <><Check size={13} aria-hidden="true" /> Completada</> : <><CheckCircle size={13} aria-hidden="true" /> Marcar completada</>}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <Button size="sm" variant="solid" onClick={() => onStudyLesson('mixed')}>
          <Play size={13} aria-hidden="true" /> Estudiar esta lección
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStudyLesson('flashcards')}>
          <Brain size={13} aria-hidden="true" /> Repasar flashcards
        </Button>
        <Button size="sm" variant="outline" onClick={() => onStudyLesson('practice')}>
          <ListChecks size={13} aria-hidden="true" /> Preguntas de práctica
        </Button>
        <Button size="sm" variant="outline" onClick={onExplainResource}>
          <Sparkles size={13} aria-hidden="true" /> Explicar esta lección
        </Button>
        <Button size="sm" variant="outline" onClick={onOpenGenerateModal}>
          <Sparkles size={13} aria-hidden="true" /> Generar flashcards
        </Button>
      </div>

      {feedback && (
        <div className="mt-3">
          <InlineStatus tone={feedback.type === 'success' ? 'success' : 'error'}>
            {feedback.type === 'success' ? <CheckCircle size={14} className="shrink-0" aria-hidden="true" /> : <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
            <span>{feedback.text}</span>
          </InlineStatus>
        </div>
      )}
    </div>
  );
};
