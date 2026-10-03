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
  FolderCheck
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { localMediaService } from '../services/localMediaService.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { describeDestructiveAction } from '../services/domainLogic.ts';
import { LessonWorkspace } from '../components/lesson/LessonWorkspace.tsx';

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

  useEffect(() => {
    const target = findLesson(initialLessonId);
    if (target) setSelectedLesson(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLessonId]);

  useEffect(() => {
    if (selectedLesson && !course.modules?.some(m => m.lessons?.some(l => l.id === selectedLesson.id))) {
      setSelectedLesson(course.modules?.[0]?.lessons?.[0] || null);
    }
  }, [course]);

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

  return (
    <div className="space-y-6 animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition"
      >
        <ArrowLeft size={16} /> Volver a la Biblioteca
      </button>

      {/* Main Course Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 rounded-2xl bg-slate-900/60 border border-slate-800">
        <div>
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
            {course.category}
          </span>
          <h1 className="text-xl font-bold text-white mt-1.5">{course.title}</h1>
          <p className="text-xs text-slate-400 mt-1">Instructor: {course.instructor}</p>
        </div>
        <div className="flex flex-col items-start md:items-end gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
            {localMediaService.hasActiveFolder() && (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-purple-950/60 border border-purple-800 text-purple-300">
                <FolderCheck size={14} /> Carpeta: {localMediaService.getDirectoryName()}
              </span>
            )}
            <span className="flex items-center gap-1.5"><Clock size={14} className="text-purple-400" /> {course.total_duration_minutes} min</span>
            <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-emerald-400" /> {course.completed_lessons}/{course.total_lessons} lecciones</span>
          </div>
          {/* Acciones de estudio reutilizando el flujo existente */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => onStudyResource?.(course.id, 'flashcards')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
            >
              <Brain size={13} /> Repasar
            </button>
            <button
              onClick={() => onStudyResource?.(course.id, 'practice')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition"
            >
              <ListChecks size={13} /> Practicar
            </button>
            <button
              onClick={() => onStudyResource?.(course.id, 'mixed')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
            >
              <Play size={13} /> Estudiar
            </button>
            <button
              onClick={() => onExplainResource?.(course.id, course.title)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-800/40 transition"
            >
              <Sparkles size={13} /> Explicar
            </button>
            <button
              onClick={handleDeleteCourse}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border border-rose-500/30 transition"
              aria-label={`Eliminar curso ${course.title}`}
            >
              <Trash2 size={13} /> Eliminar curso
            </button>
          </div>
        </div>
      </div>

      {/* Continuar curso (determinista) */}
      {nextLesson && (
        <div className="p-3 rounded-xl bg-purple-950/30 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-purple-200">
              {nextLesson.allCompleted ? 'Curso completado. Repasa la última lección:' : 'Continuar curso'}
            </p>
            <p className="text-[11px] text-slate-400">{nextLesson.moduleTitle} › {nextLesson.title}</p>
          </div>
          <button
            onClick={() => handleSelectLesson(nextLesson.id)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition self-start"
          >
            <ArrowRight size={13} /> Continuar
          </button>
        </div>
      )}

      {feedbackMsg && (
        <div className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
          feedbackMsg.type === 'success'
            ? 'bg-emerald-950/60 border border-emerald-800/60 text-emerald-300'
            : 'bg-rose-950/60 border border-rose-800/60 text-rose-300'
        }`} role="status" aria-live="polite">
          {feedbackMsg.type === 'success' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
          <span>{feedbackMsg.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Espacio de trabajo de la lección */}
        <div className="lg:col-span-2">
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
            <div className="p-8 rounded-2xl bg-slate-900/50 border border-slate-800 text-center text-slate-500">
              <BookOpen size={32} className="mx-auto mb-2 opacity-60" />
              <p className="text-sm font-semibold text-slate-300">Este curso aún no tiene lecciones</p>
              <p className="text-xs mt-1">Crea un módulo y una lección para empezar a construir el curso.</p>
            </div>
          )}
        </div>

        {/* Modules & Lessons List + lightweight organization */}
        <div className="space-y-4 bg-slate-900/40 p-4 rounded-2xl border border-slate-800/80 max-h-[760px] overflow-y-auto">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Plan de Estudio</h2>

          {/* Crear módulo */}
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newModuleTitle}
              onChange={e => setNewModuleTitle(e.target.value)}
              placeholder="Nuevo módulo..."
              aria-label="Título del nuevo módulo"
              className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
            />
            <button
              onClick={handleCreateModule}
              disabled={!newModuleTitle.trim()}
              className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition"
              title="Crear módulo"
              aria-label="Crear módulo"
            >
              <Plus size={14} />
            </button>
          </div>

          {(course.modules || []).map((mod) => (
            <div key={mod.id} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <h4 className="text-xs font-bold text-purple-300">{mod.title}</h4>
                <button
                  onClick={() => handleDeleteModule(mod.id, mod.title)}
                  className="p-0.5 text-slate-600 hover:text-rose-400 transition"
                  title="Eliminar módulo"
                  aria-label={`Eliminar módulo ${mod.title}`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="space-y-1">
                {mod.lessons?.map((les) => {
                  const isSelected = selectedLesson?.id === les.id;
                  return (
                    <div
                      key={les.id}
                      className={`group flex items-center justify-between p-2.5 rounded-lg cursor-pointer text-xs transition ${
                        isSelected
                          ? 'bg-purple-600/20 text-purple-200 border border-purple-500/30 font-medium'
                          : 'hover:bg-slate-800/60 text-slate-300'
                      }`}
                      onClick={() => setSelectedLesson(les)}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {les.is_completed ? (
                          <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                        ) : (
                          <Circle size={14} className="text-slate-500 shrink-0" />
                        )}
                        <span className="truncate">{les.title}</span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 ml-2">
                        <span className="text-[10px] text-slate-500">{les.duration_minutes}m</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveLesson(les.id, 'up'); }}
                          className="p-0.5 text-slate-600 hover:text-purple-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                          title="Mover arriba"
                          aria-label={`Mover la lección ${les.title} hacia arriba`}
                        >
                          <ArrowUp size={11} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleMoveLesson(les.id, 'down'); }}
                          className="p-0.5 text-slate-600 hover:text-purple-300 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                          title="Mover abajo"
                          aria-label={`Mover la lección ${les.title} hacia abajo`}
                        >
                          <ArrowDown size={11} />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteLesson(les.id, les.title); }}
                          className="p-0.5 text-slate-600 hover:text-rose-400 opacity-0 group-hover:opacity-100 focus:opacity-100 transition"
                          title="Eliminar lección"
                          aria-label={`Eliminar lección ${les.title}`}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Crear lección */}
          {(course.modules || []).length > 0 && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                <Layers size={11} /> Nueva lección
              </span>
              <select
                value={newLessonModuleId}
                onChange={e => setNewLessonModuleId(e.target.value)}
                aria-label="Módulo de la nueva lección"
                className="w-full px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-200 focus:outline-none focus:border-purple-500"
              >
                {(course.modules || []).map(m => (
                  <option key={m.id} value={m.id}>{m.title}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={newLessonTitle}
                  onChange={e => setNewLessonTitle(e.target.value)}
                  placeholder="Título de la lección..."
                  aria-label="Título de la nueva lección"
                  className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                />
                <button
                  onClick={handleCreateLesson}
                  disabled={!newLessonTitle.trim()}
                  className="p-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition"
                  title="Crear lección"
                  aria-label="Crear lección"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
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
