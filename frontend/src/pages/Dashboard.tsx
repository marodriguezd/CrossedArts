import React, { useEffect, useState } from 'react';
import {
  KPIMetrics,
  Course,
  Book,
  LearningResource,
  LearningSession,
  PracticeWork,
  TimeRangeFilter,
  DailyActivityPoint
} from '../types/models.ts';
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
  BarChart3,
  Clock,
  CalendarCheck,
  Target,
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { getStoredPlaybackSeconds, formatPlaybackTime } from '../services/domainLogic.ts';
import { Button, ProgressBar, Panel, SectionHeading, EmptyState, Chip, Badge, cn } from '../components/ui/index.tsx';
import { ResourceGallery, type GalleryEntry } from '../components/dashboard/ResourceGallery.tsx';
import { MountainProgress } from '../components/dashboard/MountainProgress.tsx';
import {
  buildGalleryItems,
  groupGalleryItems,
  ARTIFACT_ID_PREFIX,
  type ArtifactKind,
  type GalleryItem
} from '../services/galleryItems.ts';
import { summarizePracticeWork } from '../services/practiceWork.ts';
import { describeStudySessionScope } from '../services/sessionScope.ts';

interface DashboardProps {
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  /** Recursos importados (documentos) que no son cursos ni libros. */
  resources?: LearningResource[];
  /** Trabajo práctico producido por el estudiante. */
  practiceWork?: PracticeWork[];
  recentSessions: LearningSession[];
  onSelectCourse: (id: string) => void;
  onOpenLesson?: (lessonId: string) => void;
  /** Abre cualquier recurso (libro, documento importado, concepto…) en su detalle. */
  onOpenResource?: (resourceId: string) => void;
  onNavigate: (tab: string) => void;
}

