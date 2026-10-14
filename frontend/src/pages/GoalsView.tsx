import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarClock,
  Check,
  Flag,
  GraduationCap,
  Pencil,
  Plus,
  RotateCcw,
  Target,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { resolveLocalDay } from '../services/localDate.ts';
import {
  GOAL_KINDS,
  classifyGoalDeadline,
  goalDeadlineLabel,
  goalKindLabel,
  goalUnitLabel,
  normalizeGoalDate,
  summarizeGoals,
  validateGoalDraft,
  type GoalDeadlineState,
  type GoalProgress,
  type GoalUnit
} from '../services/goals.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';
import { useLanguage } from '../hooks/useLanguage.ts';
import type { GoalKind, LearningGoal } from '../types/models.ts';
import { useGoalProgress } from '../hooks/useGoalProgress.ts';
import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';

interface GoalsViewProps {
  goals: LearningGoal[];
  courses: import('../types/models.ts').Course[];
  books: import('../types/models.ts').Book[];
  practiceWork: import('../types/models.ts').PracticeWork[];
  onRefresh: () => Promise<void>;
  /** Goal selected when arriving from the palette, focus, or graph. */
  initialGoalId?: string | null;
}

const INPUT_CLS =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-meta text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

const KIND_ICONS: Partial<Record<GoalKind, React.ComponentType<any>>> = {
  course: GraduationCap,
  book: BookOpen,
  study_time: Flag,
};

const DEADLINE_TONES: Record<GoalDeadlineState, 'neutral' | 'accent' | 'warning' | 'success'> = {
  completed: 'success',
  overdue: 'warning',
  due_soon: 'accent',
  upcoming: 'neutral',
  no_deadline: 'neutral',
};

/* Goal-kind options are built in-component (localized). */

interface GoalDraftState {
  title: string;
  description: string;
  kind: GoalKind;
  resource_id: string;
  target_value: string;
  target_date: string;
}

const EMPTY_DRAFT: GoalDraftState = {
  title: '',
  description: '',
  kind: 'course',
  resource_id: '',
  target_value: '',
  target_date: ''
};

/** Honest measure label for a goal (never concatenates units). */
function progressLine(progress: GoalProgress, lang: LanguageCode = 'es'): string {
  if (!progress.measurable) return progress.basis;
  const current = progress.current ?? 0;
  const target = progress.target;
  if (target === null) return progress.basis;
  return translateKey(lang, 'goals.page.measureOf', {
    cur: current,
    target,
    unit: goalUnitLabel(progress.unit as GoalUnit, lang)
  });
}

/**
 * Goals view: personal planning tied to real data.
 *
 * The distinction underpinning the whole screen (and its tests):
 *  - MEASURED PROGRESS: derived on every read (bar + explicit basis).
 *  - TARGET / DATE: user-defined (separate chip).
 *  - STATE: active or completed, decided by the user (never automatic).
 */
