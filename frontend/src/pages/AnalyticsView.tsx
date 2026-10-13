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
  analyticsRangeLabel,
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
import { useLanguage } from '../hooks/useLanguage.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';













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

function formatMinutes(total: number, lang: LanguageCode = 'es'): string {
  if (total < 60) return translateKey(lang, 'analytics.minUnit', { n: total });
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes > 0
    ? translateKey(lang, 'analytics.hourMin', { h: hours, m: minutes })
    : translateKey(lang, 'analytics.hourOnly', { h: hours });
}

/**
 * Vista de Análisis: agregaciones puras sobre los datos reales del usuario.
 *
 * No hay métricas psicológicas ni puntuaciones inventadas: cada número es un
 * hecho medible (minutos, días, sesiones, tarjetas, preguntas, aciertos,
 * progreso de curso/libro/prácticas). Cuando un cociente no existe (cero
 * preguntas, cero lecciones), se muestra «-» con su explicación.
 */
export const AnalyticsView: React.FC<AnalyticsViewProps> = ({ courses, books, practiceWork }) => {
  const { day: localDay } = resolveLocalDay();
  const { t, effective } = useLanguage();




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
          setLoadError(t('analytics.loadFail'));
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
    () => (data ? buildDailySeries(data.sessions, range, localDay, undefined, effective) : []),
    [data, range, localDay, effective]
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
        <h1 className="type-display text-ink">{t('analytics.title')}</h1>
        <p className="type-secondary">{t('analytics.loadingSub')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">{t('analytics.title')}</h1>
          <p className="type-secondary mt-1">
            {t('analytics.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('analytics.rangeLabel')}>
          {ANALYTICS_RANGES.map(option => (
            <Button
              key={option}
              size="sm"
              variant={range === option ? 'solid' : 'outline'}
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {analyticsRangeLabel(option, effective)}
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
            title={t('analytics.emptyTitle')}
            hint={t('analytics.emptyHint', { range: analyticsRangeLabel(range, effective).toLowerCase() })}
          />
        )
      ) : null}

      {overview && (
        <>
          {/* --- Cifras clave: una superficie, sin tarjetas de métricas. --- */}
          <section aria-label={t('analytics.periodLabel')} className="grid grid-cols-2 divide-line rounded-xl border border-line bg-surface shadow-card md:grid-cols-4 md:divide-x">
            <div className="px-4 py-3.5">
              <p className="type-micro flex items-center gap-1.5"><Clock size={12} aria-hidden="true" /> {t('analytics.studyTime')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{formatMinutes(overview.studyMinutes, effective)}</p>
              <p className="text-micro text-faint">
                {comparison?.deltaMinutes !== null && comparison?.deltaMinutes !== undefined
                  ? comparison.deltaMinutes >= 0
                    ? t('analytics.deltaUp', { n: comparison.deltaMinutes })
                    : t('analytics.deltaDown', { n: Math.abs(comparison.deltaMinutes) })
                  : t('analytics.noCompare')}
              </p>
            </div>
            <div className="border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><CalendarDays size={12} aria-hidden="true" /> {t('analytics.activeDays')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{overview.activeDays}</p>
              <p className="text-micro text-faint">
                {overview.daysInRange ? t('analytics.ofRange', { n: overview.daysInRange }) : t('analytics.ofHistory')}
              </p>
            </div>
            <div className="border-t border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><ListChecks size={12} aria-hidden="true" /> {t('analytics.sessionsDone')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{overview.sessionsCompleted}</p>
              <p className="text-micro text-faint">{t('analytics.perActiveDay', { t: formatMinutes(overview.avgMinutesPerActiveDay, effective) })}</p>
            </div>
            <div className="border-t border-line px-4 py-3.5 md:border-0">
              <p className="type-micro flex items-center gap-1.5"><Flame size={12} aria-hidden="true" /> {t('analytics.streak')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{t('analytics.streakDays', { n: overview.streakDays })}</p>
              <p className="text-micro text-faint">{t('analytics.streakHint')}</p>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Brain size={12} aria-hidden="true" /> {t('analytics.cards')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{overview.flashcardsReviewed}</p>
              <p className="text-micro text-faint">{t('analytics.cardsHint')}</p>
            </Panel>
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><ClipboardCheck size={12} aria-hidden="true" /> {t('analytics.questions')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">{overview.questionsAnswered}</p>
              <p className="text-micro text-faint">{t('analytics.correctN', { n: overview.correctAnswers })}</p>
            </Panel>
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Target size={12} aria-hidden="true" /> {t('analytics.accuracy')}</p>
              <p className="mt-1 text-xl font-mono font-semibold text-ink">
                {overview.accuracyPercent === null ? '-' : `${overview.accuracyPercent}%`}
              </p>
              <p className="text-micro text-faint">
                {overview.accuracyPercent === null
                  ? t('analytics.noQuestions')
                  : t('analytics.scoreOf', { ok: overview.correctAnswers, total: overview.questionsAnswered })}
              </p>
            </Panel>
          </div>

          {/* --- Serie diaria con resumen textual accesible. --- */}
          <Panel className="p-5 sm:p-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="type-section text-ink">{t('analytics.dailyTitle')}</h2>
                <p className="type-meta mt-0.5">
                  {metric === 'minutes' ? t('analytics.minutesDesc') : t('analytics.reviewsDesc')}
                  {' '}{t('analytics.rangeTotal', { v: metric === 'minutes' ? formatMinutes(chartTotal, effective) : chartTotal })}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-0.5" role="group" aria-label={t('analytics.metricLabel')}>
                <button
                  type="button"
                  onClick={() => setMetric('minutes')}
                  aria-pressed={metric === 'minutes'}
                  className={cn(
                    'rounded-md px-3 py-1.5 text-meta font-medium transition',
                    metric === 'minutes' ? 'bg-accent-soft text-ink shadow-card' : 'text-muted hover:text-ink'
                  )}
                >
                  {t('analytics.minutesBtn')}
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
                  {t('analytics.itemsBtn')}
                </button>
              </div>
            </div>

            {chartPoints.length === 0 || chartTotal === 0 ? (
              <p className="mt-4 type-meta text-muted">{t('analytics.noData')}</p>
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
                        title={metric === 'minutes' ? t('analytics.barMin', { label: point.label, v: value }) : t('analytics.barItems', { label: point.label, v: value })}
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
                    {t('analytics.tableToggle')}
                  </summary>
                  <div className="mt-2 max-h-64 overflow-y-auto">
                    <table className="w-full text-left text-meta">
                      <caption className="sr-only">
                                              {t('analytics.tableCap', { range: analyticsRangeLabel(range, effective), grouped: chartPoints.some(point => point.days > 1) ? t('analytics.tableGrouped') : '' })}
                      </caption>
                      <thead className="text-micro text-muted">
                        <tr>
                          <th scope="col" className="py-1 pr-3 font-semibold">{t('analytics.thDate')}</th>
                          <th scope="col" className="py-1 pr-3 font-semibold">{t('analytics.thMin')}</th>
                          <th scope="col" className="py-1 font-semibold">{t('analytics.thItems')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {chartPoints.map((point, index) => (
                          <tr key={`row-${point.date}-${index}`} className="border-t border-line">
                            <th scope="row" className="py-1 pr-3 font-normal text-ink">
                              {point.label}
                              {point.days > 1 ? t('analytics.daysN', { n: point.days }) : ''}
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
          <section aria-label={t('analytics.contentLabel')} className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><Activity size={12} aria-hidden="true" /> {t('analytics.courses')}</p>
              {content.courses.lessonPercent === null ? (
                <p className="mt-2 type-meta text-muted">{t('analytics.noLessons')}</p>
              ) : (
                <>
                  <p className="mt-1 text-xl font-semibold text-ink">{content.courses.lessonPercent}%</p>
                  <div
                    role="progressbar"
                    aria-valuenow={content.courses.lessonPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('analytics.lessonsBar')}
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${content.courses.lessonPercent}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-faint">
                    {t('analytics.lessonsOf', { done: content.courses.lessonsCompleted, total: content.courses.lessonsTotal, c: content.courses.completed, t: content.courses.total })}
                  </p>
                </>
              )}
            </Panel>

            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><BookOpen size={12} aria-hidden="true" /> {t('analytics.books')}</p>
              {content.books.pagePercent === null ? (
                <p className="mt-2 type-meta text-muted">{t('analytics.noPages')}</p>
              ) : (
                <>
                  <p className="mt-1 text-xl font-semibold text-ink">{content.books.pagePercent}%</p>
                  <div
                    role="progressbar"
                    aria-valuenow={content.books.pagePercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={t('analytics.booksBar')}
                    className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
                  >
                    <div className="h-full rounded-full bg-accent" style={{ width: `${content.books.pagePercent}%` }} />
                  </div>
                  <p className="mt-1.5 text-micro text-faint">
                    {t('analytics.booksOf', { read: content.books.pagesRead, total: content.books.pagesTotal, done: content.books.finished })}
                  </p>
                </>
              )}
            </Panel>

            <Panel className="p-4">
              <p className="type-micro flex items-center gap-1.5"><ClipboardCheck size={12} aria-hidden="true" /> {t('analytics.practice')}</p>
              <p className="mt-1 text-xl font-semibold text-ink">{content.practice.completionPercent}%</p>
              <div
                role="progressbar"
                aria-valuenow={content.practice.completionPercent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t('analytics.practiceBar')}
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line"
              >
                <div className="h-full rounded-full bg-accent" style={{ width: `${content.practice.completionPercent}%` }} />
              </div>
              <p className="mt-1.5 text-micro text-faint">
                {t('analytics.practiceOf', { done: content.practice.done, total: content.practice.total, n: content.practice.inProgress })}
              </p>
            </Panel>
          </section>

          {/* --- Actividad por recurso. --- */}
          <Panel className="p-5 sm:p-6">
            <h2 className="type-section text-ink">{t('analytics.byResource')}</h2>
            <p className="type-meta mt-0.5">{t('analytics.byResourceSub')}</p>
            {resourceRows.length === 0 ? (
              <p className="mt-3 type-meta text-muted">{t('analytics.noActivity')}</p>
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
                          {t('analytics.rowMeta', { t: formatMinutes(row.minutes, effective), r: row.reviews, s: row.sessions })}
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
            <h2 className="type-section text-ink">{t('analytics.recent')}</h2>
            <p className="type-meta mt-0.5">{t('analytics.recentSub')}</p>
            {recent.length === 0 ? (
              <p className="mt-3 type-meta text-muted">{t('analytics.noSessions')}</p>
            ) : (
              <ul className="mt-3 divide-y divide-line">
                {recent.map(({ session, day }) => (
                  <li key={session.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-item font-medium text-ink">
                        {session.resource_title || session.lesson_title || t('analytics.general')}
                      </span>
                      <span className="text-micro text-faint">
                        {session.lesson_title && session.resource_title ? `${session.resource_title} · ` : ''}
                        {day ?? t('analytics.badDate')} · {formatMinutes(session.duration_minutes, effective)}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      {session.cards_reviewed > 0 && <Badge tone="accent">{t('analytics.cardsN', { n: session.cards_reviewed })}</Badge>}
                      {session.questions_answered > 0 && (
                        <Badge tone="neutral">
                          {t('analytics.correctPair', { ok: session.correct_answers, total: session.questions_answered })}
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
