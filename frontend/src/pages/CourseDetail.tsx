import React, { useState } from 'react';
import { Course, Lesson } from '../types/models.ts';
import { ArrowLeft, CheckCircle, Circle, Play, Video, BookOpen, Clock, Check } from 'lucide-react';
import { dao } from '../db/dao.ts';

interface CourseDetailProps {
  course: Course;
  onBack: () => void;
  onRefresh: () => void;
}

export const CourseDetail: React.FC<CourseDetailProps> = ({ course, onBack, onRefresh }) => {
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(
    course.modules?.[0]?.lessons?.[0] || null
  );

  const handleToggleComplete = async (lesson: Lesson) => {
    await dao.toggleLessonCompleted(lesson.id, !lesson.is_completed);
    lesson.is_completed = !lesson.is_completed;
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
        <div className="flex items-center gap-4 text-xs text-slate-300">
          <span className="flex items-center gap-1.5"><Clock size={14} className="text-purple-400" /> {course.total_duration_minutes} min</span>
          <span className="flex items-center gap-1.5"><CheckCircle size={14} className="text-emerald-400" /> {course.completed_lessons}/{course.total_lessons} lecciones</span>
        </div>
      </div>

      {/* Video Player and Curriculum Split */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Lesson Video Player */}
        <div className="lg:col-span-2 space-y-4">
          <div className="aspect-video bg-black rounded-2xl overflow-hidden border border-slate-800 relative shadow-2xl flex items-center justify-center">
            {selectedLesson?.media_url ? (
              <video 
                key={selectedLesson.id}
                src={selectedLesson.media_url} 
                controls 
                className="w-full h-full object-contain"
                autoPlay={false}
              />
            ) : (
              <div className="text-center p-6 text-slate-500">
                <Video size={48} className="mx-auto mb-2 opacity-50" />
                <p className="text-xs">No hay archivo de vídeo asignado a esta lección.</p>
                <p className="text-[11px] text-slate-600 mt-1">Usa la opción de vincular carpeta local para cargar vídeos.</p>
              </div>
            )}
          </div>

          {selectedLesson && (
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-sm text-white">{selectedLesson.title}</h3>
                <p className="text-xs text-slate-400 mt-0.5">Duración estimada: {selectedLesson.duration_minutes} min</p>
              </div>
              <button
                onClick={() => handleToggleComplete(selectedLesson)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                  selectedLesson.is_completed
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-purple-600 hover:bg-purple-500 text-white'
                }`}
              >
                {selectedLesson.is_completed ? <><Check size={14} /> Completada</> : 'Marcar Completada'}
              </button>
            </div>
          )}
        </div>

        {/* Modules & Lessons List */}
        <div className="space-y-4 bg-slate-900/40 p-4 rounded-2xl border border-slate-800/80 max-h-[600px] overflow-y-auto">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider">Plan de Estudio</h2>
          {course.modules?.map((mod) => (
            <div key={mod.id} className="space-y-2">
              <h4 className="text-xs font-bold text-purple-300 px-1">{mod.title}</h4>
              <div className="space-y-1">
                {mod.lessons?.map((les) => {
                  const isSelected = selectedLesson?.id === les.id;
                  return (
                    <div
                      key={les.id}
                      onClick={() => setSelectedLesson(les)}
                      className={`flex items-center justify-between p-2.5 rounded-lg cursor-pointer text-xs transition ${
                        isSelected 
                          ? 'bg-purple-600/20 text-purple-200 border border-purple-500/30 font-medium'
                          : 'hover:bg-slate-800/60 text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        {les.is_completed ? (
                          <CheckCircle size={14} className="text-emerald-400 shrink-0" />
                        ) : (
                          <Circle size={14} className="text-slate-500 shrink-0" />
                        )}
                        <span className="truncate">{les.title}</span>
                      </div>
                      <span className="text-[10px] text-slate-500 shrink-0 ml-2">{les.duration_minutes}m</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
