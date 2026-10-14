import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CalendarCheck,
  CircleCheck,
  Compass,
  Flame,
  History,
  ListTodo,
  Sparkles
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { resolveLocalDay } from '../services/localDate.ts';
import {
  buildFocusPlan,
  buildFocusSummary,
  deriveRecentResources,
  type FocusItem
} from '../services/focus.ts';
import { useLanguage } from '../hooks/useLanguage.ts';
import { goalDeadlineLabel } from '../services/goals.ts';
import { useGoalProgress } from '../hooks/useGoalProgress.ts';
import type {
  Book,
  Course,
  KPIMetrics,
  LearningGoal,
  LearningSession,
  PracticeWork,
  ResourceDestination
} from '../types/models.ts';
import { Badge, Button, EmptyState, Panel, cn } from '../components/ui/index.tsx';

interface FocusTodayProps {
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  practiceWork: PracticeWork[];
  goals: LearningGoal[];
  recentSessions: LearningSession[];
  /** Navigates to a top-level tab (review, library, goals). */
  onNavigate: (tab: string) => void;
  /** Opens an entity destination by reusing the existing navigation. */
  onOpenDestination: (destination: ResourceDestination) => void;
}

const KIND_ICONS: Partial<Record<FocusItem['kind'], React.ComponentType<any>>> = {
  reviews: Sparkles,
  practice: ListTodo,
  continue_lesson: Compass,
  start_course: Compass,
  goal_overdue: CalendarCheck,
  goal_due_soon: CalendarCheck,
  goal_ready: CircleCheck,
  book: History
};

function formatLocalDate(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(parsed);
}

/**
 * "Today" view: answers "what do I do now?" with real data.
 *
 * Recommendations come from `buildFocusPlan` (pure and deterministic). This view
 * only loads the needed data, sorts it, and offers the action; it never invents
 * suggestions or metrics.
 */
