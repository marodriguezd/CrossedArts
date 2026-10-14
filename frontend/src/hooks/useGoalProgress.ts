import { useEffect, useMemo, useState } from 'react';
import { dao } from '../db/dao.ts';
import {
  buildGoalContextBooks,
  buildGoalContextCourses,
  computeGoalProgress,
  type GoalProgress
} from '../services/goals.ts';
import type { Book, Course, LearningGoal, PracticeWork } from '../types/models.ts';
import type { LanguageCode } from '../i18n/languages.ts';

/**
 * Derives each goal's progress in memory.
 *
 * Only the TIME goal needs a query (minutes logged since its creation); the
 * rest of the progress is computed purely from data the app already holds.
 * The result is memoized to avoid recomputing on every render.
 */
export function useGoalProgress(
  goals: readonly LearningGoal[],
  courses: readonly Course[],
  books: readonly Book[],
  practiceWork: readonly PracticeWork[],
  lang: LanguageCode = 'es'
): Map<string, GoalProgress> {
  const [studyMinutes, setStudyMinutes] = useState<Map<string, number>>(new Map());

  // Identity of the query-backed goals: when it changes, the effect refetches.
  const studyGoalKey = useMemo(
    () => goals.filter(goal => goal.kind === 'study_time').map(goal => `${goal.id}:${goal.created_at ?? ''}`).join('|'),
    [goals]
  );

  useEffect(() => {
    let cancelled = false;
    const studyGoals = goals.filter(goal => goal.kind === 'study_time');
    if (studyGoals.length === 0) {
      setStudyMinutes(new Map());
      return;
    }
    Promise.all(
      studyGoals.map(async goal => [goal.id, await dao.getStudyMinutesSince(goal.created_at)] as const)
    )
      .then(pairs => {
        if (!cancelled) setStudyMinutes(new Map(pairs));
      })
      .catch(() => {
        // No measure is never invented: the goal stays unmeasurable with its own basis.
        if (!cancelled) setStudyMinutes(new Map());
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyGoalKey]);

  return useMemo(() => {
    const context = {
      courses: buildGoalContextCourses(courses),
      books: buildGoalContextBooks(books),
      practice: practiceWork,
      studyMinutesByGoal: studyMinutes
    };
    const map = new Map<string, GoalProgress>();
    for (const goal of goals) {
      map.set(goal.id, computeGoalProgress(goal, context, lang));
    }
    return map;
  }, [goals, courses, books, practiceWork, studyMinutes]);
}
