import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ClipboardList,
  Plus,
  Trash2,
  CircleCheck,
  CircleDot,
  Circle,
  ChevronDown,
  ChevronRight,
  Eye,
  Pencil,
  Save,
  Star,
  ListChecks,
} from 'lucide-react';
import { dao } from '../../db/dao.ts';
import type { PracticeChecklistItem, PracticeWork, PracticeWorkKind, GraphNodeType } from '../../types/models.ts';
import {
  PRACTICE_WORK_KINDS,
  PRACTICE_WORK_KIND_LABELS,
  PRACTICE_WORK_STATUS_LABELS,
  PRACTICE_WORK_STATUSES,
  MAX_CHECKLIST_ITEMS,
  nextChecklistItemId,
  nextPracticeWorkStatus,
  practiceWorkKindLabel,
  practiceWorkStatusLabel,
  summarizeChecklist,
  summarizePracticeWork,
  validatePracticeWorkDraft
} from '../../services/practiceWork.ts';
import { Badge, Button, ProgressBar, cn } from '../ui/index.tsx';
import { ConfirmDialog } from '../common/ConfirmDialog.tsx';
import { MessageBody } from '../ai/MarkdownMessage.ts';

interface PracticeWorkPanelProps {
  /** Recurso al que se vincula el trabajo (obligatorio en esta vista). */
  resourceId: string;
  /** Lección concreta, si el panel vive dentro de una lección. */
  lessonId?: string;
  /** Concepto con el que se vincula por defecto, si se conoce. */
  conceptId?: string;
  /** Notifica cambios para que el contenedor refresque sus métricas. */
  onChanged?: () => void;
  /** Abre el recurso de contexto desde el panel (opcional). */
  onOpenResource?: (resourceId: string) => void;
  className?: string;
}

const INPUT_CLS =
  'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-meta text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

const STATUS_ICONS = {
  PLANNED: Circle,
  IN_PROGRESS: CircleDot,
  DONE: CircleCheck
} as const;

const CONTEXT_TYPE_LABELS: Record<GraphNodeType, string> = {
  course: 'Curso',
  book: 'Libro',
  module: 'Módulo',
  lesson: 'Lección',
  note: 'Nota',
  concept: 'Concepto',
  practice: 'Trabajo práctico',
  resource: 'Recurso'
};

/**
 * Espacio de trabajo del trabajo práctico.
 *
 * El trabajo práctico deja de ser solo un registro para ser un sitio donde
 * PRODUCIR: contenido Markdown, lista de verificación, autoevaluación y estado,
 * siempre junto a su contexto de aprendizaje. El progreso de la lista y los
 * estados se guardan en `practice_work` (JSON en `checklist`), nunca en
 * almacenes paralelos; no se persisten `blob:` ni handles del sistema de
 * archivos.
 */