export const FocusToday: React.FC<FocusTodayProps> = ({
  kpis,
  courses,
  books,
  practiceWork,
  goals,
  recentSessions,
  onNavigate,
  onOpenDestination
}) => {
  const { t, effective } = useLanguage();
  const { day: localDay } = resolveLocalDay();
  const progressByGoal = useGoalProgress(goals, courses, books, practiceWork, effective);

  interface ContinueTarget {
    courseId: string;
    lessonId: string | null;
    courseTitle: string;
    lessonTitle: string | null;
    moduleTitle: string | null;
  }
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);
  const [minutesToday, setMinutesToday] = useState(0);

  // Resume target: first incomplete course with its real next lesson.
  useEffect(() => {
    let cancelled = false;
    const target =
      courses.find(course => course.status === 'IN_PROGRESS' && (course.completed_lessons ?? 0) < (course.total_lessons ?? 0)) ||
      courses.find(course => course.status !== 'COMPLETED' && (course.total_lessons ?? 0) > 0);
    if (!target) {
      setContinueTarget(null);
      return;
    }
    dao
      .getNextLessonForCourse(target.id)
      .then(result => {
        if (cancelled) return;
        setContinueTarget({
          courseId: target.id,
          lessonId: result?.lesson?.id ?? null,
          courseTitle: target.title,
          lessonTitle: result?.lesson?.title ?? null,
          moduleTitle: result?.moduleTitle ?? null
        });
      })
      .catch(() => {
        if (!cancelled) {
          setContinueTarget({ courseId: target.id, lessonId: null, courseTitle: target.title, lessonTitle: null, moduleTitle: null });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [courses]);

  // Today's minutes come from the already aggregated daily series: no extra query.
  useEffect(() => {
    let cancelled = false;
    dao
      .getDailyActivitySeries('7d')
      .then(points => {
        if (cancelled) return;
        const todayPoint = points.find(point => point.date === localDay);
        setMinutesToday(todayPoint?.minutes ?? 0);
      })
      .catch(() => {
        if (!cancelled) setMinutesToday(0);
      });
    return () => {
      cancelled = true;
    };
  }, [localDay, kpis]);

  const plan = useMemo(
    () =>
      buildFocusPlan({
        today: kpis?.today ?? { items_reviewed: 0, flashcards_reviewed: 0, questions_answered: 0, correct_answers: 0 },
        localDay,
        minutesToday,
        streakDays: kpis?.active_streak_days ?? 0,
        pendingReviews: kpis?.pending_reviews ?? 0,
        continueTarget,
        courses,
        books,
        practiceWork,
        goals,
        goalProgress: progressByGoal,
        recentSessions
      }, effective),
    [kpis, localDay, minutesToday, continueTarget, courses, books, practiceWork, goals, progressByGoal, recentSessions, effective]
  );

  const summary = useMemo(
    () =>
      buildFocusSummary({
        today: kpis?.today ?? { items_reviewed: 0, flashcards_reviewed: 0, questions_answered: 0, correct_answers: 0 },
        localDay,
        minutesToday,
        streakDays: kpis?.active_streak_days ?? 0,
        pendingReviews: kpis?.pending_reviews ?? 0,
        continueTarget,
        courses,
        books,
        practiceWork,
        goals,
        goalProgress: progressByGoal,
        recentSessions
      }),
    [kpis, localDay, minutesToday, continueTarget, courses, books, practiceWork, goals, progressByGoal, recentSessions]
  );

  const recentResources = useMemo(() => deriveRecentResources(recentSessions, 5), [recentSessions]);

  const activateItem = (item: FocusItem) => {
    if (item.tab) {
      onNavigate(item.tab);
      return;
    }
    if (item.destination) onOpenDestination(item.destination);
  };

  const openRecent = (entry: (typeof recentResources)[number]) => {
    if (entry.resourceId) {
      onOpenDestination({ tab: 'resource', resourceId: entry.resourceId });
      return;
    }
    if (entry.lessonId) {
      onOpenDestination({ tab: 'course', resourceId: entry.lessonId, lessonId: entry.lessonId });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <header>
        <h1 className="type-display text-ink">{t('focus.title')}</h1>
        <p className="type-secondary mt-1 capitalize">{t('focus.subtitle', { date: formatLocalDate(localDay) })}</p>
      </header>

      {/* Day summary: measured facts only. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Panel className="p-4">
          <p className="type-micro">{t('focus.todayStudy')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{minutesToday} min</p>
          <p className="text-micro text-faint"><span className="font-mono">{summary.reviewsToday}</span> {t('dashboard.itemsReviewed')}</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">{t('focus.streak')}</p>
          <p className="mt-1 flex items-center gap-1.5 text-xl font-mono font-semibold text-ink">
            <Flame size={16} className="text-warning" aria-hidden="true" />
            {t('dashboard.streakDays', { n: summary.streakDays })}
          </p>
          <p className="text-micro text-faint">{t('focus.streakHint')}</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">{t('focus.pending')}</p>
          <p className="mt-1 text-xl font-mono font-semibold text-ink">{summary.pendingReviews}</p>
          <p className="text-micro text-faint">{t('focus.overdueCards')}</p>
        </Panel>
        <Panel className="p-4">
          <p className="type-micro">{t('focus.nextGoal')}</p>
          {summary.nextGoal ? (
            <>
              <p className="mt-1 truncate text-item font-semibold text-ink" title={summary.nextGoal.title}>
                {summary.nextGoal.title}
              </p>
              <p className="text-micro text-faint">
                {summary.nextGoalDeadline ? goalDeadlineLabel(summary.nextGoalDeadline, effective) : ''}
                {summary.nextGoalProgress?.measurable ? ` · ${summary.nextGoalProgress.percent}%` : ''}
              </p>
            </>
          ) : (
            <p className="mt-1 text-item text-muted">{t('focus.noGoals')}</p>
          )}
        </Panel>
      </div>

      {/* Action plan: prioritized, explainable order. */}
      <Panel className="p-5 sm:p-6">
        <div className="mb-4 flex items-center gap-2 border-b border-line pb-3">
          <ListTodo size={16} className="text-accent" aria-hidden="true" />
          <div>
            <h2 className="type-section text-ink">{t('focus.planTitle')}</h2>
            <p className="type-meta mt-0.5">{t('focus.planDesc')}</p>
          </div>
        </div>

        {plan.length === 0 ? (
          <EmptyState
            icon={<CircleCheck size={30} aria-hidden="true" />}
            title={t('focus.emptyTitle')}
            hint={t('focus.emptyHint')}
            action={
              <Button variant="outline" onClick={() => onNavigate('library')}>
                {t('focus.exploreLibrary')} <ArrowRight size={14} aria-hidden="true" />
              </Button>
            }
          />
        ) : (
          <ol className="space-y-3">
            {plan.map((item, index) => {
              const Icon = KIND_ICONS[item.kind] ?? Sparkles;
              return (
                <li
                  key={item.id}
                  className="flex flex-col gap-3 rounded-lg border border-line bg-canvas p-3.5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent"
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-micro font-semibold text-faint" aria-hidden="true">
                          {index + 1}.
                        </span>
                        <p className="break-words text-item font-semibold text-ink">{item.title}</p>
                        {item.badge && <Badge tone="accent">{item.badge}</Badge>}
                      </div>
                      <p className="type-meta mt-0.5 break-words text-muted">{item.reason}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={index === 0 ? 'solid' : 'outline'}
                    className="shrink-0 self-start sm:self-auto"
                    onClick={() => activateItem(item)}
                  >
                    {item.actionLabel} <ArrowRight size={13} aria-hidden="true" />
                  </Button>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>

      {/* Recently studied resources: shortcuts back to what was already in progress. */}
      <Panel className="p-5 sm:p-6">
        <div className="mb-3 flex items-center gap-2 border-b border-line pb-3">
          <History size={16} className="text-accent" aria-hidden="true" />
          <div>
            <h2 className="type-section text-ink">{t('focus.recentTitle')}</h2>
            <p className="type-meta mt-0.5">{t('focus.recentDesc')}</p>
          </div>
        </div>
        {recentResources.length === 0 ? (
          <p className={cn('type-meta text-muted')}>
            {t('focus.noRecent')}
          </p>
        ) : (
          <ul className="space-y-2">
            {recentResources.map(entry => (
              <li key={`${entry.resourceId ?? entry.lessonId}`}>
                <button
                  type="button"
                  onClick={() => openRecent(entry)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-line bg-canvas px-3 py-2.5 text-left transition hover:border-accent/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-item font-medium text-ink">{entry.label}</span>
                    <span className="text-micro text-faint">
                      {entry.lastDay ? t('focus.lastSession', { day: entry.lastDay }) : t('focus.noDate')} · {t('focus.minTotal', { n: entry.minutes })}
                    </span>
                  </span>
                  <ArrowRight size={14} className="shrink-0 text-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => onNavigate('goals')}>
          {t('focus.viewGoals')} <ArrowRight size={14} aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('analytics')}>
          {t('focus.viewAnalytics')} <ArrowRight size={14} aria-hidden="true" />
        </Button>
        <Button variant="outline" onClick={() => onNavigate('review')}>
          {t('focus.goReviewBtn')} <ArrowRight size={14} aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
};
