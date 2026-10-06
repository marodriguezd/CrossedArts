import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  BarChart3,
  BookOpen,
  Brain,
  CalendarDays,
  ClipboardCheck,
  Clock,
  Flame,
  ListChecks,
  Target
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { resolveLocalDay } from '../services/localDate.ts';
import {
  ANALYTICS_RANGES,
  ANALYTICS_RANGE_LABELS,
  buildDailySeries,
  computeAnalyticsOverview,
  computeContentProgress,
  computeRangeComparison,
  computeResourceActivity,
  recentActivity,
  type AnalyticsRange
} from '../services/analytics.ts';
import type { Book, Course, LearningSession, PracticeWork } from '../types/models.ts';
import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';

interface AnalyticsViewProps {
  courses: Course[];
  books: Book[];
  practiceWork: PracticeWork[];
}

interface LoadedData {
  sessions: LearningSession[];
  streakDays: number;
}

type ChartMetric = 'minutes' | 'reviews';

/** Agrupa días cuando la serie es muy larga para caber en pantalla. */
function bucketSeries<T extends { minutes: number; reviews: number }>(
  points: T[],
  maxBuckets: number
): Array<{ start: T; merged: T[] }> {
  if (points.length <= maxBuckets) return points.map(point => ({ start: point, merged: [point] }));
  const size = Math.ceil(points.length / maxBuckets);
  const buckets: Array<{ start: T; merged: T[] }> = [];
  for (let i = 0; i < points.length; i += size) {
    buckets.push({ start: points[i], merged: points.slice(i, i + size) });
  }
  return buckets;
}

