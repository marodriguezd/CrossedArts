import React, { useState, useEffect, useCallback } from 'react';
import { Course, Lesson } from '../types/models.ts';
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  Play,
  BookOpen,
  Clock,
  AlertCircle,
  Brain,
  Sparkles,
  ListChecks,
  Plus,
  Trash2,
  Layers,
  ArrowUp,
  ArrowDown,
  ArrowRight,
  FolderCheck,
  Search,
  Check
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { localMediaService } from '../services/localMediaService.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { describeDestructiveAction, filterCourseLessons } from '../services/domainLogic.ts';
import { LessonWorkspace } from '../components/lesson/LessonWorkspace.tsx';
import { Button, Badge, InlineStatus, ProgressBar, EmptyState, SearchInput, cn } from '../components/ui/index.tsx';

interface CourseDetailProps {
  course: Course;
  onBack: () => void;
  onRefresh: () => void;
  initialLessonId?: string | null;
  onStudyResource?: (resourceId: string, mode?: 'flashcards' | 'practice' | 'mixed') => void;
  onStudyLesson?: (lessonId: string, mode?: 'flashcards' | 'practice' | 'mixed') => void;
  onExplainResource?: (resourceId: string, label: string, lessonId?: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenResource?: (resourceId: string) => void;
  onOpenConcept?: (conceptId: string) => void;
}

export const CourseDetail: React.FC<CourseDetailProps> = ({
  course,
  onBack,
  onRefresh,
  initialLessonId,
  onStudyResource,
  onStudyLesson,
  onExplainResource,
  onOpenNote,
  onOpenResource,
  onOpenConcept
}) => {
  const findLesson = (lessonId?: string | null): Lesson | null => {
    if (!lessonId) return null;
    for (const mod of course.modules || []) {
      const found = mod.lessons?.find(l => l.id === lessonId);
      if (found) return found;
    }
    return null;
  };

  const findModuleTitle = (lessonId: string): string => {
    for (const mod of course.modules || []) {
      if (mod.lessons?.some(l => l.id === lessonId)) return mod.title;
    }
    return '';
  };

  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(
    findLesson(initialLessonId) || course.modules?.[0]?.lessons?.[0] || null
  );
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<{ action: 'delete-course' | 'delete-module' | 'delete-lesson'; targetId: string; label: string } | null>(null);
  const [nextLesson, setNextLesson] = useState<{ id: string; title: string; moduleTitle: string; allCompleted: boolean } | null>(null);

  // Formularios ligeros de organización
  const [newModuleTitle, setNewModuleTitle] = useState('');
  const [newLessonModuleId, setNewLessonModuleId] = useState(course.modules?.[0]?.id || '');
  const [newLessonTitle, setNewLessonTitle] = useState('');

  // Búsqueda de lecciones dentro del curso
  const [lessonQuery, setLessonQuery] = useState('');

  const { filteredModules, totalMatchingLessons } = filterCourseLessons(course.modules, lessonQuery);

  useEffect(() => {
    const target = findLesson(initialLessonId);
    if (target) setSelectedLesson(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLessonId]);

  useEffect(() => {
    if (selectedLesson) {
      const refreshed = course.modules
        ?.flatMap(m => m.lessons || [])
        .find(l => l.id === selectedLesson.id);
      if (refreshed) {
        setSelectedLesson(refreshed);
      } else {
        setSelectedLesson(course.modules?.[0]?.lessons?.[0] || null);
      }
    }
  }, [course]);

  const handleToggleLessonCompletion = async (lessonId: string, completed: boolean) => {
    try {
      await dao.toggleLessonCompleted(lessonId, completed);
      onRefresh();
      if (selectedLesson && selectedLesson.id === lessonId) {
        setSelectedLesson(prev => prev ? { ...prev, is_completed: completed } : null);
      }
      setFeedbackMsg({
        type: 'success',
        text: completed ? 'Lección marcada como completada.' : 'Lección marcada como pendiente.'
      });
    } catch {
      setFeedbackMsg({ type: 'error', text: 'No se pudo actualizar el estado de la lección.' });
    }
  };

  const handleToggleModuleLessons = async (moduleId: string, completed: boolean) => {
    try {
      await dao.toggleModuleLessonsCompleted(moduleId, completed);
      onRefresh();
      setFeedbackMsg({
        type: 'success',
        text: completed ? 'Todas las lecciones del módulo marcadas como completadas.' : 'Todas las lecciones del módulo marcadas como pendientes.'
      });
    } catch {
      setFeedbackMsg({ type: 'error', text: 'No se pudo actualizar el módulo.' });
    }
  };

  useEffect(() => {
    if (!newLessonModuleId && course.modules?.[0]?.id) setNewLessonModuleId(course.modules[0].id);
  }, [course.modules, newLessonModuleId]);

  // Continuar curso: siguiente lección determinista (primera incompleta por orden)
  const loadNextLesson = useCallback(async () => {
    try {
      const next = await dao.getNextLessonForCourse(course.id);
      if (next) {
        setNextLesson({ id: next.lesson.id, title: next.lesson.title, moduleTitle: next.moduleTitle, allCompleted: next.allCompleted });
      } else {
        setNextLesson(null);
      }
    } catch {
      setNextLesson(null);
    }
  }, [course.id]);

  useEffect(() => {
    loadNextLesson();
  }, [loadNextLesson, course]);

  useEffect(() => {
    return () => {
      localMediaService.revokeAllObjectUrls();
    };
  }, [course.id]);

  const handleCreateModule = async () => {
    setFeedbackMsg(null);
    const res = await dao.createModule({ courseId: course.id, title: newModuleTitle });
    if (!res.success) {
      setFeedbackMsg({ type: 'error', text: res.error || 'No se pudo crear el módulo.' });
      return;
    }
    setNewModuleTitle('');
    setFeedbackMsg({ type: 'success', text: 'Módulo creado correctamente.' });
    onRefresh();
  };

  const handleCreateLesson = async () => {
    setFeedbackMsg(null);
    const res = await dao.createLesson({ moduleId: newLessonModuleId, title: newLessonTitle });
    if (!res.success) {
      setFeedbackMsg({ type: 'error', text: res.error || 'No se pudo crear la lección.' });
      return;
    }
    setNewLessonTitle('');
    setFeedbackMsg({ type: 'success', text: 'Lección creada correctamente.' });
    onRefresh();
    if (res.id) setSelectedLesson({ id: res.id, module_id: newLessonModuleId, title: newLessonTitle.trim(), order_index: 0, duration_minutes: 0, lesson_type: 'VIDEO', is_completed: false });
  };

  const handleMoveLesson = async (lessonId: string, direction: 'up' | 'down') => {
    const res = await dao.moveLesson(lessonId, direction);
    if (!res.success && res.error) setFeedbackMsg({ type: 'error', text: res.error });
    onRefresh();
  };

  const handleSelectLesson = (lessonId: string) => {
    const lesson = findLesson(lessonId);
    if (lesson) setSelectedLesson(lesson);
  };

  const handleDeleteLesson = (lessonId: string, label: string) => {
    setPendingConfirm({ action: 'delete-lesson', targetId: lessonId, label });
  };

  const handleDeleteModule = (moduleId: string, label: string) => {
    setPendingConfirm({ action: 'delete-module', targetId: moduleId, label });
  };

  const handleDeleteCourse = () => {
    setPendingConfirm({ action: 'delete-course', targetId: course.id, label: course.title });
  };

  const executePendingConfirm = async () => {
    const target = pendingConfirm;
    setPendingConfirm(null);
    if (!target) return;
    if (target.action === 'delete-course') {
      await dao.deleteCourse(target.targetId);
      onRefresh();
      onBack();
      return;
    }
    if (target.action === 'delete-module') await dao.deleteModule(target.targetId);
    else await dao.deleteLesson(target.targetId);
    onRefresh();
  };

  const INPUT_CLS = 'rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';

  return (
    <div className="animate-fade-in space-y-6">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-meta font-medium text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={15} aria-hidden="true" /> Volver a la Biblioteca
      </button>

      {/* Cabecera editorial del curso */}
      <header className="border-b border-line pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Badge tone="accent">{course.category}</Badge>
            <h1 className="type-display mt-2 text-ink">{course.title}</h1>
            <p className="type-secondary mt-1">Instructor: {course.instructor || 'No indicado'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 text-meta text-muted">
                <Clock size={13} aria-hidden="true" /> {course.total_duration_minutes} min
              </span>
              <span className="flex items-center gap-1.5 text-meta text-muted">
                <CheckCircle size={13} className="text-success" aria-hidden="true" />
                {course.completed_lessons}/{course.total_lessons} lecciones
              </span>
              {localMediaService.hasActiveFolder() && (
                <span className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-meta text-muted">
                  <FolderCheck size={13} aria-hidden="true" /> Carpeta: {localMediaService.getDirectoryName()}
                </span>
              )}
            </div>
            <ProgressBar
              value={course.total_lessons ? ((course.completed_lessons || 0) / course.total_lessons) * 100 : 0}
              label={`Progreso del curso ${course.title}`}
              className="mt-3 max-w-xs"
            />
          </div>

          {/* Acciones de estudio reutilizando el flujo existente */}
          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            <Button size="sm" variant="solid" onClick={() => onStudyResource?.(course.id, 'mixed')}>
              <Play size={13} aria-hidden="true" /> Estudiar
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStudyResource?.(course.id, 'flashcards')}>
              <Brain size={13} aria-hidden="true" /> Repasar
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStudyResource?.(course.id, 'practice')}>
              <ListChecks size={13} aria-hidden="true" /> Practicar
            </Button>
            <Button size="sm" variant="outline" onClick={() => onExplainResource?.(course.id, course.title)}>
              <Sparkles size={13} aria-hidden="true" /> Explicar
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={handleDeleteCourse}
              aria-label={`Eliminar curso ${course.title}`}
            >
              <Trash2 size={13} aria-hidden="true" /> Eliminar curso
            </Button>
          </div>
        </div>
      </header>

      {/* Continuar curso (determinista) */}
      {nextLesson && (
        <div className="flex flex-col gap-3 rounded-xl border border-accent/30 bg-accent-soft/60 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="type-item text-ink">
              {nextLesson.allCompleted ? 'Curso completado. Repasa la última lección:' : 'Continuar curso'}
            </p>
            <p className="type-meta mt-0.5 truncate">{nextLesson.moduleTitle} › {nextLesson.title}</p>
          </div>
          <Button size="sm" variant="solid" className="self-start" onClick={() => handleSelectLesson(nextLesson.id)}>
            <ArrowRight size={13} aria-hidden="true" /> Continuar
          </Button>
        </div>
      )}

      {feedbackMsg && (
        <InlineStatus tone={feedbackMsg.type === 'success' ? 'success' : 'error'}>
          {feedbackMsg.type === 'success' ? <CheckCircle size={14} className="shrink-0" aria-hidden="true" /> : <AlertCircle size={14} className="shrink-0" aria-hidden="true" />}
          <span>{feedbackMsg.text}</span>
        </InlineStatus>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Plan de estudio (contexto: izquierda) */}
        <aside className="lg:col-span-3" aria-label="Plan de estudio">
          <div className="max-h-[760px] space-y-4 overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-card">
            <h2 className="type-micro">Plan de estudio</h2>

            {/* Crear módulo */}
            {/* Buscador de lecciones del curso */}
            <div className="space-y-1.5">
              <SearchInput
                label="Buscar lecciones"
                placeholder="Buscar lección en este curso…"
                value={lessonQuery}
                onChange={setLessonQuery}
                className="w-full"
              />
              {lessonQuery.trim() && (
                <div className="flex items-center justify-between px-1 text-meta text-muted">
                  <span>Coincidencias: <strong className="text-ink">{totalMatchingLessons}</strong></span>
                  <button
                    type="button"
                    onClick={() => setLessonQuery('')}
                    className="underline text-faint hover:text-ink"
                  >
                    Limpiar
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              <label htmlFor="new-module-title" className="sr-only">Título del nuevo módulo</label>
              <input
                id="new-module-title"
                type="text"
                value={newModuleTitle}
                onChange={e => setNewModuleTitle(e.target.value)}
                placeholder="Nuevo módulo…"
                aria-label="Título del nuevo módulo"
                className={cn(INPUT_CLS, 'min-w-0 flex-1')}
              />
              <button
                onClick={handleCreateModule}
                disabled={!newModuleTitle.trim()}
                className="rounded-lg bg-accent p-1.5 text-on-accent transition hover:opacity-90 disabled:opacity-40"
                title="Crear módulo"
                aria-label="Crear módulo"
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>

            {filteredModules.length === 0 ? (
              <p className="type-meta px-1 text-muted">
                {course.modules?.length === 0 ? 'Sin módulos.' : 'No hay lecciones que coincidan con la búsqueda.'}
              </p>
            ) : (
              filteredModules.map((mod) => (
                <div key={mod.id} className="space-y-2">
                  <div className="flex items-center justify-between px-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <h4 className="text-meta font-semibold text-ink truncate">{mod.title}</h4>
                      {mod.lessons && mod.lessons.length > 0 && (
                        <span className="text-micro font-medium text-muted">
                          ({mod.lessons.filter(l => l.is_completed).length}/{mod.lessons.length})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {mod.lessons && mod.lessons.length > 0 && (
                        <button
                          type="button"
                          onClick={() => handleToggleModuleLessons(mod.id, !mod.lessons?.every(l => l.is_completed))}
                          className="p-1 text-faint hover:text-accent text-micro transition-colors cursor-pointer"
                          title={mod.lessons.every(l => l.is_completed) ? 'Marcar módulo como pendiente' : 'Marcar módulo como completado'}
                          aria-label={`Marcar todas las lecciones del módulo ${mod.title} como ${mod.lessons.every(l => l.is_completed) ? 'pendientes' : 'completadas'}`}
                        >
                          {mod.lessons.every(l => l.is_completed) ? (
                            <CheckCircle size={13} className="text-success" aria-hidden="true" />
                          ) : (
                            <Check size={13} aria-hidden="true" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteModule(mod.id, mod.title)}
                        className="p-1 text-faint transition-colors hover:text-error cursor-pointer"
                        title="Eliminar módulo"
                        aria-label={`Eliminar módulo ${mod.title}`}
                      >
                        <Trash2 size={12} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                <div className="space-y-1">
                  {mod.lessons?.map((les) => {
                    const isSelected = selectedLesson?.id === les.id;
                    return (
                      <button
                        key={les.id}
                        onClick={() => setSelectedLesson(les)}
                        aria-current={isSelected ? 'true' : undefined}
                        className={cn(
                          'group flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-meta transition-colors duration-fast',
                          isSelected
                            ? 'border-accent/40 bg-accent-soft font-semibold text-ink'
                            : 'border-transparent text-muted hover:bg-canvas'
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleLessonCompletion(les.id, !les.is_completed);
                            }}
                            aria-label={les.is_completed ? `Marcar lección «${les.title}» como incompleta` : `Marcar lección «${les.title}» como completada`}
                            title={les.is_completed ? 'Marcar como pendiente' : 'Marcar como completada'}
                            className="p-0.5 -m-0.5 rounded text-faint hover:text-success transition-colors cursor-pointer"
                          >
                            {les.is_completed ? (
                              <CheckCircle size={15} className="shrink-0 text-success" aria-hidden="true" />
                            ) : (
                              <Circle size={15} className="shrink-0 text-faint hover:text-success" aria-hidden="true" />
                            )}
                          </button>
                          <span className="truncate">{les.title}</span>
                        </span>
                        <span className="ml-2 flex shrink-0 items-center gap-1">
                          <span className="text-micro">{les.duration_minutes}m</span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleMoveLesson(les.id, 'up'); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleMoveLesson(les.id, 'up'); } }}
                            className="p-0.5 text-faint opacity-0 transition hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
                            title="Mover arriba"
                            aria-label={`Mover la lección ${les.title} hacia arriba`}
                          >
                            <ArrowUp size={11} aria-hidden="true" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleMoveLesson(les.id, 'down'); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleMoveLesson(les.id, 'down'); } }}
                            className="p-0.5 text-faint opacity-0 transition hover:text-accent focus-visible:opacity-100 group-hover:opacity-100"
                            title="Mover abajo"
                            aria-label={`Mover la lección ${les.title} hacia abajo`}
                          >
                            <ArrowDown size={11} aria-hidden="true" />
                          </span>
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); handleDeleteLesson(les.id, les.title); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); handleDeleteLesson(les.id, les.title); } }}
                            className="p-0.5 text-faint opacity-0 transition hover:text-error focus-visible:opacity-100 group-hover:opacity-100"
                            title="Eliminar lección"
                            aria-label={`Eliminar lección ${les.title}`}
                          >
                            <Trash2 size={11} aria-hidden="true" />
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )))}

            {/* Crear lección */}
            {(course.modules || []).length > 0 && (
              <div className="space-y-2 border-t border-line pt-3">
                <span className="type-micro flex items-center gap-1">
                  <Layers size={11} aria-hidden="true" /> Nueva lección
                </span>
                <label htmlFor="new-lesson-module" className="sr-only">Módulo de la nueva lección</label>
                <select
                  id="new-lesson-module"
                  value={newLessonModuleId}
                  onChange={e => setNewLessonModuleId(e.target.value)}
                  aria-label="Módulo de la nueva lección"
                  className="w-full rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-meta text-ink focus:border-accent/50 focus:outline-none"
                >
                  {(course.modules || []).map(m => (
                    <option key={m.id} value={m.id}>{m.title}</option>
                  ))}
                </select>
                <div className="flex items-center gap-1.5">
                  <label htmlFor="new-lesson-title" className="sr-only">Título de la nueva lección</label>
                  <input
                    id="new-lesson-title"
                    type="text"
                    value={newLessonTitle}
                    onChange={e => setNewLessonTitle(e.target.value)}
                    placeholder="Título de la lección…"
                    aria-label="Título de la nueva lección"
                    className={cn(INPUT_CLS, 'min-w-0 flex-1')}
                  />
                  <button
                    onClick={handleCreateLesson}
                    disabled={!newLessonTitle.trim()}
                    className="rounded-lg bg-accent p-1.5 text-on-accent transition hover:opacity-90 disabled:opacity-40"
                    title="Crear lección"
                    aria-label="Crear lección"
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Espacio de trabajo de la lección (centro) */}
        <div className="lg:col-span-9">
          {selectedLesson ? (
            <LessonWorkspace
              key={selectedLesson.id}
              courseId={course.id}
              lesson={selectedLesson}
              moduleTitle={findModuleTitle(selectedLesson.id)}
              onRefresh={onRefresh}
              onSelectLesson={handleSelectLesson}
              onMoveLesson={handleMoveLesson}
              onStudyLesson={(id, mode) => onStudyLesson?.(id, mode)}
              onStudyResource={(rid, mode) => onStudyResource?.(rid, mode)}
              onExplainResource={(rid, label, lid) => onExplainResource?.(rid, label, lid)}
              onOpenNote={id => onOpenNote?.(id)}
              onOpenResource={id => onOpenResource?.(id)}
              onOpenConcept={id => onOpenConcept?.(id)}
            />
          ) : (
            <EmptyState
              icon={<BookOpen size={32} aria-hidden="true" />}
              title="Este curso aún no tiene lecciones"
              hint="Crea un módulo y una lección para empezar a construir el curso."
            />
          )}
        </div>
      </div>

      {/* Confirmación accesible de acciones destructivas (reemplaza el diálogo nativo) */}
      <ConfirmDialog
        isOpen={!!pendingConfirm}
        title={pendingConfirm ? describeDestructiveAction(pendingConfirm.action, pendingConfirm.label).title : ''}
        consequence={pendingConfirm ? describeDestructiveAction(pendingConfirm.action, pendingConfirm.label).consequence : ''}
        confirmLabel={pendingConfirm ? describeDestructiveAction(pendingConfirm.action, pendingConfirm.label).confirmLabel : 'Eliminar'}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={executePendingConfirm}
      />
    </div>
  );
};
