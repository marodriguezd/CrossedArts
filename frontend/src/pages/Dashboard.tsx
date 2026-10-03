import React from 'react';
import { KPIMetrics, Course, Book, LearningSession } from '../types/models.ts';
import { BookOpen, GraduationCap, Clock, Flame, Brain, Play, CheckCircle2, ArrowRight, CalendarCheck, History } from 'lucide-react';

interface DashboardProps {
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  recentSessions: LearningSession[];
  onSelectCourse: (id: string) => void;
  onNavigate: (tab: string) => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ kpis, courses, books, recentSessions, onSelectCourse, onNavigate }) => {
  const today = kpis?.today;
  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero Welcome Banner */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/40 via-slate-900/60 to-slate-950 p-6 md:p-8 border border-purple-500/20 shadow-xl">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-500/10 border border-purple-500/30 text-purple-300 text-xs font-semibold mb-3">
            ✨ GitHub Pages First • Local-First Learning
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mb-2">
            Continúa construyendo tu maestría intelectual.
          </h1>
          <p className="text-sm text-slate-300 mb-6 leading-relaxed">
            Tu base de datos SQLite relacional y tus notas se ejecutan 100% en tu navegador. Sin dependencias forzadas de servidor.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => onNavigate('library')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 transition active:scale-95"
            >
              Explorar Recursos
              <ArrowRight size={14} />
            </button>
            <button
              onClick={() => onNavigate('review')}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-800/40 transition"
            >
              <Brain size={14} />
              Centro de Repaso (SM-2)
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <GraduationCap size={22} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Recursos Totales</p>
            <h3 className="text-xl font-bold text-white">{kpis?.total_resources ?? 0}</h3>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <CheckCircle2 size={22} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Completados</p>
            <h3 className="text-xl font-bold text-white">{kpis?.completed_resources ?? 0}</h3>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
            <Clock size={22} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Horas de Estudio</p>
            <h3 className="text-xl font-bold text-white">{kpis?.total_study_hours ?? 0}h</h3>
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center gap-4">
          <div className="p-3 rounded-lg bg-rose-500/10 text-rose-400 border border-rose-500/20">
            <Flame size={22} />
          </div>
          <div>
            <p className="text-xs text-slate-400 font-medium">Racha Activa</p>
            <h3 className="text-xl font-bold text-white">{kpis?.active_streak_days ?? 0} días</h3>
          </div>
        </div>
      </div>

      {/* Progreso local de hoy y sesiones recientes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <CalendarCheck className="text-emerald-400" size={18} /> Hoy
          </h2>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-lg font-bold text-white">{today?.items_reviewed ?? 0}</p>
              <p className="text-[10px] text-slate-400">Ítems repasados</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-lg font-bold text-purple-300">{today?.flashcards_reviewed ?? 0}</p>
              <p className="text-[10px] text-slate-400">Tarjetas</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/50 border border-slate-800">
              <p className="text-lg font-bold text-indigo-300">{today?.questions_answered ?? 0}</p>
              <p className="text-[10px] text-slate-400">Preguntas</p>
            </div>
          </div>
          <button
            onClick={() => onNavigate('review')}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
          >
            <Play size={13} /> Iniciar sesión de estudio
          </button>
        </div>

        <div className="lg:col-span-2 p-5 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <History className="text-purple-400" size={18} /> Sesiones recientes
          </h2>
          {recentSessions.length === 0 ? (
            <p className="text-xs text-slate-500">Aún no has completado ninguna sesión de estudio.</p>
          ) : (
            <ul className="space-y-2">
              {recentSessions.map(session => (
                <li key={session.id} className="flex items-center justify-between p-3 rounded-xl bg-slate-950/50 border border-slate-800 text-xs">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-200 truncate">
                      {session.resource_title || 'Estudio general'}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      {session.cards_reviewed} tarjetas · {session.questions_answered} preguntas
                    </p>
                  </div>
                  <span className="text-[11px] font-medium text-purple-300 shrink-0">{session.duration_minutes} min</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Main Content Sections: Cursos en Progreso y Libros */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Cursos en Progreso */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <GraduationCap className="text-purple-400" size={20} />
              Cursos en Progreso
            </h2>
            <button onClick={() => onNavigate('library')} className="text-xs text-purple-400 hover:text-purple-300">
              Ver todos →
            </button>
          </div>

          <div className="space-y-3">
            {courses.slice(0, 3).map(course => (
              <div 
                key={course.id}
                onClick={() => onSelectCourse(course.id)}
                className="group p-4 rounded-xl bg-slate-900/50 hover:bg-slate-900 border border-slate-800/80 hover:border-purple-500/40 cursor-pointer transition-all duration-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  {course.cover_path ? (
                    <img 
                      src={course.cover_path} 
                      alt={course.title} 
                      className="w-14 h-14 rounded-lg object-cover border border-slate-700" 
                    />
                  ) : (
                    <div className="w-14 h-14 rounded-lg bg-purple-950/40 border border-purple-800/40 flex items-center justify-center text-purple-400">
                      <GraduationCap size={22} />
                    </div>
                  )}
                  <div>
                    <h3 className="font-semibold text-sm text-slate-100 group-hover:text-purple-300 transition">
                      {course.title}
                    </h3>
                    <p className="text-xs text-slate-400">{course.instructor || 'Instructor'}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-800 text-purple-300">
                        {course.category}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        {course.completed_lessons}/{course.total_lessons} lecciones
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <div className="w-24 bg-slate-800 h-2 rounded-full overflow-hidden">
                    <div 
                      className="bg-purple-500 h-full rounded-full transition-all"
                      style={{ width: `${course.total_lessons ? ((course.completed_lessons || 0) / course.total_lessons) * 100 : 0}%` }}
                    />
                  </div>
                  <button className="p-2 rounded-lg bg-purple-600/20 text-purple-300 group-hover:bg-purple-600 group-hover:text-white transition">
                    <Play size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Lecturas Activas */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <BookOpen className="text-indigo-400" size={20} />
              Lecturas Activas
            </h2>
          </div>

          <div className="space-y-3">
            {books.slice(0, 3).map(book => (
              <div key={book.id} className="p-3.5 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center gap-3">
                {book.cover_path ? (
                  <img 
                    src={book.cover_path} 
                    alt={book.title} 
                    className="w-12 h-16 rounded-md object-cover border border-slate-700 shadow-sm"
                  />
                ) : (
                  <div className="w-12 h-16 rounded-md bg-indigo-950/40 border border-indigo-800/40 flex items-center justify-center text-indigo-400 shrink-0 shadow-sm">
                    <BookOpen size={20} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-xs text-slate-200 truncate">{book.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{book.author}</p>
                  <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span>Pág. {book.current_page}/{book.page_count}</span>
                    <span className="font-bold text-indigo-400">{book.reading_percentage}%</span>
                  </div>
                  <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                    <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${book.reading_percentage}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
