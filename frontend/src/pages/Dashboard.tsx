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
import { useLanguage } from '../hooks/useLanguage.ts';

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
  const { t, effective } = useLanguage();
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
      .getDailyActivitySeries(timeRange, effective)
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
  }, [timeRange, kpis, effective]);

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

  const sections = groupGalleryItems(buildGalleryItems(courses, books, { resources, practiceWork }, effective));
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
    { tab: 'focus', labelKey: 'nav.today', hintKey: 'qnav.todayHint', icon: CalendarCheck },
    { tab: 'library', labelKey: 'nav.library', hintKey: 'qnav.libraryHint', icon: Library },
    { tab: 'review', labelKey: 'nav.review', hintKey: 'qnav.reviewHint', icon: Brain },
    { tab: 'goals', labelKey: 'nav.goals', hintKey: 'qnav.goalsHint', icon: Target },
    { tab: 'analytics', labelKey: 'nav.analytics', hintKey: 'qnav.analyticsHint', icon: BarChart3 },
    { tab: 'graph', labelKey: 'nav.graph', hintKey: 'qnav.graphHint', icon: Network },
    { tab: 'notes', labelKey: 'nav.notes', hintKey: 'qnav.notesHint', icon: FileText },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* --- Cabecera de página --- */}
      <header>
        <h1 className="type-display text-ink">{t('dashboard.title')}</h1>
        <p className="type-secondary mt-1">{t('dashboard.subtitle')}</p>
      </header>

      {/* --- Continuar aprendizaje (acción principal) + Estudio de hoy --- */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2 p-5 sm:p-6">
          <p className="type-micro">{t('dashboard.continueMicro')}</p>
          {continueTarget ? (
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="type-title text-ink break-words line-clamp-2">{continueTarget.course.title}</h2>
                  {continueTarget.savedSeconds && continueTarget.savedSeconds > 5 && (
                    <Badge tone="accent">
                      <Clock size={11} aria-hidden="true" />
                      {t('dashboard.minuteBadge', { time: formatPlaybackTime(continueTarget.savedSeconds) })}
                    </Badge>
                  )}
                </div>
                <p className="type-secondary mt-1.5 break-words line-clamp-2">
                  {continueTarget.lessonTitle
                    ? `${t('dashboard.nextUp', { lesson: continueTarget.lessonTitle })}${continueTarget.moduleTitle ? t('dashboard.nextModule', { module: continueTarget.moduleTitle }) : ''}`
                    : t('dashboard.courseDone')}
                </p>
                <div className="mt-3.5 space-y-1.5 max-w-md">
                  <div className="flex items-center justify-between text-meta font-mono text-muted">
                    <span className="font-semibold text-ink">{coursePct(continueTarget.course)}%</span>
                    <span>
                      {t('dashboard.lessonsCount', { done: String(continueTarget.course.completed_lessons || 0), total: String(continueTarget.course.total_lessons) })}
                    </span>
                  </div>
                  <ProgressBar
                    value={coursePct(continueTarget.course)}
                    label={t('dashboard.progressOf', { title: continueTarget.course.title })}
                    className="w-full"
                  />
                </div>
              </div>
              <div className="mt-2 sm:mt-0 flex shrink-0 flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <Button
                  variant="solid"
                  className="w-full sm:w-auto"
                  onClick={() => {
                    if (continueTarget.lessonId && onOpenLesson) {
                      onOpenLesson(continueTarget.lessonId);
                    } else {
                      onSelectCourse(continueTarget.course.id);
                    }
                  }}
                  title={
                    continueTarget.savedSeconds && continueTarget.savedSeconds > 5
                      ? t('dashboard.resumeAt', { time: formatPlaybackTime(continueTarget.savedSeconds) })
                      : t('dashboard.continueDirect')
                  }
                >
                  <Play size={14} aria-hidden="true" />
                  {continueTarget.savedSeconds && continueTarget.savedSeconds > 5 ? t('dashboard.resumeLesson') : t('dashboard.continueLesson')}
                </Button>
                <Button
                  variant="outline"
                  className="w-full sm:w-auto"
                  onClick={() => onSelectCourse(continueTarget.course.id)}
                  title={t('dashboard.viewSyllabus')}
                >
                  {t('dashboard.viewCourse')}
                </Button>
              </div>
            </div>
          ) : (
            <EmptyState
              title={t('dashboard.noCourses')}
              hint={t('dashboard.noCoursesHint')}
              action={
                <Button variant="outline" onClick={() => onNavigate('library')}>
                  {t('dashboard.exploreLibrary')}
                  <ArrowRight size={14} aria-hidden="true" />
                </Button>
              }
            />
          )}
        </Panel>

        <Panel className="p-5">
          <p className="type-micro">{t('dashboard.todayStudy')}</p>
          <div className="mt-3 space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-mono font-semibold text-ink">{today?.items_reviewed ?? 0}</span>
              <span className="type-meta">{t('dashboard.itemsReviewed')}</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-ink">{today?.flashcards_reviewed ?? 0}</span>
              <span className="type-meta">{t('dashboard.cards')}</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-ink">{today?.questions_answered ?? 0}</span>
              <span className="type-meta">{t('dashboard.questions')}</span>
            </div>
            <div className="border-t border-line pt-2 flex items-baseline justify-between">
              <span className="text-item font-mono font-semibold text-success">{today?.correct_answers ?? 0}</span>
              <span className="type-meta">{t('dashboard.hits')}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 border-t border-line pt-3">
            <Flame size={15} className="text-warning" aria-hidden="true" />
            <span className="text-meta text-muted">
              {t('dashboard.activeStreak')}: <strong className="text-ink font-mono">{t('dashboard.streakDays', { n: kpis?.active_streak_days ?? 0 })}</strong>
            </span>
          </div>
        </Panel>
      </div>

      {/* --- Galería visual: el contenido va ANTES que las métricas --- */}
      {hasAnyArtifact ? (
        <div className="space-y-8">
          <ResourceGallery
            items={continueEntries}
            title={t('dashboard.keepLearning')}
            description={t('dashboard.keepLearningDesc')}
            onSeeAll={() => onNavigate('library')}
            seeAllLabel={t('dashboard.seeAllLibrary')}
            limit={6}
            emptyHint={
              hasOnlyCompleted
                ? t('dashboard.allDone')
                : t('dashboard.emptyCoursesBooks')
            }
          />

          {resourceEntries.length > 0 && (
            <ResourceGallery
              items={resourceEntries}
              title={t('dashboard.importedTitle')}
              description={t('dashboard.importedDesc')}
              onSeeAll={() => onNavigate('library')}
              seeAllLabel={t('dashboard.seeInLibrary')}
              limit={6}
            />
          )}

          {practiceEntries.length > 0 && (
            /* Sin enlace "ver todo": el trabajo práctico no tiene una lista propia;
               cada ficha abre su contexto de origen (recurso, lección o concepto). */
            <ResourceGallery
              items={practiceEntries}
              title={t('dashboard.practiceTitle')}
              description={t('dashboard.practiceDesc', { done: practiceSummary.done, total: practiceSummary.total })}
              limit={6}
            />
          )}
        </div>
      ) : (
        <ResourceGallery
          items={[]}
          title={t('dashboard.keepLearning')}
          description={t('dashboard.keepLearningDesc')}
          onSeeAll={() => onNavigate('library')}
          limit={6}
          emptyHint={t('dashboard.galleryEmpty')}
        />
      )}

      {/* --- Franja de métricas reales (una sola superficie, sin tarjetas) --- */}
      <div className="grid grid-cols-2 divide-line rounded-xl border border-line bg-surface shadow-card md:grid-cols-4 md:divide-x">
        <div className="px-5 py-4">
          <p className="type-micro">{t('dashboard.totalResources')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.total_resources ?? 0}</p>
        </div>
        <div className="border-line px-5 py-4 md:border-0">
          <p className="type-micro">{t('dashboard.completed')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.completed_resources ?? 0}</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">{t('dashboard.studyHours')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{kpis?.total_study_hours ?? 0} h</p>
        </div>
        <div className="border-t border-line px-5 py-4 md:border-0">
          <p className="type-micro">{t('dashboard.activeStreak')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{t('dashboard.streakDays', { n: kpis?.active_streak_days ?? 0 })}</p>
        </div>
      </div>

      {/* --- Gráfico de actividad diaria interactivo con selector de rango y métrica --- */}
      <Panel className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <BarChart3 size={16} className="text-accent" aria-hidden="true" />
              <h2 className="type-title text-ink">{t('dashboard.studyHistory')}</h2>
            </div>
            <p className="type-secondary mt-1">
              {t('dashboard.chartDesc', { metric: chartMetric === 'minutes' ? t('dashboard.minutesStudied') : t('dashboard.itemsReviewed') })}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Selector de métrica */}
            <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label={t('dashboard.metricLabel')}>
              <button
                type="button"
                onClick={() => setChartMetric('minutes')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                  chartMetric === 'minutes' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                {t('dashboard.minutes')}
              </button>
              <button
                type="button"
                onClick={() => setChartMetric('reviews')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                  chartMetric === 'reviews' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                )}
              >
                {t('dashboard.reviews')}
              </button>
            </div>

            {/* Selector de rango temporal */}
            <div className="flex items-center gap-1" role="group" aria-label={t('dashboard.rangeLabel')}>
              {(['7d', '30d', 'all'] as const).map((r) => (
                <Chip
                  key={r}
                  active={timeRange === r}
                  onClick={() => setTimeRange(r)}
                >
                  {r === '7d' ? t('dashboard.range7') : r === '30d' ? t('dashboard.range30') : t('dashboard.rangeAll')}
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
                    {t('dashboard.periodTotal', { total: totalValue, unit: chartMetric === 'minutes' ? t('dashboard.minutes') : t('dashboard.reviews') })}
                  </span>
                  <span>{t('dashboard.dailyMax', { n: Math.max(...values, 0) })}</span>
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
                          <p className="text-accent">{t('dashboard.minStudy', { n: point.minutes })}</p>
                          <p className="text-muted">{t('dashboard.itemsReviewedN', { n: point.reviews })}</p>
                        </div>

                        {/* Barra vertical */}
                        <button
                          type="button"
                          tabIndex={0}
                          aria-label={`${point.label}: ${val} ${chartMetric === 'minutes' ? t('dashboard.minutes') : t('dashboard.reviews')}`}
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
            title={t('dashboard.inProgress')}
            action={
              <button
                onClick={() => onNavigate('library')}
                className="text-meta font-medium text-accent hover:underline"
              >
                {t('dashboard.seeAll')}
              </button>
            }
          />
          {courses.length === 0 ? (
            <p className="type-secondary">{t('dashboard.noCoursesYet')}</p>
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
                        {course.instructor || course.category} · {t('dashboard.lessonsCount', { done: course.completed_lessons || 0, total: course.total_lessons })}
                      </span>
                    </span>
                    <span className="hidden w-32 shrink-0 sm:block">
                      <ProgressBar
                        value={coursePct(course)}
                        label={t('dashboard.progressOf', { title: course.title })}
                      />
                    </span>
                    <span className="text-meta font-mono font-semibold text-muted w-10 text-right">
                      {coursePct(course)}%
                    </span>
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line text-muted transition-colors group-hover:border-accent group-hover:bg-accent group-hover:text-on-accent">
                      <Play size={13} aria-hidden="true" />
                      <span className="sr-only">{t('dashboard.continueSr', { title: course.title })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Actividad reciente */}
          <div className="mt-8">
            <SectionHeading title={t('dashboard.recentActivity')} />
            {recentSessions.length === 0 ? (
              <p className="type-secondary">
                {t('dashboard.noSessions')}
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
                        }, effective)}
                      </p>
                      {/* El ámbito de lección solo se muestra cuando existe realmente. */}
                      {session.lesson_id && (
                        <div className="flex items-center gap-2">
                          <p className="type-meta truncate text-accent">
                            {t('dashboard.lessonLabel', { title: session.lesson_title || session.lesson_id || '' })}
                          </p>
                          {onOpenLesson && (
                            <button
                              type="button"
                              onClick={() => onOpenLesson(session.lesson_id!)}
                              className="inline-flex items-center gap-0.5 text-micro font-medium text-accent hover:underline cursor-pointer"
                              title={t('dashboard.openLesson')}
                            >
                              <Play size={9} aria-hidden="true" /> {t('dashboard.resumeShort')}
                            </button>
                          )}
                        </div>
                      )}
                      <p className="type-meta mt-0.5">
                        {t('dashboard.sessionCounts', { c: session.cards_reviewed, q: session.questions_answered })}
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
            <SectionHeading title={t('dashboard.quickAccess')} />
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
                    <span className="type-item mt-2 block text-ink">{t(s.labelKey)}</span>
                    <span className="type-meta block">{t(s.hintKey)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <SectionHeading title={t('dashboard.activeReads')} />
            {books.length === 0 ? (
              <p className="type-secondary">{t('dashboard.noBooks')}</p>
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
                      <p className="type-meta truncate">{book.author || t('dashboard.authorUnknown')}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <ProgressBar
                          value={book.reading_percentage || 0}
                          label={t('dashboard.readingOf', { title: book.title })}
                          className="flex-1"
                        />
                        <span className="text-meta font-mono font-semibold text-muted">
                          {book.reading_percentage || 0}%
                        </span>
                      </div>
                      <p className="type-meta font-mono mt-1">
                        {t('dashboard.pageCount', { cur: book.current_page, total: book.page_count })}
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
              {t('dashboard.localNote')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
