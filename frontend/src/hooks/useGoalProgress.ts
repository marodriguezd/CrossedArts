import { useEffect, useMemo, useState } from 'react';
import { dao } from '../db/dao.ts';
import {
  buildGoalContextBooks,
  buildGoalContextCourses,
  computeGoalProgress,
  type GoalProgress
} from '../services/goals.ts';
import type { Book, Course, LearningGoal, PracticeWork } from '../types/models.ts';

/**
 * Deriva el progreso de cada meta en memoria.
 *
 * Solo la meta de TIEMPO necesita una consulta (minutos registrados desde su
 * creación); el resto del progreso se calcula de forma pura a partir de los
 * datos que la aplicación ya tiene cargados. El resultado se memoriza para no
 * recalcular en cada render.
 */
export function useGoalProgress(
  goals: readonly LearningGoal[],
  courses: readonly Course[],
  books: readonly Book[],
  practiceWork: readonly PracticeWork[]
): Map<string, GoalProgress> {
  const [studyMinutes, setStudyMinutes] = useState<Map<string, number>>(new Map());

  // Identidad de las metas que dependen de una consulta: cambia → se recarga.
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
        // Sin medida no se inventa: la meta queda no medible con su propio basis.
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
      map.set(goal.id, computeGoalProgress(goal, context));
    }
    return map;
  }, [goals, courses, books, practiceWork, studyMinutes]);
}