function formatMinutes(total: number): string {
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

/**
 * Vista de Análisis: agregaciones puras sobre los datos reales del usuario.
 *
 * No hay métricas psicológicas ni puntuaciones inventadas: cada número es un
 * hecho medible (minutos, días, sesiones, tarjetas, preguntas, aciertos,
 * progreso de curso/libro/prácticas). Cuando un cociente no existe (cero
 * preguntas, cero lecciones), se muestra «—» con su explicación.
 */
export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ courses, books, practiceWork }) => {
  const { day: localDay } = resolveLocalDay();
  const [range, setRange] = useState<AnalyticsRange>('30d');
  const [metric, setMetric] = useState<ChartMetric>('minutes');
  const [data, setData] = useState<LoadedData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [sessions, streak] = await Promise.all([
          dao.getSessionsForAnalytics(),
          dao.getActiveStreak()
        ]);
        if (cancelled) return;
        setData({ sessions, streakDays: streak });
        setLoadError(null);
      } catch {
        if (!cancelled) {
          setData({ sessions: [], streakDays: 0 });
          setLoadError('No se pudo leer el historial de estudio local.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const overview = useMemo(() => {
    if (!data) return null;
    return computeAnalyticsOverview(data.sessions, range, localDay, data.streakDays);
  }, [data, range, localDay]);

  const comparison = useMemo(() => {
    if (!data) return null;
    return computeRangeComparison(data.sessions, range, localDay);
  }, [data, range, localDay]);

  const series = useMemo(
    () => (data ? buildDailySeries(data.sessions, range, localDay) : []),
    [data, range, localDay]
  );

  const resourceRows = useMemo(
    () => (data ? computeResourceActivity(data.sessions, range, localDay) : []),
    [data, range, localDay]
  );

  const recent = useMemo(
    () => (data ? recentActivity(data.sessions, 10) : []),
    [data]
  );

  const content = useMemo(() => computeContentProgress(courses, books, practiceWork), [courses, books, practiceWork]);

  const chartPoints = useMemo(() => {
    const buckets = bucketSeries(series, 60);
    return buckets.map(bucket => ({
      date: bucket.start.date,
      label: bucket.start.label,
      minutes: bucket.merged.reduce((sum, point) => sum + point.minutes, 0),
      reviews: bucket.merged.reduce((sum, point) => sum + point.reviews, 0),
      days: bucket.merged.length
    }));
  }, [series]);

  const chartMax = Math.max(1, ...chartPoints.map(point => (metric === 'minutes' ? point.minutes : point.reviews)));
  const chartTotal = chartPoints.reduce((sum, point) => sum + (metric === 'minutes' ? point.minutes : point.reviews), 0);
  const labelStep = Math.max(1, Math.ceil(chartPoints.length / 7));

  if (!data) {
    return (
      <div className="space-y-4 animate-fade-in" role="status" aria-live="polite">
        <h1 className="type-display text-ink">Análisis</h1>
        <p className="type-secondary">Calculando tu historial de estudio…</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Análisis</h1>
          <p className="type-secondary mt-1">
            Qué ha ocurrido realmente en tu estudio. Solo datos medidos, sin puntuaciones inventadas.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Rango de tiempo">
          {ANALYTICS_RANGES.map(option => (
            <Button
              key={option}
              size="sm"
              variant={range === option ? 'solid' : 'outline'}
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {ANALYTICS_RANGE_LABELS[option]}
            </Button>
          ))}
        </div>
      </header>

      {loadError && (
        <p role="alert" className="text-meta text-error">{loadError}</p>
      )}

      {!overview || (overview.sessionsCompleted === 0 && range !== 'all') ? (
        overview && overview.sessionsCompleted === 0 && (
          <EmptyState
            icon={<BarChart3 size={30} aria-hidden="true" />}
            title="Sin actividad en este rango"
            hint={`No hay sesiones de estudio registradas en los últimos ${ANALYTICS_RANGE_LABELS[range].toLowerCase()}. Cambia de rango o registra una sesión para ver tu análisis.`}
          />
        )
      ) : null}

      {overview && (
        <>
          {/* --- Cifras clave: una superficie, sin tarjetas de métricas. --- */}
          <section aria-label="Resumen del periodo" className="grid grid-cols-2 divide-line rounded-xl border border-line bg-surface shadow-card md:grid-cols-4 md:divide-x">
            <div className="px-4 py-3.5">
              <p className="type-micro flex items-center gap-1.5"><Clock size={12} aria-hidden="true" /> Tiempo de estudio</p>
              <p className="mt-1 text-xl font-semibold text-ink">{formatMinutes(overview.studyMinutes)}</p>
              <p className="text-micro text-faint">
                {comparison?.deltaMinutes !== null && comparison?.deltaMinutes !== undefined
                  ? comparison.deltaMinutes >= 0
                    ? `${comparison.deltaMinutes} min más que el periodo anterior`
                    : `${Math.abs(comparison.deltaMinutes)} min menos que el periodo anterior`
                  : 'Sin periodo anterior comparable'}
              </p>
            </div>
            <div className="border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><CalendarDays size={12} aria-hidden="true" /> Días activos</p>
              <p className="mt-1 text-xl font-semibold text-ink">{overview.activeDays}</p>
              <p className="text-micro text-faint">
                {overview.daysInRange ? `de ${overview.daysInRange} días del rango` : 'de todo el historial'}
              </p>
            </div>
            <div className="border-t border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><ListChecks size={12} aria-hidden="true" /> Sesiones completadas</p>
              <p className="mt-1 text-xl font-semibold text-ink">{overview.sessionsCompleted}</p>
              <p className="text-micro text-faint">{formatMinutes(overview.avgMinutesPerActiveDay)} por día activo</p>
            </div>
            <div className="border-t border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><Flame size={12} aria-hidden="true" /> Racha actual</p>
              <p className="mt-1 text-xl font-semibold text-ink">{overview.streakDays} días</p>
              <p className="text-micro text-faint">días consecutivos con estudio</p>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Brain size={12} aria-hidden="true" /> Tarjetas repasadas</p>
              <p className="mt-1 text-xl font-semibold text-ink">{overview.flashcardsReviewed}</p>
              <p className="text-micro text-faint">repasos SM-2 en el rango</p>
            </Panel>
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><ClipboardCheck size={12} aria-hidden="true" /> Preguntas contestadas</p>
              <p className="mt-1 text-xl font-semibold text-ink">{overview.questionsAnswered}</p>
              <p className="text-micro text-faint">{overview.correctAnswers} correctas</p>
            </Panel>
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Target size={12} aria-hidden="true" /> Precisión</p>
              <p className="mt-1 text-xl font-semibold text-ink">
                {overview.accuracyPercent === null ? '—' : `${overview.accuracyPercent}%`}
              </p>
              <p className="text-micro text-faint">
                {overview.accuracyPercent === null
                  ? 'sin preguntas en este rango'
                  : `${overview.correctAnswers} de ${overview.questionsAnswered} correctas`}
              </p>
            </Panel>
          </div>

          {/* --- Serie diaria con resumen textual accesible. --- */}
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="type-section text-ink">Evolución diaria</h2>
                <p className="type-meta mt-0.5">
                  {metric === 'minutes' ? 'Minutos de estudio por día.' : 'Ítems repasados por día (tarjetas + preguntas).'}
                  {' '}Total del rango: <strong className="text-ink">{metric === 'minutes' ? formatMinutes(chartTotal) : chartTotal}</strong>.
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label="Métrica a visualizar">
                <button
                  type="button"
                  onClick={() => setMetric('minutes')}
                  aria-pressed={metric === 'minutes'}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-meta font-medium transition',
                    metric === 'minutes' ? 'bg-accent-soft text-ink shadow-card' : 'text-muted hover:text-ink'
                  )}
                >
                  Minutos
                </button>
                <button
                  type="button"
                  onClick={() => setMetric('reviews')}
                  aria-pressed={metric === 'reviews'}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-meta font-medium transition',
                    metric === 'reviews' ? 'bg-accent-soft text-ink shadow-card' : 'text-muted hover:text-ink'
                  )}
                >
                  Ítems
                </button>
              </div>
            </div>

            {chartPoints.length === 0 || chartTotal === 0 ? (
              <p className="mt-4 type-meta text-muted">Sin datos de actividad en este rango.</p>
            ) : (
              <>
                <div className="mt-4 flex h-40 items-end gap-[3px]" aria-hidden="true">
                  {chartPoints.map((point, index) => {
                    const value = metric === 'minutes' ? point.minutes : point.reviews;
                    const height = value === 0 ? 2 : Math.max(6, Math.round((value / chartMax) * 100));
                    return (
                      <div
                        key={`${point.date}-${index}`}
                        className={cn(
                          'min-w-[3px] flex-1 rounded-t',
                          value === 0 ? 'bg-line' : 'bg-accent'
                        )}
                        style={{ height: `${height}%` }}
                        title={`${point.label}: ${metric === 'minutes' ? `${value} min` : `${value} ítems`}`}
                      />
                    );
                  })}
                </div>
                <div className="mt-1.5 flex justify-between text-micro text-faint" aria-hidden="true">
                  {chartPoints.map((point, index) =>
                    index % labelStep === 0 ? (
                      <span key={`label-${point.date}-${index}`}>{point.label}</span>
                    ) : null
                  )}
                </div>

                {/* Resumen textual accesible: la misma información en tabla. */}
                <details className="mt-3">
                  <summary className="cursor-pointer text-meta text-muted focus-visible:underline">
                    Ver los datos del gráfico en tabla
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-meta">
                      <caption className="sr-only">
                        Actividad diaria del rango {ANALYTICS_RANGE_LABELS[range]}
                        {chartPoints.some(point => point.days > 1) ? ' (días agrupados por límite de pantalla)' : ''}
                      </caption>
                      <thead className="text-micro text-muted">
                        <tr>
                          <th scope="col" className="py-1 pr-3 font-semibold">Fecha</th>
                          <th scope="col" className="py-1 pr-3 font-semibold">Minutos</th>
                          <th scope="col" className="py-1 font-semibold">Ítems</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartPoints.map((point, index) => (
                          <tr key={`row-${point.date}-${index}`} className="border-t border-line">
                            <th scope="row" className="py-1 pr-3 font-normal text-ink">
                              {point.label}
                              {point.days > 1 ? ` (${point.days} días)` : ''}
                            </th>
                            <td className="py-1 pr-3 text-muted">{point.minutes}</td>
                            <td className="py-1 text-muted">{point.reviews}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </Panel>

          {/* --- Progreso de contenido: unidades separadas, nunca mezcladas. --- */}
          <section aria-label="Progreso de contenido" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Activity size={12} aria-hidden="true" /> Cursos</p>
              {content.courses.lessonPercent === null ? (
                <p className="mt-2 type-meta text-muted">Ningún curso tiene lecciones registradas todavía.</p>
              ) : (
                <>
                  <p className="mt-1 text-xl font-semibold text-ink">{content.courses.lessonPercent}%</p>
                  <div
                    role="progressbar"
                    aria-valuenow={content.courses.lessonPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Lecciones completadas sobre totales en todos tus cursos"
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${content.courses.lessonPercent}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-faint">
                    {content.courses.lessonsCompleted} de {content.courses.lessonsTotal} lecciones ·{' '}
                    {content.courses.completed} de {content.courses.total} cursos completados
                  </p>
                </>
              )}
            </Panel>

            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><BookOpen size={12} aria-hidden="true" /> Libros</p>
              {content.books.pagePercent === null ? (
                <p className="mt-2 type-meta text-muted">Ningún libro tiene número de páginas registrado.</p>
              ) : (
                <>
                  <p className="mt-1 text-xl font-semibold text-ink">{content.books.pagePercent}%</p>
                  <div
                    role="progressbar"
                    aria-valuenow={content.books.pagePercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Páginas leídas sobre totales en todos tus libros"
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${content.books.pagePercent}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-faint">
                    {content.books.pagesRead} de {content.books.pagesTotal} páginas · {content.books.finished} terminados
                  </p>
                </>
              )}
            </Panel>

            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><ClipboardCheck size={12} aria-hidden="true" /> Trabajo práctico</p>
              <p className="mt-1 text-xl font-semibold text-ink">{content.practice.completionPercent}%</p>
              <div
                role="progressbar"
                aria-valuenow={content.practice.completionPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Trabajos prácticos terminados sobre los registrados"
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${content.practice.completionPercent}%` }} />
              </div>
              <p className="mt-1.5 text-micro text-faint">
                {content.practice.done} de {content.practice.total} terminados · {content.practice.inProgress} en marcha
              </p>
            </Panel>
          </section>

          {/* --- Actividad por recurso. --- */}
          <Panel className="p-5 sm:p-6">
            <h2 className="type-section text-ink">Actividad por recurso</h2>
            <p className="type-meta mt-0.5">Dónde se ha concentrado tu estudio en el rango seleccionado.</p>
            {resourceRows.length === 0 ? (
              <p className="mt-3 type-meta text-muted">Sin actividad registrada en este rango.</p>
            ) : (
              <ul className="mt-3 space-y-2.5">
                {resourceRows.slice(0, 10).map((row, index) => {
                  const maxMinutes = Math.max(1, resourceRows[0].minutes);
                  const width = Math.max(2, Math.round((row.minutes / maxMinutes) * 100));
                  return (
                    <li key={`${row.resourceId ?? 'general'}-${index}`}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-item font-medium text-ink" title={row.label}>
                          {row.label}
                        </span>
                        <span className="shrink-0 text-meta text-muted">
                          {formatMinutes(row.minutes)} · {row.reviews} ítems · {row.sessions} sesiones
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {/* --- Actividad reciente. --- */}
          <Panel className="p-5 sm:p-6">
            <h2 className="type-section text-ink">Actividad reciente</h2>
            <p className="type-meta mt-0.5">Las últimas sesiones completadas, tal como se registraron.</p>
            {recent.length === 0 ? (
              <p className="mt-3 type-meta text-muted">Todavía no hay sesiones completadas.</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {recent.map(({ session, day }) => (
                  <li key={session.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-item font-medium text-ink">
                        {session.resource_title || session.lesson_title || 'Estudio general'}
                      </span>
                      <span className="text-micro text-faint">
                        {session.lesson_title && session.resource_title ? `${session.resource_title} · ` : ''}
                        {day ?? 'fecha no legible'} · {formatMinutes(session.duration_minutes)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {session.cards_reviewed > 0 && <Badge tone="accent">{session.cards_reviewed} tarjetas</Badge>}
                      {session.questions_answered > 0 && (
                        <Badge tone="neutral">
                          {session.correct_answers}/{session.questions_answered} correctas
                        </Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};
