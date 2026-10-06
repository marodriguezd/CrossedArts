import React, { useCallback, useEffect, useState } from 'react';
import { ClipboardList, Plus, Trash2, CircleCheck, CircleDot, Circle } from 'lucide-react';
import { dao } from '../../db/dao.ts';
import type { PracticeWork, PracticeWorkKind } from '../../types/models.ts';
import {
  PRACTICE_WORK_KINDS,
  PRACTICE_WORK_KIND_LABELS,
  PRACTICE_WORK_STATUS_LABELS,
  PRACTICE_WORK_STATUSES,
  nextPracticeWorkStatus,
  practiceWorkKindLabel,
  practiceWorkStatusLabel,
  summarizePracticeWork,
  validatePracticeWorkDraft
} from '../../services/practiceWork.ts';
import { Badge, Button, ProgressBar, cn } from '../ui/index.tsx';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';

interface PracticeWorkPanelProps {
  /** Recurso al que se vincula el trabajo (obligatorio en esta vista). */
  resourceId: string;
  /** Lección concreta, si el panel vive dentro de una lección. */
  lessonId?: string;
  /** Concepto con el que se vincula por defecto, si se conoce. */
  conceptId?: string;
  /** Notifica cambios para que el contenedor refresque sus métricas. */
  onChanged?: () => void;
  className?: string;
}

const INPUT_CLS =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-meta text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

const STATUS_ICONS = {
  PLANNED: Circle,
  IN_PROGRESS: CircleDot,
  DONE: CircleCheck
} as const;

/**
 * Trabajo práctico vinculado al aprendizaje.
 *
 * Permite registrar artefactos que el estudiante produce (ejercicio, proyecto,
 * ensayo, dibujo, código) ligados al recurso/lección/concepto, avanzar su estado
 * y eliminarlos con confirmación explícita. Nunca inventa progreso: todo sale de
 * filas reales de `practice_work`.
 */