export const PracticeWorkPanel: React.FC<PracticeWorkPanelProps> = ({
  resourceId,
  lessonId,
  conceptId,
  onChanged,
  onOpenResource,
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

  // Espacio de trabajo del ítem abierto.
  const [openId, setOpenId] = useState<string | null>(null);
  const [wsContent, setWsContent] = useState('');
  const [wsChecklist, setWsChecklist] = useState<PracticeChecklistItem[]>([]);
  const [wsRating, setWsRating] = useState<number | null>(null);
  const [wsPreview, setWsPreview] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [newCheckText, setNewCheckText] = useState('');
  const [contextTitles, setContextTitles] = useState<Map<string, { title: string; type: GraphNodeType }>>(new Map());

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
  const openItem = useMemo(() => items.find(item => item.id === openId) ?? null, [items, openId]);

  // Títulos del contexto de aprendizaje (recurso, lección, concepto).
  useEffect(() => {
    if (!openItem) return;
    const ids = [openItem.resource_id, openItem.lesson_id, openItem.concept_id].filter(
      (id): id is string => Boolean(id)
    );
    if (ids.length === 0) {
      setContextTitles(new Map());
      return;
    }
    let cancelled = false;
    dao
      .getNodeSummaries(ids)
      .then(map => {
        if (!cancelled) setContextTitles(map);
      })
      .catch(() => {
        if (!cancelled) setContextTitles(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [openItem]);

  const openWorkspace = (item: PracticeWork) => {
    if (openId === item.id) {
      setOpenId(null);
      setWsError(null);
      return;
    }
    setOpenId(item.id);
    setWsContent(item.content || '');
    setWsChecklist(item.checklist ? item.checklist.map(entry => ({ ...entry })) : []);
    setWsRating(typeof item.self_rating === 'number' ? item.self_rating : null);
    setWsPreview(false);
    setWsError(null);
    setNewCheckText('');
  };

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

  /** Guarda contenido Markdown y autoevaluación del espacio de trabajo. */
  const handleSaveWorkspace = async () => {
    if (!openItem) return;
    const validation = validatePracticeWorkDraft({
      title: openItem.title,
      kind: openItem.kind,
      status: openItem.status,
      resource_id: openItem.resource_id ?? null,
      lesson_id: openItem.lesson_id ?? null,
      concept_id: openItem.concept_id ?? null,
      content: wsContent,
      checklist: wsChecklist,
      self_rating: wsRating
    });
    if (!validation.ok) {
      setWsError(validation.error || 'No se pudo guardar el espacio de trabajo.');
      return;
    }
    setWsError(null);
    try {
      await dao.updatePracticeWork(openItem.id, {
        content: wsContent,
        checklist: wsChecklist,
        // `undefined` explícito (clave presente) limpia la valoración a NULL.
        self_rating: wsRating ?? undefined
      });
      await load();
      onChanged?.();
    } catch {
      setWsError('No se pudo guardar en tu base local.');
    }
  };

  /** Cambios de la lista: se persisten de inmediato (son acciones, no texto). */
  const persistChecklist = async (next: PracticeChecklistItem[]) => {
    if (!openItem) return;
    setWsChecklist(next);
    try {
      await dao.updatePracticeWork(openItem.id, { checklist: next });
      setItems(current =>
        current.map(item => (item.id === openItem.id ? { ...item, checklist: next } : item))
      );
      onChanged?.();
    } catch {
      setWsError('No se pudo guardar la lista de verificación.');
    }
  };

  const toggleCheckItem = (itemId: string) => {
    persistChecklist(
      wsChecklist.map(entry => (entry.id === itemId ? { ...entry, done: !entry.done } : entry))
    );
  };

  const addCheckItem = () => {
    const text = newCheckText.trim();
    if (!text) return;
    if (wsChecklist.length >= MAX_CHECKLIST_ITEMS) {
      setWsError(`La lista no puede superar ${MAX_CHECKLIST_ITEMS} elementos.`);
      return;
    }
    persistChecklist([
      ...wsChecklist,
      { id: nextChecklistItemId(wsChecklist, text), text, done: false }
    ]);
    setNewCheckText('');
  };

  const removeCheckItem = (itemId: string) => {
    persistChecklist(wsChecklist.filter(entry => entry.id !== itemId));
  };

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return;
    try {
      await dao.deletePracticeWork(pendingDelete.id);
      if (openId === pendingDelete.id) setOpenId(null);
      setPendingDelete(null);
      await load();
      onChanged?.();
    } catch (err) {
      console.warn('No se pudo eliminar el trabajo práctico:', err);
      setPendingDelete(null);
    }
  };

  const checklistSummary = summarizeChecklist(wsChecklist);

  return (
    <section
      className={cn('rounded-xl border border-line bg-surface p-5 shadow-card', className)}
      aria-label="Trabajo práctico"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className="type-section flex items-center gap-2 text-ink">
          <ClipboardList size={16} className="text-accent" aria-hidden="true" />
          Espacio de trabajo práctico ({items.length})
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
            const itemChecklist = summarizeChecklist(item.checklist);
            const isOpen = openId === item.id;

            return (
              <li
                key={item.id}
                className="rounded-lg border border-line bg-canvas"
              >
                <div className="flex items-start gap-3 p-2.5">
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
                      {itemChecklist.total > 0 && (
                        <span className="text-faint">· {itemChecklist.done}/{itemChecklist.total} pasos</span>
                      )}
                      {Boolean(item.content) && <span className="text-faint">· con contenido</span>}
                    </p>
                    {item.description && (
                      <p className="type-meta mt-1 break-words text-muted">{item.description}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant={isOpen ? 'solid' : 'outline'}
                      onClick={() => openWorkspace(item)}
                      aria-expanded={isOpen}
                      aria-controls={`workspace-${item.id}`}
                      title={isOpen ? 'Cerrar el espacio de trabajo' : 'Abrir el espacio de trabajo'}
                    >
                      {isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                      {isOpen ? 'Cerrar' : 'Trabajar'}
                    </Button>
                    <Button
                      size="sm"
                      variant="quiet"
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
                </div>

                {isOpen && openItem && (
                  <div
                    id={`workspace-${item.id}`}
                    className="border-t border-line p-3"
                    aria-label={`Espacio de trabajo de ${item.title}`}
                  >
                    {/* --- Panel de contexto de aprendizaje --- */}
                    <div className="mb-3 rounded-lg border border-line bg-surface p-3">
                      <p className="type-micro flex items-center gap-1.5 text-muted">
                        <ListChecks size={12} className="text-accent" aria-hidden="true" />
                        Contexto de aprendizaje
                      </p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {(() => {
                          const links: Array<{ key: string; label: string; onClick?: () => void }> = [];
                          if (openItem.resource_id) {
                            const summaryRow = contextTitles.get(openItem.resource_id);
                            links.push({
                              key: 'resource',
                              label: `${summaryRow ? CONTEXT_TYPE_LABELS[summaryRow.type] : 'Recurso'}: ${summaryRow?.title ?? openItem.resource_id}`,
                              onClick: onOpenResource ? () => onOpenResource(openItem.resource_id!) : undefined
                            });
                          }
                          if (openItem.lesson_id) {
                            const summaryRow = contextTitles.get(openItem.lesson_id);
                            links.push({
                              key: 'lesson',
                              label: `Lección: ${summaryRow?.title ?? openItem.lesson_id}`
                            });
                          }
                          if (openItem.concept_id) {
                            const summaryRow = contextTitles.get(openItem.concept_id);
                            links.push({
                              key: 'concept',
                              label: `Concepto: ${summaryRow?.title ?? openItem.concept_id}`
                            });
                          }
                          if (links.length === 0) {
                            return <li className="type-meta text-muted">Sin vínculos de contexto.</li>;
                          }
                          return links.map(link =>
                            link.onClick ? (
                              <li key={link.key}>
                                <button
                                  type="button"
                                  onClick={link.onClick}
                                  className="rounded-full border border-accent/30 bg-accent-soft px-2.5 py-0.5 text-micro font-medium text-accent hover:border-accent/60"
                                >
                                  {link.label}
                                </button>
                              </li>
                            ) : (
                              <li key={link.key}>
                                <Badge tone="neutral">{link.label}</Badge>
                              </li>
                            )
                          );
                        })()}
                      </ul>
                      <p className="mt-2 text-micro text-faint">
                        Tipo: {practiceWorkKindLabel(openItem.kind)} · Estado: {practiceWorkStatusLabel(openItem.status)}
                        {openItem.completed_at ? ` · Completado: ${openItem.completed_at.slice(0, 10)}` : ''}
                      </p>
                    </div>

                    {/* --- Lista de verificación --- */}
                    <div className="mb-3">
                      <p className="type-micro text-muted">Lista de verificación</p>
                      {wsChecklist.length > 0 && (
                        <>
                          <ProgressBar
                            value={checklistSummary.percent}
                            label={`Pasos completados: ${checklistSummary.done} de ${checklistSummary.total}`}
                            tone={checklistSummary.done === checklistSummary.total ? 'success' : 'accent'}
                          />
                          <p className="text-micro text-faint mt-1">
                            {checklistSummary.done}/{checklistSummary.total} pasos
                          </p>
                        </>
                      )}
                      <ul className="mt-2 space-y-1">
                        {wsChecklist.map(entry => (
                          <li key={entry.id} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={`check-${item.id}-${entry.id}`}
                              checked={entry.done}
                              onChange={() => toggleCheckItem(entry.id)}
                              className="h-4 w-4 rounded border-line accent-[var(--c-accent)]"
                            />
                            <label
                              htmlFor={`check-${item.id}-${entry.id}`}
                              className={cn(
                                'min-w-0 flex-1 break-words text-meta',
                                entry.done ? 'text-faint line-through' : 'text-ink'
                              )}
                            >
                              {entry.text}
                            </label>
                            <button
                              type="button"
                              onClick={() => removeCheckItem(entry.id)}
                              aria-label={`Quitar paso ${entry.text}`}
                              className="rounded p-1 text-faint transition hover:text-error"
                            >
                              <Trash2 size={12} aria-hidden="true" />
                            </button>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={newCheckText}
                          onChange={e => setNewCheckText(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              addCheckItem();
                            }
                          }}
                          placeholder="Añadir un paso…"
                          aria-label="Nuevo paso de la lista de verificación"
                          className={INPUT_CLS}
                        />
                        <Button size="sm" variant="outline" onClick={addCheckItem} disabled={!newCheckText.trim()}>
                          <Plus size={13} aria-hidden="true" /> Añadir
                        </Button>
                      </div>
                    </div>

                    {/* --- Contenido Markdown --- */}
                    <div className="mb-3">
                      <div className="flex items-center justify-between gap-2">
                        <label className="type-micro text-muted" htmlFor={`content-${item.id}`}>
                          Contenido de trabajo (Markdown)
                        </label>
                        <Button
                          size="sm"
                          variant="quiet"
                          onClick={() => setWsPreview(value => !value)}
                          aria-pressed={wsPreview}
                        >
                          {wsPreview ? <Pencil size={12} aria-hidden="true" /> : <Eye size={12} aria-hidden="true" />}
                          {wsPreview ? 'Editar' : 'Vista previa'}
                        </Button>
                      </div>
                      {wsPreview ? (
                        <div className="mt-1 max-h-72 overflow-y-auto rounded-lg border border-line bg-surface p-3">
                          {wsContent.trim() ? (
                            <MessageBody role="assistant" content={wsContent} />
                          ) : (
                            <p className="type-meta text-muted">Sin contenido todavía.</p>
                          )}
                        </div>
                      ) : (
                        <textarea
                          id={`content-${item.id}`}
                          value={wsContent}
                          onChange={e => setWsContent(e.target.value)}
                          rows={7}
                          placeholder={'Escribe aquí tu trabajo: planteamiento, desarrollo, código, conclusiones…\n\nSoporta **Markdown**.'}
                          className={cn(INPUT_CLS, 'mt-1 font-mono text-meta')}
                        />
                      )}
                    </div>

                    {/* --- Autoevaluación --- */}
                    <div className="mb-3">
                      <p className="type-micro text-muted" id={`rating-label-${item.id}`}>
                        Autoevaluación (0 a 5)
                      </p>
                      <div
                        className="mt-1 flex items-center gap-1"
                        role="group"
                        aria-labelledby={`rating-label-${item.id}`}
                      >
                        {[1, 2, 3, 4, 5].map(value => (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setWsRating(current => (current === value ? null : value))}
                            aria-pressed={wsRating !== null && wsRating >= value}
                            aria-label={`Valorar con ${value} de 5`}
                            title={`${value} de 5`}
                            className={cn(
                              'rounded p-1 transition',
                              wsRating !== null && wsRating >= value
                                ? 'text-warning'
                                : 'text-faint hover:text-muted'
                            )}
                          >
                            <Star
                              size={16}
                              aria-hidden="true"
                              fill={wsRating !== null && wsRating >= value ? 'currentColor' : 'none'}
                            />
                          </button>
                        ))}
                        {wsRating !== null && (
                          <span className="ml-1 text-meta text-muted">{wsRating}/5</span>
                        )}
                      </div>
                    </div>

                    {wsError && <p role="alert" className="mb-2 text-meta text-error">{wsError}</p>}

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5">
                      <p className="text-micro text-faint">
                        Creado: {openItem.created_at?.slice(0, 10) || '-'} ·
                        Actualizado: {openItem.updated_at?.slice(0, 10) || '-'}
                      </p>
                      <Button size="sm" variant="solid" onClick={() => void handleSaveWorkspace()}>
                        <Save size={13} aria-hidden="true" /> Guardar
                      </Button>
                    </div>
                  </div>
                )}
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
            ? `Se eliminará «${pendingDelete.title}» junto con su contenido y su lista de verificación. Esta acción no se puede deshacer.`
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