export const GoalsView: React.FC<GoalsViewProps> = ({
  goals,
  courses,
  books,
  practiceWork,
  onRefresh,
  initialGoalId
}) => {
  const { day: localDay } = resolveLocalDay();
  const { t, effective } = useLanguage();
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork, effective);
  const kindOptions = GOAL_KINDS.map(kind => ({ value: kind, label: goalKindLabel(kind, effective) }));

  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<GoalDraftState>(EMPTY_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; description: string; target_date: string; target_value: string }>({
    title: '',
    description: '',
    target_date: '',
    target_value: ''
  });
  const [pendingDelete, setPendingDelete] = useState<LearningGoal | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const selectedRef = useRef<HTMLLIElement | null>(null);

  const summary = useMemo(
    () => summarizeGoals(goals, goal => progressByGoal.get(goal.id) ?? fallbackProgress(effective), localDay),
    [goals, progressByGoal, localDay]
  );

  // Arriving from another view: the chosen goal stays visible and marked.
  useEffect(() => {
    if (!initialGoalId) return;
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [initialGoalId]);

  const resourceOptions = useMemo(() => {
    const options = [
      ...courses.map(course => ({ id: course.id, title: t('goals.page.coursePrefix', { title: course.title }) })),
      ...books.map(book => ({ id: book.id, title: t('goals.page.bookPrefix', { title: book.title }) }))
    ];
    return options.sort((a, b) => a.title.localeCompare(b.title));
  }, [courses, books, t]);

  const needsResource = draft.kind === 'course' || draft.kind === 'book';
  const hasTargetValue = draft.kind === 'practice' || draft.kind === 'study_time';

  const handleCreate = async () => {
    const targetValue = hasTargetValue && draft.target_value.trim() !== '' ? Number(draft.target_value) : null;
    const validation = validateGoalDraft({
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      resource_id: needsResource ? draft.resource_id : draft.resource_id || null,
      target_value: targetValue,
      target_date: draft.target_date || null
    }, effective);
    if (!validation.ok) {
      setFormError(validation.error || t('goals.page.createFail'));
      return;
    }
    setFormError(null);
    try {
      await dao.createGoal({
        title: draft.title.trim(),
        description: draft.description.trim() || undefined,
        kind: draft.kind,
        resource_id: draft.resource_id || null,
        target_value: targetValue,
        target_date: normalizeGoalDate(draft.target_date)
      });
      setDraft(EMPTY_DRAFT);
      setIsAdding(false);
      await onRefresh();
    } catch {
      setFormError(t('goals.page.saveLocalFail'));
    }
  };

  const handleComplete = async (goal: LearningGoal) => {
    setActionError(null);
    try {
      await dao.updateGoal(goal.id, { status: 'completed' });
      await onRefresh();
    } catch {
      setActionError(t('goals.page.completeFail'));
    }
  };

  const handleReopen = async (goal: LearningGoal) => {
    setActionError(null);
    try {
      await dao.updateGoal(goal.id, { status: 'active' });
      await onRefresh();
    } catch {
      setActionError(t('goals.page.reopenFail'));
    }
  };

  const startEdit = (goal: LearningGoal) => {
    setEditingId(goal.id);
    setActionError(null);
    setEditDraft({
      title: goal.title,
      description: goal.description || '',
      target_date: normalizeGoalDate(goal.target_date) || '',
      target_value: typeof goal.target_value === 'number' ? String(goal.target_value) : ''
    });
  };

  const handleSaveEdit = async (goal: LearningGoal) => {
    if (!editDraft.title.trim()) {
      setActionError(t('goals.validate.title'));
      return;
    }
    const hasNumericTarget = goal.kind === 'practice' || goal.kind === 'study_time';
    const targetValue = hasNumericTarget && editDraft.target_value.trim() !== ''
      ? Number(editDraft.target_value)
      : null;
    const validation = validateGoalDraft({
      title: editDraft.title,
      kind: goal.kind,
      resource_id: goal.resource_id,
      target_value: targetValue,
      target_date: editDraft.target_date || null
    }, effective);
    if (!validation.ok) {
      setActionError(validation.error || t('goals.page.checkFallback'));
      return;
    }
    setActionError(null);
    try {
      await dao.updateGoal(goal.id, {
        title: editDraft.title.trim(),
        description: editDraft.description.trim() || undefined,
        target_date: normalizeGoalDate(editDraft.target_date) ?? undefined,
        target_value: targetValue ?? undefined
      });
      setEditingId(null);
      await onRefresh();
    } catch {
      setActionError(t('goals.page.saveFail'));
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await dao.deleteGoal(pendingDelete.id);
      setPendingDelete(null);
      await onRefresh();
    } catch {
      setActionError(t('goals.page.deleteFail'));
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">{t('goals.page.title')}</h1>
          <p className="type-secondary mt-1">
            {t('goals.page.subtitle')}
          </p>
        </div>
        <Button
          variant="solid"
          onClick={() => { setFormError(null); setIsAdding(value => !value); }}
          aria-expanded={isAdding}
          aria-controls="goal-create-form"
        >
          <Plus size={15} aria-hidden="true" />
          {t('goals.page.newGoal')}
        </Button>
      </header>

      {/* Status summary: facts, not scores. */}
      <div className="flex flex-wrap gap-2" aria-label={t('goals.page.summaryLabel')}>
        <Badge tone="accent">{t('goals.page.active', { n: summary.active, s: summary.active === 1 ? '' : 's' })}</Badge>
        <Badge tone={summary.overdue > 0 ? 'warning' : 'neutral'}>{t('goals.page.overdue', { n: summary.overdue, s: summary.overdue === 1 ? '' : 's' })}</Badge>
        <Badge tone="neutral">{t('goals.page.dueSoon', { n: summary.dueSoon })}</Badge>
        <Badge tone={summary.readyToComplete > 0 ? 'success' : 'neutral'}>
          {t('goals.page.ready', { n: summary.readyToComplete, s: summary.readyToComplete === 1 ? '' : 's' })}
        </Badge>
        <Badge tone="neutral">{t('goals.page.done', { n: summary.completed, s: summary.completed === 1 ? '' : 's' })}</Badge>
      </div>

      {actionError && (
        <p role="alert" className="text-meta text-error">{actionError}</p>
      )}

      {isAdding && (
        <Panel className="p-5">
          <div id="goal-create-form" className="space-y-3">
            <h2 className="type-section text-ink">{t('goals.page.newGoal')}</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="type-micro text-muted">{t('goals.page.titleLabel')}</span>
                <input
                  type="text"
                  value={draft.title}
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder={t('goals.page.titlePh')}
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="type-micro text-muted">{t('goals.page.kindLabel')}</span>
                <select
                  value={draft.kind}
                  onChange={e => setDraft(d => ({ ...d, kind: e.target.value as GoalKind, resource_id: '' }))}
                  className={INPUT_CLS}
                >
                  {kindOptions.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {(needsResource || draft.kind === 'practice') && (
                <label className="block">
                  <span className="type-micro text-muted">
                    {needsResource ? t('goals.page.resourceLabel') : t('goals.page.scopeLabel')}
                  </span>
                  <select
                    value={draft.resource_id}
                    onChange={e => setDraft(d => ({ ...d, resource_id: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">{needsResource ? t('goals.page.selectPh') : t('goals.page.allLibrary')}</option>
                    {resourceOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {hasTargetValue && (
                <label className="block">
                  <span className="type-micro text-muted">
                    {draft.kind === 'study_time' ? t('goals.page.targetMinutes') : t('goals.page.targetPieces')}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={draft.target_value}
                    onChange={e => setDraft(d => ({ ...d, target_value: e.target.value }))}
                    placeholder={draft.kind === 'study_time' ? t('goals.page.targetPhMinutes') : t('goals.page.targetPhPieces')}
                    className={INPUT_CLS}
                  />
                </label>
              )}
              <label className="block">
                <span className="type-micro text-muted">{t('goals.page.dueLabel')}</span>
                <input
                  type="date"
                  value={draft.target_date}
                  onChange={e => setDraft(d => ({ ...d, target_date: e.target.value }))}
                  className={INPUT_CLS}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="type-micro text-muted">{t('goals.page.descLabel')}</span>
                <textarea
                  value={draft.description}
                  onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
                  rows={2}
                  className={INPUT_CLS}
                />
              </label>
            </div>
            {formError && <p role="alert" className="text-meta text-error">{formError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => { setIsAdding(false); setFormError(null); }}>{t('goals.page.cancel')}</Button>
              <Button variant="solid" onClick={() => void handleCreate()}>{t('goals.page.create')}</Button>
            </div>
          </div>
        </Panel>
      )}

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target size={30} aria-hidden="true" />}
          title={t('goals.page.emptyTitle')}
          hint={t('goals.page.emptyHint')}
          action={
            <Button variant="outline" onClick={() => setIsAdding(true)}>
              <Plus size={14} aria-hidden="true" /> {t('goals.page.firstGoal')}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" aria-label={t('goals.page.listLabel')}>
          {goals.map(goal => {
            const progress = progressByGoal.get(goal.id) ?? fallbackProgress(effective);
            const deadline = classifyGoalDeadline(goal, localDay);
            const isSelected = goal.id === initialGoalId;
            const isEditing = editingId === goal.id;
            const KindIcon = KIND_ICONS[goal.kind] ?? Target;
            const due = normalizeGoalDate(goal.target_date);

            return (
              <li
                key={goal.id}
                ref={isSelected ? selectedRef : undefined}
                aria-current={isSelected ? 'true' : undefined}
                className={cn(
                  'rounded-xl border bg-surface p-4 shadow-card sm:p-5',
                  isSelected ? 'border-accent/60' : 'border-line'
                )}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <KindIcon size={15} className="shrink-0 text-accent" aria-hidden={true} />
                      <h2 className="type-title break-words text-ink">{goal.title}</h2>
                      <Badge tone={goal.status === 'completed' ? 'success' : 'accent'}>
                        {goal.status === 'completed' ? t('goals.deadline.completed') : t('palette.goalActive')}
                      </Badge>
                      <Badge tone={DEADLINE_TONES[deadline]}>
                                              {deadline === 'no_deadline'
                          ? t('goals.page.noDate')
                          : deadline === 'completed'
                            ? goalDeadlineLabel('completed', effective)
                            : t('goals.page.dateLine', { date: due ?? '-', state: goalDeadlineLabel(deadline, effective) })}
                      </Badge>
                      <Badge tone="neutral">{goalKindLabel(goal.kind, effective)}</Badge>
                    </div>

                    {goal.description && (
                      <p className="type-meta mt-1.5 break-words text-muted">{goal.description}</p>
                    )}

                    {/* MEASURED PROGRESS: kept separate from target and state. */}
                    <div className="mt-3 space-y-1.5">
                      {progress.measurable ? (
                        <>
                          <div
                            role="progressbar"
                            aria-valuenow={progress.percent ?? 0}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={t('goals.page.progressSr', { title: goal.title, line: progressLine(progress, effective) })}
                            className="h-2 w-full overflow-hidden rounded-full bg-line"
                          >
                            <div
                              className={cn('h-full rounded-full', progress.reachedTarget ? 'bg-success' : 'bg-accent')}
                              style={{ width: `${progress.percent ?? 0}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-meta">
                            <strong className="text-ink font-mono">{progress.percent}%</strong>
                            <span className="text-muted">{progressLine(progress, effective)}</span>
                          </div>
                        </>
                      ) : (
                        <p className="flex items-start gap-1.5 text-meta text-muted">
                          <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                          <span>
                            {progress.missingResource
                              ? t('goals.page.missingHint', { basis: progress.basis })
                              : progress.basis}
                          </span>
                        </p>
                      )}
                      {/* Measurement BASIS: states WHAT is measured, so nothing stays opaque. */}
                      {progress.measurable && (
                        <p className="text-micro text-faint">{progress.basis}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {goal.status === 'active' ? (
                      <Button
                        size="sm"
                        variant={progress.reachedTarget ? 'solid' : 'outline'}
                        onClick={() => void handleComplete(goal)}
                        title={t('goals.page.completeTitle')}
                      >
                        <Check size={13} aria-hidden="true" /> {t('goals.page.completeBtn')}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleReopen(goal)}
                        title={t('goals.page.reopenTitle')}
                      >
                        <RotateCcw size={13} aria-hidden="true" /> {t('goals.page.reopenBtn')}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(goal))}
                      aria-label={isEditing ? t('goals.page.cancelEditSr', { title: goal.title }) : t('goals.page.editSr', { title: goal.title })}
                    >
                      <Pencil size={13} aria-hidden="true" /> {isEditing ? t('goals.page.cancel') : t('goals.page.editBtn')}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(goal)}
                      aria-label={t('goals.page.deleteSr', { title: goal.title })}
                      title={t('goals.page.deleteTitle')}
                      className="rounded p-1.5 text-faint transition hover:text-error"
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>

                {isEditing && (
                  <div className="mt-3 space-y-2 rounded-lg border border-line bg-canvas p-3">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="block sm:col-span-3">
                        <span className="type-micro text-muted">{t('goals.page.titleLabel')}</span>
                        <input
                          type="text"
                          value={editDraft.title}
                          onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </label>
                      <label className="block">
                        <span className="type-micro text-muted">{t('goals.page.editDue')}</span>
                        <input
                          type="date"
                          value={editDraft.target_date}
                          onChange={e => setEditDraft(d => ({ ...d, target_date: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </label>
                      {(goal.kind === 'practice' || goal.kind === 'study_time') && (
                        <label className="block">
                          <span className="type-micro text-muted">
                            {goal.kind === 'study_time' ? t('goals.page.targetMinutes') : t('goals.page.editPieces')}
                          </span>
                          <input
                            type="number"
                            min={1}
                            value={editDraft.target_value}
                            onChange={e => setEditDraft(d => ({ ...d, target_value: e.target.value }))}
                            className={INPUT_CLS}
                          />
                        </label>
                      )}
                      <label className="block sm:col-span-3">
                        <span className="type-micro text-muted">{t('goals.page.editDesc')}</span>
                        <textarea
                          rows={2}
                          value={editDraft.description}
                          onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="quiet" onClick={() => setEditingId(null)}>{t('goals.page.cancel')}</Button>
                      <Button size="sm" variant="solid" onClick={() => void handleSaveEdit(goal)}>{t('goals.page.save')}</Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-micro text-faint">
                  <CalendarClock size={12} aria-hidden="true" />
                  <span>
                    {t('goals.page.created', { date: goal.created_at ? goal.created_at.slice(0, 10) : '-' })}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t('goals.page.updated', { date: goal.updated_at ? goal.updated_at.slice(0, 10) : '-' })}
                  </span>
                  {goal.completed_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{t('goals.page.doneOn', { date: goal.completed_at.slice(0, 10) })}</span>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={t('goals.page.deleteTitle')}
        consequence={
          pendingDelete
            ? t('goals.page.deleteConfirm', { title: pendingDelete.title })
            : ''
        }
        confirmLabel={t('goals.page.confirmDelete')}
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

/** Neutral progress for not-yet-computed goals (never invents a percent). */
function fallbackProgress(lang: LanguageCode = 'es'): GoalProgress {
  return {
    measurable: false,
    current: null,
    target: null,
    percent: null,
    unit: 'ninguna',
    basis: translateKey(lang, 'goals.page.calcProgress'),
    missingResource: false,
    reachedTarget: false
  };
}
