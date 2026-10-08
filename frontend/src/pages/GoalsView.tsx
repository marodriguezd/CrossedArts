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
  GOAL_DEADLINE_LABELS,
  GOAL_KINDS,
  GOAL_KIND_LABELS,
  classifyGoalDeadline,
  normalizeGoalDate,
  summarizeGoals,
  validateGoalDraft,
  type GoalDeadlineState,
  type GoalProgress
} from '../services/goals.ts';
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
  /** Meta seleccionada al navegar desde la paleta, el foco o el grafo. */
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

const KIND_OPTIONS: Array<{ value: GoalKind; label: string }> = GOAL_KINDS.map(kind => ({
  value: kind,
  label: GOAL_KIND_LABELS[kind]
}));

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

/** Etiqueta honesta de la medida de una meta (nunca concatena unidades). */
function progressLine(progress: GoalProgress): string {
  if (!progress.measurable) return progress.basis;
  const current = progress.current ?? 0;
  const target = progress.target;
  if (target === null) return progress.basis;
  return `${current} / ${target} ${progress.unit}`;
}

/**
 * Vista de Metas: planificación personal ligada a datos reales.
 *
 * Distinción que sostiene toda la pantalla (y sus tests):
 *  - PROGRESO MEDIDO: derivado en cada lectura (barra + basis explícito).
 *  - OBJETIVO / FECHA: definido por el usuario (chip independiente).
 *  - ESTADO: activa o completada, decidida por el usuario (nunca automático).
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
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork);

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
    () => summarizeGoals(goals, goal => progressByGoal.get(goal.id) ?? fallbackProgress(), localDay),
    [goals, progressByGoal, localDay]
  );

  // Al navegar desde otra vista, la meta elegida queda visible y marcada.
  useEffect(() => {
    if (!initialGoalId) return;
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
  }, [initialGoalId]);

  const resourceOptions = useMemo(() => {
    const options = [
      ...courses.map(course => ({ id: course.id, title: `Curso · ${course.title}` })),
      ...books.map(book => ({ id: book.id, title: `Libro · ${book.title}` }))
    ];
    return options.sort((a, b) => a.title.localeCompare(b.title));
  }, [courses, books]);

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
    });
    if (!validation.ok) {
      setFormError(validation.error || 'No se pudo crear la meta.');
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
      setFormError('No se pudo guardar la meta en tu base local.');
    }
  };

  const handleComplete = async (goal: LearningGoal) => {
    setActionError(null);
    try {
      await dao.updateGoal(goal.id, { status: 'completed' });
      await onRefresh();
    } catch {
      setActionError('No se pudo marcar la meta como completada.');
    }
  };

  const handleReopen = async (goal: LearningGoal) => {
    setActionError(null);
    try {
      await dao.updateGoal(goal.id, { status: 'active' });
      await onRefresh();
    } catch {
      setActionError('No se pudo reabrir la meta.');
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
      setActionError('La meta necesita un título.');
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
    });
    if (!validation.ok) {
      setActionError(validation.error || 'Revisa los datos de la meta.');
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
      setActionError('No se pudieron guardar los cambios de la meta.');
    }
  };

  const handleDelete = async () => {
    if (!pendingDelete) return;
    try {
      await dao.deleteGoal(pendingDelete.id);
      setPendingDelete(null);
      await onRefresh();
    } catch {
      setActionError('No se pudo eliminar la meta.');
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Metas</h1>
          <p className="type-secondary mt-1">
            Planifica tu aprendizaje. El progreso se mide siempre sobre tus datos reales.
          </p>
        </div>
        <Button
          variant="solid"
          onClick={() => { setFormError(null); setIsAdding(value => !value); }}
          aria-expanded={isAdding}
          aria-controls="goal-create-form"
        >
          <Plus size={15} aria-hidden="true" />
          Nueva meta
        </Button>
      </header>

      {/* Resumen de estados: hechos, no puntuaciones. */}
      <div className="flex flex-wrap gap-2" aria-label="Resumen de metas">
        <Badge tone="accent">{summary.active} activa{summary.active === 1 ? '' : 's'}</Badge>
        <Badge tone={summary.overdue > 0 ? 'warning' : 'neutral'}>{summary.overdue} vencida{summary.overdue === 1 ? '' : 's'}</Badge>
        <Badge tone="neutral">{summary.dueSoon} por vencer</Badge>
        <Badge tone={summary.readyToComplete > 0 ? 'success' : 'neutral'}>
          {summary.readyToComplete} lista{summary.readyToComplete === 1 ? '' : 's'} para cerrar
        </Badge>
        <Badge tone="neutral">{summary.completed} completada{summary.completed === 1 ? '' : 's'}</Badge>
      </div>

      {actionError && (
        <p role="alert" className="text-meta text-error">{actionError}</p>
      )}

      {isAdding && (
        <Panel className="p-5">
          <div id="goal-create-form" className="space-y-3">
            <h2 className="type-section text-ink">Nueva meta</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block sm:col-span-2">
                <span className="type-micro text-muted">Título</span>
                <input
                  type="text"
                  value={draft.title}
                  onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
                  placeholder="p. ej. Terminar el curso de React 18"
                  className={INPUT_CLS}
                />
              </label>
              <label className="block">
                <span className="type-micro text-muted">Tipo de meta</span>
                <select
                  value={draft.kind}
                  onChange={e => setDraft(d => ({ ...d, kind: e.target.value as GoalKind, resource_id: '' }))}
                  className={INPUT_CLS}
                >
                  {KIND_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {(needsResource || draft.kind === 'practice') && (
                <label className="block">
                  <span className="type-micro text-muted">
                    {needsResource ? 'Recurso' : 'Ámbito (opcional)'}
                  </span>
                  <select
                    value={draft.resource_id}
                    onChange={e => setDraft(d => ({ ...d, resource_id: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">{needsResource ? 'Selecciona…' : 'Toda la biblioteca'}</option>
                    {resourceOptions.map(option => (
                      <option key={option.id} value={option.id}>{option.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {hasTargetValue && (
                <label className="block">
                  <span className="type-micro text-muted">
                    {draft.kind === 'study_time' ? 'Minutos objetivo' : 'Nº de piezas objetivo'}
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={draft.target_value}
                    onChange={e => setDraft(d => ({ ...d, target_value: e.target.value }))}
                    placeholder={draft.kind === 'study_time' ? 'p. ej. 600' : 'p. ej. 5'}
                    className={INPUT_CLS}
                  />
                </label>
              )}
              <label className="block">
                <span className="type-micro text-muted">Fecha objetivo (opcional)</span>
                <input
                  type="date"
                  value={draft.target_date}
                  onChange={e => setDraft(d => ({ ...d, target_date: e.target.value }))}
                  className={INPUT_CLS}
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="type-micro text-muted">Descripción (opcional)</span>
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
              <Button variant="quiet" onClick={() => { setIsAdding(false); setFormError(null); }}>Cancelar</Button>
              <Button variant="solid" onClick={() => void handleCreate()}>Crear meta</Button>
            </div>
          </div>
        </Panel>
      )}

      {goals.length === 0 ? (
        <EmptyState
          icon={<Target size={30} aria-hidden="true" />}
          title="Aún no hay metas"
          hint="Define qué quieres conseguir (terminar un curso, leer un libro, registrar práctica) y CrossedArts medirá el avance sobre tus datos reales."
          action={
            <Button variant="outline" onClick={() => setIsAdding(true)}>
              <Plus size={14} aria-hidden="true" /> Crear la primera meta
            </Button>
          }
        />
      ) : (
        <ul className="space-y-3" aria-label="Metas de aprendizaje">
          {goals.map(goal => {
            const progress = progressByGoal.get(goal.id) ?? fallbackProgress();
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
                        {goal.status === 'completed' ? 'Completada' : 'Activa'}
                      </Badge>
                      <Badge tone={DEADLINE_TONES[deadline]}>
                        {deadline === 'no_deadline'
                          ? 'Sin fecha'
                          : deadline === 'completed'
                            ? GOAL_DEADLINE_LABELS.completed
                            : `Fecha: ${due ?? '-'} · ${GOAL_DEADLINE_LABELS[deadline]}`}
                      </Badge>
                      <Badge tone="neutral">{GOAL_KIND_LABELS[goal.kind]}</Badge>
                    </div>

                    {goal.description && (
                      <p className="type-meta mt-1.5 break-words text-muted">{goal.description}</p>
                    )}

                    {/* PROGRESO MEDIDO: separado del objetivo y del estado. */}
                    <div className="mt-3 space-y-1.5">
                      {progress.measurable ? (
                        <>
                          <div
                            role="progressbar"
                            aria-valuenow={progress.percent ?? 0}
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-label={`Progreso de «${goal.title}»: ${progressLine(progress)}`}
                            className="h-2 w-full overflow-hidden rounded-full bg-line"
                          >
                            <div
                              className={cn('h-full rounded-full', progress.reachedTarget ? 'bg-success' : 'bg-accent')}
                              style={{ width: `${progress.percent ?? 0}%` }}
                            />
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-meta">
                            <strong className="text-ink">{progress.percent}%</strong>
                            <span className="text-muted">{progressLine(progress)}</span>
                          </div>
                        </>
                      ) : (
                        <p className="flex items-start gap-1.5 text-meta text-muted">
                          <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
                          <span>
                            {progress.missingResource
                              ? `${progress.basis} Puedes eliminar o reasignir la meta.`
                              : progress.basis}
                          </span>
                        </p>
                      )}
                      {/* BASE de medición: dice QUÉ se mide, para que nada sea opaco. */}
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
                        title="Marcar la meta como completada"
                      >
                        <Check size={13} aria-hidden="true" /> Completada
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void handleReopen(goal)}
                        title="Reabrir la meta"
                      >
                        <RotateCcw size={13} aria-hidden="true" /> Reabrir
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      onClick={() => (isEditing ? setEditingId(null) : startEdit(goal))}
                      aria-label={isEditing ? `Cancelar edición de ${goal.title}` : `Editar ${goal.title}`}
                    >
                      <Pencil size={13} aria-hidden="true" /> {isEditing ? 'Cancelar' : 'Editar'}
                    </Button>
                    <button
                      type="button"
                      onClick={() => setPendingDelete(goal)}
                      aria-label={`Eliminar meta ${goal.title}`}
                      title="Eliminar meta"
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
                        <span className="type-micro text-muted">Título</span>
                        <input
                          type="text"
                          value={editDraft.title}
                          onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </label>
                      <label className="block">
                        <span className="type-micro text-muted">Fecha objetivo</span>
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
                            {goal.kind === 'study_time' ? 'Minutos objetivo' : 'Nº de piezas'}
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
                        <span className="type-micro text-muted">Descripción</span>
                        <textarea
                          rows={2}
                          value={editDraft.description}
                          onChange={e => setEditDraft(d => ({ ...d, description: e.target.value }))}
                          className={INPUT_CLS}
                        />
                      </label>
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button size="sm" variant="quiet" onClick={() => setEditingId(null)}>Cancelar</Button>
                      <Button size="sm" variant="solid" onClick={() => void handleSaveEdit(goal)}>Guardar</Button>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2.5 text-micro text-faint">
                  <CalendarClock size={12} aria-hidden="true" />
                  <span>
                    Creada: {goal.created_at ? goal.created_at.slice(0, 10) : '-'}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    Actualizada: {goal.updated_at ? goal.updated_at.slice(0, 10) : '-'}
                  </span>
                  {goal.completed_at && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>Completada: {goal.completed_at.slice(0, 10)}</span>
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
        title="Eliminar meta"
        consequence={
          pendingDelete
            ? `Se eliminará «${pendingDelete.title}». Tu progreso real de estudio no se ve afectado: las metas no almacenan datos de estudio.`
            : ''
        }
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
};

/** Progreso neutro para metas aún no calculadas (no inventa porcentaje). */
function fallbackProgress(): GoalProgress {
  return {
    measurable: false,
    current: null,
    target: null,
    percent: null,
    unit: 'ninguna',
    basis: 'Calculando progreso…',
    missingResource: false,
    reachedTarget: false
  };
}
