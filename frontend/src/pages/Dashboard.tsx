import React, { useEffect, useState } from 'react';
import { KPIMetrics, Course, Book, LearningSession } from '../types/models.ts';
import {
  GraduationCap,
  BookOpen,
  Play,
  ArrowRight,
  Brain,
  Network,
  FileText,
  Library,
  Flame,
  History,
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { Button, ProgressBar, Panel, SectionHeading, EmptyState } from '../components/ui/index.tsx';

interface DashboardProps {
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  recentSessions: LearningSession[];
  onSelectCourse: (id: string) => void;
  onNavigate: (tab: string) => void;
}

interface ContinueTarget {
  course: Course;
  lessonTitle: string;
}

/**
 * Dashboard como centro de mando académico: continuación de estudio, actividad
 * real de hoy, cursos en curso, actividad reciente y accesos directos.
 * Todos los números provienen de datos reales de CrossedArts (no hay métricas
 * inventadas ni gráficos sintéticos).
 */
export const Dashboard: React.FC<DashboardProps> = ({
  kpis,
  courses,
  books,
  recentSessions,
  onSelectCourse,
  onNavigate,
}) => {
  const today = kpis?.today;
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);

  // Continuación determinista: primer curso incompleto + próxima lección real.
  useEffect(() => {
    let cancelled = false;
    const target = courses.find((c) => (c.completed_lessons || 0) < (c.total_lessons || 0)) || courses[0];
    if (!target) {
      setContinueTarget(null);
      return;
    }
    dao
      .getNextLessonForCourse(target.id)
      .then((next) => {
        if (cancelled) return;
        setContinueTarget({ course: target, lessonTitle: next?.lesson?.title || '' });
      })
      .catch(() => {
        if (!cancelled) setContinueTarget({ course: target, lessonTitle: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [courses]);

  const coursePct = (c: Course) =>
    c.total_lessons ? Math.round(((c.completed_lessons || 0) / c.total_lessons) * 100) : 0;

  const shortcuts = [
    { tab: 'library', label: 'Biblioteca', hint: 'Explorar recursos', icon: Library },
    { tab: 'review', label: 'Repaso SM-2', hint: 'Revisar tarjetas', icon: Brain },
    { tab: 'graph', label: 'Grafo', hint: 'Explorar conceptos', icon: Network },
    { tab: 'notes', label: 'Notas', hint: 'Tus apuntes', icon: FileText },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* --- Cabecera de página --- */}
      <header>
        <h1 className="type-display text-ink">Dashboard</h1>
        <p className="type-secondary mt-1">Tu actividad de estudio, tu continuación y accesos rápidos.</p>
      </header>

      {/* --- Continuar aprendizaje (acción principal) + Estudio de hoy --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2 p-5 sm:p-6">
          <p className="type-micro">Continúa aprendizaje</p>
          {continueTarget ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 className="type-title text-ink truncate">{continueTarget.course.title}</h2>
                <p className="type-secondary mt-1 truncate">
                  {continueTarget.lessonTitle
                    ? `Próxima: ${continueTarget.lessonTitle}`
                    : 'Curso completo — vuelve a repasar cuando quieras.'}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <ProgressBar
                    value={coursePct(continueTarget.course)}
                    label={`Progreso de ${continueTarget.course.title}`}
                    className="max-w-56"
                  />
                  <span className="text-meta font-semibold text-muted">
                    {coursePct(continueTarget.course)}%
                  </span>
                  <span className="text-meta">
                    {continueTarget.course.completed_lessons || 0}/{continueTarget.course.total_lessons} lecciones
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="solid" onClick={() => onSelectCourse(continueTarget.course.id)}>
                  <Play size={14} aria-hidden="true" />
                  Continuar
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title="Aún no hay cursos"
              hint="Importa documentos o crea tu primer curso desde la Biblioteca para empezar."
              action={
                <Button variant="outline" onClick={() => onNavigate('library')}>
                  Explorar Biblioteca
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              }
            />
          )}
        </Panel>

        <Panel className="p-5">
          <p className="type-micro">Estudio de hoy</p>
          <div className="mt-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold text-ink">{today?.items_reviewed ?? 0}</span>
              <span className="type-meta">ítems repasados</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-semibold text-ink">{today?.flashcards_reviewed ?? 0}</span>
              <span className="type-meta">tarjetas</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-semibold text-ink">{today?.questions_answered ?? 0}</span>
              <span className="type-meta">preguntas</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-semibold text-success">{today?.correct_answers ?? 0}</span>
              <span className="type-meta">aciertos</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
            <Flame size={15} className="text-warning" aria-hidden="true" />
            <span className="text-meta text-muted">
              Racha activa: <strong className="text-ink">{kpis?.active_streak_days ?? 0} días</strong>
            </span>
          </div>
        </Panel>
      </div>

      {/* --- Franja de métricas reales (una sola superficie, sin tarjetas) --- */}
      <div className="grid grid-cols-2 divide-line rounded-xl border border-line bg-surface shadow-card md:grid-cols-4 md:divide-x">
        <div className="px-5 py-4">
          <p className="type-micro">Recursos totales</p>
          <p className="mt-1 text-xl font-semibold text-ink">{kpis?.total_resources ?? 0}</p>
        </div>
        <div className="border-line px-5 py-4 md:border-0">
          <p className="type-micro">Completados</p>
          <p className="mt-1 text-xl font-semibold text-ink">{kpis?.completed_resources ?? 0}</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">Horas de estudio</p>
          <p className="mt-1 text-xl font-semibold text-ink">{kpis?.total_study_hours ?? 0} h</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">Racha activa</p>
          <p className="mt-1 text-xl font-semibold text-ink">{kpis?.active_streak_days ?? 0} días</p>
        </div>
      </div>

      {/* --- Cursos + actividad --- */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SectionHeading
            title="Cursos en progreso"
            action={
              <button
                onClick={() => onNavigate('library')}
                className="text-meta font-medium text-accent hover:underline"
              >
                Ver todos →
              </button>
            }
          />
          {courses.length === 0 ? (
            <p className="type-secondary">Aún no tienes cursos. Encuéntralos en la Biblioteca.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
              {courses.slice(0, 4).map((course) => (
                <li key={course.id}>
                  <button
                    onClick={() => onSelectCourse(course.id)}
                    className="group flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors duration-fast hover:bg-accent-soft/40"
                  >
                    {course.cover_path ? (
                      <img
                        src={course.cover_path}
                        alt=""
                        aria-hidden="true"
                        className="h-12 w-12 shrink-0 rounded-lg border border-line object-cover"
                      />
                    ) : (
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-line bg-accent-soft text-accent">
                        <GraduationCap size={20} aria-hidden="true" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="type-item block truncate text-ink group-hover:text-accent">
                        {course.title}
                      </span>
                      <span className="type-meta mt-0.5 block truncate">
                        {course.instructor || course.category} · {course.completed_lessons || 0}/
                        {course.total_lessons} lecciones
                      </span>
                    </span>
                    <span className="hidden w-32 shrink-0 sm:block">
                      <ProgressBar
                        value={coursePct(course)}
                        label={`Progreso de ${course.title}`}
                      />
                    </span>
                    <span className="text-meta font-semibold text-muted w-10 text-right">
                      {coursePct(course)}%
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-on-accent">
                      <Play size={13} aria-hidden="true" />
                      <span className="sr-only">Continuar {course.title}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Actividad reciente */}
          <div className="mt-8">
            <SectionHeading title="Actividad reciente" />
            {recentSessions.length === 0 ? (
              <p className="type-secondary">
                Aún no has completado ninguna sesión de estudio.
              </p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
                {recentSessions.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="type-item truncate text-ink">
                        {session.resource_title || 'Estudio general'}
                      </p>
                      {/* El ámbito de lección solo se muestra cuando existe realmente. */}
                      {session.lesson_id && (
                        <p className="type-meta truncate text-accent">
                          Lección: {session.lesson_title || session.lesson_id}
                        </p>
                      )}
                      <p className="type-meta mt-0.5">
                        {session.cards_reviewed} tarjetas · {session.questions_answered} preguntas
                      </p>
                    </div>
                    <span className="shrink-0 text-meta font-semibold text-muted">
                      {session.duration_minutes} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* --- Columna lateral: accesos y lecturas --- */}
        <div className="space-y-8">
          <div>
            <SectionHeading title="Accesos rápidos" />
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.tab}
                    onClick={() => onNavigate(s.tab)}
                    className="group rounded-xl border border-line bg-surface px-3 py-3 text-left shadow-card transition-colors duration-fast hover:border-accent/40 hover:bg-accent-soft/40"
                  >
                    <Icon size={16} className="text-accent" aria-hidden="true" />
                    <span className="type-item mt-2 block text-ink">{s.label}</span>
                    <span className="type-meta block">{s.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionHeading title="Lecturas activas" />
            {books.length === 0 ? (
              <p className="type-secondary">No hay libros en curso.</p>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface shadow-card">
                {books.slice(0, 3).map((book) => (
                  <li key={book.id} className="flex items-center gap-3 px-4 py-3">
                    {book.cover_path ? (
                      <img
                        src={book.cover_path}
                        alt=""
                        aria-hidden="true"
                        className="h-14 w-10 shrink-0 rounded border border-line object-cover"
                      />
                    ) : (
                      <span className="flex h-14 w-10 shrink-0 items-center justify-center rounded border border-line bg-accent-soft text-accent">
                        <BookOpen size={16} aria-hidden="true" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="type-item truncate text-ink">{book.title}</p>
                      <p className="type-meta truncate">{book.author || 'Autor no indicado'}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar
                          value={book.reading_percentage || 0}
                          label={`Lectura de ${book.title}`}
                          className="flex-1"
                        />
                        <span className="text-meta font-semibold text-muted">
                          {book.reading_percentage || 0}%
                        </span>
                      </div>
                      <p className="type-meta mt-1">
                        Pág. {book.current_page}/{book.page_count}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
            <History size={15} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
            <p className="type-meta">
              Todo se calcula localmente desde SQLite: sin métricas inventadas ni sin conexión
              necesaria.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