export const PracticeWorkPanel: React.FC<PracticeWorkPanelProps> = ({
  resourceId,
  lessonId,
  conceptId,
  onChanged,
  className
}) => {
  const [items, setItems] = useState<PracticeWork[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<{ title: string; kind: PracticeWorkKind; description: string }>({
    title: '',
    kind: 'exercise',
    description: ''
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PracticeWork | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await dao.getPracticeWorkForResource(resourceId, lessonId);
      setItems(data);
    } catch (err) {
      console.warn('No se pudo cargar el trabajo práctico:', err);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [resourceId, lessonId]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = summarizePracticeWork(items);

  const handleAdd = async () => {
    const validation = validatePracticeWorkDraft({
      title: draft.title,
      kind: draft.kind,
      resource_id: resourceId,
      lesson_id: lessonId ?? null,
      concept_id: conceptId ?? null
    });
    if (!validation.ok) {
      setFormError(validation.error || 'No se pudo crear el trabajo práctico.');
      return;
    }
    setFormError(null);
    try {
      await dao.addPracticeWork({
        title: draft.title.trim(),
        kind: draft.kind,
        description: draft.description.trim() || undefined,
        resource_id: resourceId,
        lesson_id: lessonId,
        concept_id: conceptId,
        status: 'PLANNED'
      });
      setDraft({ title: '', kind: draft.kind, description: '' });
      setIsAdding(false);
      await load();
      onChanged?.();
    } catch (err) {
      console.warn('No se pudo guardar el trabajo práctico:', err);
      setFormError('No se pudo guardar el trabajo práctico en tu base local.');
    }
  };

  const handleAdvance = async (item: PracticeWork) => {
    const next = nextPracticeWorkStatus(item.status);
    try {
      await dao.updatePracticeWork(item.id, { status: next });
      await load();
      onChanged?.();
    } catch (err) {
      console.warn('No se pudo actualizar el estado:', err);
    }
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await dao.deletePracticeWork(pendingDelete.id);
      setPendingDelete(null);
      await load();
      onChanged?.();
    } catch (err) {
      console.warn('No se pudo eliminar el trabajo práctico:', err);
      setPendingDelete(null);
    }
  };

  return (
    <section
      className={cn('rounded-xl border border-line bg-surface p-5 shadow-card', className)}
      aria-label="Trabajo práctico"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className="type-section flex items-center gap-2 text-ink">
          <ClipboardList size={16} className="text-accent" aria-hidden="true" />
          Trabajo práctico ({items.length})
        </h2>
        <Button size="sm" variant="outline" onClick={() => { setFormError(null); setIsAdding(v => !v); }}>
          <Plus size={13} aria-hidden="true" /> Nuevo trabajo
        </Button>
      </div>

      {summary.total > 0 && (
        <div className="mb-4">
          <ProgressBar
            value={summary.completionPercent}
            label={`Trabajo práctico terminado: ${summary.done} de ${summary.total}`}
          />
          <p className="type-meta mt-1.5">
            {summary.done} terminado{summary.done === 1 ? '' : 's'} · {summary.inProgress} en marcha ·{' '}
            {summary.planned} planificado{summary.planned === 1 ? '' : 's'}
          </p>
        </div>
      )}

      {isAdding && (
        <div className="mb-4 space-y-2 rounded-lg border border-line bg-canvas p-3">
          <label className="block">
            <span className="type-micro text-muted">Título</span>
            <input
              type="text"
              value={draft.title}
              onChange={e => setDraft(d => ({ ...d, title: e.target.value }))}
              placeholder="p. ej. Resolver la hoja de ejercicios 3"
              className={INPUT_CLS}
              aria-label="Título del trabajo práctico"
            />
          </label>
          <label className="block">
            <span className="type-micro text-muted">Tipo</span>
            <select
              value={draft.kind}
              onChange={e => setDraft(d => ({ ...d, kind: e.target.value as PracticeWorkKind }))}
              className={INPUT_CLS}
              aria-label="Tipo de trabajo práctico"
            >
              {PRACTICE_WORK_KINDS.map(kind => (
                <option key={kind} value={kind}>{PRACTICE_WORK_KIND_LABELS[kind]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="type-micro text-muted">Descripción (opcional)</span>
            <textarea
              value={draft.description}
              onChange={e => setDraft(d => ({ ...d, description: e.target.value }))}
              rows={2}
              className={INPUT_CLS}
              aria-label="Descripción del trabajo práctico"
            />
          </label>
          {formError && <p className="text-meta text-error" role="alert">{formError}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="quiet" onClick={() => setIsAdding(false)}>Cancelar</Button>
            <Button size="sm" variant="solid" onClick={handleAdd}>Guardar</Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="type-meta">Cargando trabajo práctico…</p>
      ) : items.length === 0 ? (
        <p className="type-meta">
          Aún no hay trabajo práctico vinculado. Registra un ejercicio, un proyecto o un ensayo para
          convertir el estudio en algo que puedas producir y revisar.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map(item => {
            const status = item.status in PRACTICE_WORK_STATUS_LABELS ? item.status : 'PLANNED';
            const StatusIcon = STATUS_ICONS[status];
            return (
              <li
                key={item.id}
                className="flex items-start gap-3 rounded-lg border border-line bg-canvas p-2.5"
              >
                <StatusIcon
                  size={16}
                  className={cn(
                    'mt-0.5 shrink-0',
                    status === 'DONE' ? 'text-success' : status === 'IN_PROGRESS' ? 'text-accent' : 'text-faint'
                  )}
                  aria-hidden="true"
                />
                <div className="min-w-0 flex-1">
                  <p className={cn('type-item break-words text-ink', status === 'DONE' && 'line-through decoration-faint')}>
                    {item.title}
                  </p>
                  <p className="type-meta mt-0.5 flex flex-wrap items-center gap-1.5">
                    <Badge tone={PRACTICE_WORK_STATUS_LABELS[status].tone}>
                      {practiceWorkStatusLabel(item.status)}
                    </Badge>
                    <span className="text-muted">{practiceWorkKindLabel(item.kind)}</span>
                    {item.lesson_id && <span className="text-faint">· ligado a esta lección</span>}
                    {typeof item.self_rating === 'number' && (
                      <span className="text-faint">· autoevaluación {item.self_rating}/5</span>
                    )}
                  </p>
                  {item.description && (
                    <p className="type-meta mt-1 break-words text-muted">{item.description}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAdvance(item)}
                    title={`Marcar como ${practiceWorkStatusLabel(nextPracticeWorkStatus(item.status))}`}
                  >
                    {practiceWorkStatusLabel(nextPracticeWorkStatus(item.status))}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setPendingDelete(item)}
                    aria-label={`Eliminar ${item.title}`}
                    title="Eliminar trabajo práctico"
                    className="rounded p-1 text-faint transition hover:text-error"
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Eliminar trabajo práctico"
        consequence={
          pendingDelete
            ? `Se eliminará «${pendingDelete.title}» de forma permanente. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Eliminar"
        tone="danger"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </section>
  );
};

/** Re-export para consumidores que solo necesitan los estados disponibles. */
export { PRACTICE_WORK_STATUSES };