interface ContinueTarget {
  course: Course;
  lessonId?: string;
  lessonTitle: string;
  moduleTitle?: string;
  savedSeconds?: number | null;
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
  resources = [],
  practiceWork = [],
  recentSessions,
  onSelectCourse,
  onOpenLesson,
  onOpenResource,
  onNavigate,
}) => {
  const today = kpis?.today;
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);

  // Continuación determinista: primer curso incompleto + próxima lección real con memoria de reproducción.
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
        const lessonId = next?.lesson?.id;
        const savedSeconds = lessonId ? getStoredPlaybackSeconds(lessonId) : null;
        setContinueTarget({
          course: target,
          lessonId,
          lessonTitle: next?.lesson?.title || '',
          moduleTitle: next?.moduleTitle || '',
          savedSeconds
        });
      })
      .catch(() => {
        if (!cancelled) setContinueTarget({ course: target, lessonTitle: '' });
      });
    return () => {
      cancelled = true;
    };
  }, [courses]);

  // Estado del gráfico de actividad diaria y rango temporal
  const [timeRange, setTimeRange] = useState<TimeRangeFilter>('7d');
  const [chartMetric, setChartMetric] = useState<'minutes' | 'reviews'>('minutes');
  const [activityPoints, setActivityPoints] = useState<DailyActivityPoint[]>([]);
  const [, setLoadingActivity] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingActivity(true);
    dao
      .getDailyActivitySeries(timeRange)
      .then((points) => {
        if (!cancelled) setActivityPoints(points);
      })
      .catch((err) => console.warn('Error al cargar serie de actividad diaria:', err))
      .finally(() => {
        if (!cancelled) setLoadingActivity(false);
      });
    return () => {
      cancelled = true;
    };
  }, [timeRange, kpis]);

  const coursePct = (c: Course) =>
    c.total_lessons ? Math.round(((c.completed_lessons || 0) / c.total_lessons) * 100) : 0;

  // Los libros y documentos no son cursos: deben abrirse en su vista de detalle.
  // Si la página no recibe `onOpenResource` (uso embebido), se degrada a la
  // selección de curso en lugar de fallar silenciosamente.
  const openResourceOrCourse = (id: string) => {
    if (onOpenResource) onOpenResource(id);
    else onSelectCourse(id);
  };

  // Galería visual unificada y agnóstica al dominio: `buildGalleryItems`
  // normaliza cursos, libros, recursos importados y trabajo práctico a la MISMA
  // forma (ver services/galleryItems.ts).
  const practiceById = new Map(practiceWork.map((work) => [work.id, work]));

  /** Abre un artefacto en su destino real a partir del id normalizado. */
  const openArtifact = (kind: ArtifactKind, id: string) => {
    const rawId = id.slice(ARTIFACT_ID_PREFIX[kind].length);
    if (kind === 'course') return onSelectCourse(rawId);
    if (kind === 'practice') {
      // El trabajo práctico se abre en su contexto de origen (recurso, lección o
      // concepto): es evidencia ligada a algo que el usuario está estudiando.
      const work = practiceById.get(rawId);
      const contextId = work?.resource_id || work?.lesson_id || work?.concept_id;
      if (contextId) return openResourceOrCourse(contextId);
      return onNavigate('library');
    }
    return openResourceOrCourse(rawId);
  };

  const toEntries = (items: GalleryItem[]): GalleryEntry[] =>
    items.map((item) => ({ ...item, onOpen: () => openArtifact(item.kind, item.id) }));

  const sections = groupGalleryItems(buildGalleryItems(courses, books, { resources, practiceWork }));
  const continueEntries = toEntries(sections.continueLearning);
  const resourceEntries = toEntries(sections.resources);
  const practiceEntries = toEntries(sections.practice);
  const practiceSummary = summarizePracticeWork(practiceWork);
  const hasVisibleArtifact = continueEntries.length + resourceEntries.length + practiceEntries.length > 0;
  const hasOnlyCompleted = !hasVisibleArtifact && sections.completed.length > 0;
  // La galería se considera poblada también cuando solo hay elementos
  // completados: en ese caso el estado vacío debe decirlo, no fingir que no hay nada.
  const hasAnyArtifact = hasVisibleArtifact || hasOnlyCompleted;

  // La montaña usa SOLO progreso medido (lecciones de curso y páginas de libro).
  // Mezclar indicadores gruesos de estado con porcentajes reales haría que el
  // indicador mintiera sobre el avance.
  const mountainSources = [...sections.continueLearning, ...sections.completed]
    .filter((item) => item.progressSource !== 'status')
    .map((item) => ({ percent: item.progress }));

  const shortcuts = [
    { tab: 'focus', label: 'Hoy', hint: 'Qué hacer ahora', icon: CalendarCheck },
    { tab: 'library', label: 'Biblioteca', hint: 'Explorar recursos', icon: Library },
    { tab: 'review', label: 'Repaso SM-2', hint: 'Revisar tarjetas', icon: Brain },
    { tab: 'goals', label: 'Metas', hint: 'Objetivos con progreso', icon: Target },
    { tab: 'analytics', label: 'Análisis', hint: 'Tu historial real', icon: BarChart3 },
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
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="type-title text-ink truncate">{continueTarget.course.title}</h2>
                  {continueTarget.savedSeconds && continueTarget.savedSeconds > 5 && (
                    <Badge tone="accent">
                      <Clock size={11} aria-hidden="true" />
                      Minuto {formatPlaybackTime(continueTarget.savedSeconds)}
                    </Badge>
                  )}
                </div>
                <p className="type-secondary mt-1 truncate">
                  {continueTarget.lessonTitle
                    ? `Próxima: ${continueTarget.lessonTitle}${continueTarget.moduleTitle ? ` (${continueTarget.moduleTitle})` : ''}`
                    : 'Curso completo. Vuelve a repasar cuando quieras.'}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <ProgressBar
                    value={coursePct(continueTarget.course)}
                    label={`Progreso de ${continueTarget.course.title}`}
                    className="max-w-56"
                  />
                  <span className="text-meta font-mono font-semibold text-muted">
                    {coursePct(continueTarget.course)}%
                  </span>
                  <span className="text-meta font-mono text-muted">
                    {continueTarget.course.completed_lessons || 0}/{continueTarget.course.total_lessons} lecciones
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button
                  variant="solid"
                  onClick={() => {
                    if (continueTarget.lessonId && onOpenLesson) {
                      onOpenLesson(continueTarget.lessonId);
                    } else {
                      onSelectCourse(continueTarget.course.id);
                    }
                  }}
                  title={
                    continueTarget.savedSeconds && continueTarget.savedSeconds > 5
                      ? `Reanudar lección en el minuto ${formatPlaybackTime(continueTarget.savedSeconds)}`
                      : 'Continuar lección directamente'
                  }
                >
                  <Play size={14} aria-hidden="true" />
                  {continueTarget.savedSeconds && continueTarget.savedSeconds > 5 ? 'Reanudar lección' : 'Continuar lección'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => onSelectCourse(continueTarget.course.id)}
                  title="Ver temario del curso"
                >
                  Ver curso
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
              <span className="text-2xl font-mono font-semibold text-ink">{today?.items_reviewed ?? 0}</span>
              <span className="type-meta">ítems repasados</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-ink">{today?.flashcards_reviewed ?? 0}</span>
              <span className="type-meta">tarjetas</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-ink">{today?.questions_answered ?? 0}</span>
              <span className="type-meta">preguntas</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-success">{today?.correct_answers ?? 0}</span>
              <span className="type-meta">aciertos</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
            <Flame size={15} className="text-warning" aria-hidden="true" />
            <span className="text-meta text-muted">
              Racha activa: <strong className="text-ink font-mono">{kpis?.active_streak_days ?? 0} días</strong>
            </span>
          </div>
        </Panel>
      </div>

      {/* --- Galería visual: el contenido va ANTES que las métricas --- */}
      {hasAnyArtifact ? (
        <div className="space-y-8">
          <ResourceGallery
            items={continueEntries}
            title="Continúa aprendiendo"
            description="Lo que tienes en marcha o pendiente, con su progreso real."
            onSeeAll={() => onNavigate('library')}
            seeAllLabel="Ver toda la Biblioteca"
            limit={6}
            emptyHint={
              hasOnlyCompleted
                ? 'Tienes todo lo que empezaste completado. Los cursos y libros terminados siguen disponibles en la Biblioteca.'
                : 'Aún no tienes cursos ni libros. Importa un documento o crea un curso desde la Biblioteca.'
            }
          />

          {resourceEntries.length > 0 && (
            <ResourceGallery
              items={resourceEntries}
              title="Recursos importados"
              description="Documentos que has incorporado y todavía no forman parte de un curso."
              onSeeAll={() => onNavigate('library')}
              seeAllLabel="Ver en la Biblioteca"
              limit={6}
            />
          )}

          {practiceEntries.length > 0 && (
            /* Sin enlace "ver todo": el trabajo práctico no tiene una lista propia;
               cada ficha abre su contexto de origen (recurso, lección o concepto). */
            <ResourceGallery
              items={practiceEntries}
              title="Trabajo práctico"
              description={`${practiceSummary.done} de ${practiceSummary.total} terminados · evidencia de lo que produces`}
              limit={6}
            />
          )}
        </div>
      ) : (
        <ResourceGallery
          items={[]}
          title="Continúa aprendiendo"
          description="Lo que tienes en marcha o pendiente, con su progreso real."
          onSeeAll={() => onNavigate('library')}
          limit={6}
          emptyHint="Tu galería está vacía. Importa un documento, crea un curso o registra un trabajo práctico desde la Biblioteca para empezar."
        />
      )}

      {/* --- Franja de métricas reales (una sola superficie, sin tarjetas) --- */}
      <div className="grid grid-cols-2 divide-line rounded-xl border border-line bg-surface shadow-card md:grid-cols-4 md:divide-x">
        <div className="px-5 py-4">
          <p className="type-micro">Recursos totales</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.total_resources ?? 0}</p>
        </div>
        <div className="border-line px-5 py-4 md:border-0">
          <p className="type-micro">Completados</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.completed_resources ?? 0}</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">Horas de estudio</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.total_study_hours ?? 0} h</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">Racha activa</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.active_streak_days ?? 0} días</p>
        </div>
      </div>

      {/* --- Gráfico de actividad diaria interactivo con selector de rango y métrica --- */}
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" aria-hidden="true" />
              <h2 className="type-title text-ink">Historial de estudio</h2>
            </div>
            <p className="type-secondary mt-1">
              Registro diario de constancia: {chartMetric === 'minutes' ? 'minutos dedicados' : 'ítems repasados'}.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de métrica */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label="Métrica a visualizar">
              <button
                type="button"
                onClick={() => setChartMetric('minutes')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                  chartMetric === 'minutes' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                Minutos
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('reviews')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                  chartMetric === 'reviews' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                Repasos
              </button>
            </div>

            {/* Selector de rango temporal */}
            <div className="flex items-center gap-1" role="group" aria-label="Rango temporal">
              {(['7d', '30d', 'all'] as const).map((r) => (
                <Chip
                  key={r}
                  active={timeRange === r}
                  onClick={() => setTimeRange(r)}
                >
                  {r === '7d' ? '7 días' : r === '30d' ? '30 días' : 'Histórico'}
                </Chip>
              ))}
            </div>
          </div>
        </div>

        {/* Visualización de barras verticales CSS semánticas */}
        <div className="mt-6">
          {(() => {
            const values = activityPoints.map((p) => (chartMetric === 'minutes' ? p.minutes : p.reviews));
            const maxValue = Math.max(...values, chartMetric === 'minutes' ? 30 : 10);
            const totalValue = values.reduce((sum, v) => sum + v, 0);

            return (
              <div>
                <div className="mb-3 flex items-center justify-between text-meta text-muted">
                  <span>
                    Total en periodo: <strong className="text-ink">{totalValue} {chartMetric === 'minutes' ? 'minutos' : 'repasos'}</strong>
                  </span>
                  <span>Máximo diario: <strong className="text-ink">{Math.max(...values, 0)}</strong></span>
                </div>

                <div className="flex h-44 items-end gap-1 sm:gap-2 overflow-x-auto pb-6 pt-2">
                  {activityPoints.map((point) => {
                    const val = chartMetric === 'minutes' ? point.minutes : point.reviews;
                    const heightPct = maxValue > 0 ? Math.min(100, Math.max(val > 0 ? 8 : 2, Math.round((val / maxValue) * 100))) : 2;

                    return (
                      <div
                        key={point.date}
                        className="group relative flex flex-1 flex-col items-center h-full justify-end min-w-[20px] max-w-[48px]"
                      >
                        {/* Tooltip accesible flotante */}
                        <div
                          className="pointer-events-none absolute bottom-full mb-2 hidden -translate-x-1/2 left-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-micro shadow-overlay group-hover:block group-focus-within:block z-20"
                          role="tooltip"
                        >
                          <p className="font-semibold text-ink">{point.label} ({point.date})</p>
                          <p className="text-accent">{point.minutes} min de estudio</p>
                          <p className="text-muted">{point.reviews} ítems repasados</p>
                        </div>

                        {/* Barra vertical */}
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label={`${point.label}: ${val} ${chartMetric === 'minutes' ? 'minutos' : 'repasos'}`}
                          className={cn(
                            'w-full rounded-t-md transition-all duration-fast focus:outline-none focus:ring-2 focus:ring-accent',
                            val > 0
                              ? 'bg-accent hover:opacity-90 group-hover:brightness-110'
                              : 'bg-line/40 hover:bg-line/70'
                          )}
                          style={{ height: `${heightPct}%` }}
                        />

                        {/* Etiqueta de fecha inferior */}
                        <span
                          className={cn(
                            'absolute top-full mt-1.5 truncate text-[10px] font-mono select-none',
                            activityPoints.length > 14 ? 'hidden sm:block text-[9px]' : 'block',
                            val > 0 ? 'text-ink font-semibold' : 'text-faint'
                          )}
                        >
                          {point.label.split(' ')[0]}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
      </Panel>

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
                    <span className="text-meta font-mono font-semibold text-muted w-10 text-right">
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
                        {describeStudySessionScope({
                          scope: session.scope,
                          resourceTitle: session.resource_title,
                          lessonTitle: session.lesson_title
                        })}
                      </p>
                      {/* El ámbito de lección solo se muestra cuando existe realmente. */}
                      {session.lesson_id && (
                        <div className="flex items-center gap-2">
                          <p className="type-meta truncate text-accent">
                            Lección: {session.lesson_title || session.lesson_id}
                          </p>
                          {onOpenLesson && (
                            <button
                              type="button"
                              onClick={() => onOpenLesson(session.lesson_id!)}
                              className="inline-flex items-center gap-0.5 text-micro font-medium text-accent hover:underline cursor-pointer"
                              title="Abrir esta lección"
                            >
                              <Play size={9} aria-hidden="true" /> Reanudar
                            </button>
                          )}
                        </div>
                      )}
                      <p className="type-meta mt-0.5">
                        <span className="font-mono">{session.cards_reviewed}</span> tarjetas · <span className="font-mono">{session.questions_answered}</span> preguntas
                      </p>
                    </div>
                    <span className="shrink-0 text-meta font-mono font-semibold text-muted">
                      {session.duration_minutes} min
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* --- Columna lateral: progreso global, accesos y lecturas --- */}
        <div className="space-y-8">
          <MountainProgress resources={mountainSources} />

          <div>
            <SectionHeading title="Accesos rápidos" />
            <div className="grid grid-cols-2 gap-2">
              {shortcuts.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.tab}
                    onClick={() => onNavigate(s.tab)}
                    className="group rounded-xl border border-line bg-surface px-3 py-3 text-left shadow-card transition-all duration-fast hover:border-accent/40 hover:bg-accent-soft/40 active:scale-[0.98]"
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
                        <span className="text-meta font-mono font-semibold text-muted">
                          {book.reading_percentage || 0}%
                        </span>
                      </div>
                      <p className="type-meta font-mono mt-1">
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
