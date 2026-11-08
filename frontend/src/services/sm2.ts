/**
 * SuperMemo-2 (SM-2) spaced repetition algorithm and interval formatting.
 * Pure logic (no React, no SQLite, no network) for determinism and testability.
 */
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

export interface SM2State {
  repetitionCount: number;
  intervalDays: number;
  easeFactor: number;
}

export interface SM2Result extends SM2State {
  intervalModifier: string;
}

/**
 * Applies the SuperMemo-2 (SM-2) algorithm to one flashcard repetition.
 * Pure isolated function for determinism and testability.
 * Invariants (AGENTS.md §4):
 * - Ease factor never drops below 1.30.
 * - Grades < 3 reset repetition_count = 0 and interval_days = 1.
 * - Grades 3-5 calculate interval using ease factor.
 */
export function calculateSM2(
  currentState: SM2State,
  grade: number
): SM2Result {
  let reps = currentState.repetitionCount;
  let interval = currentState.intervalDays;
  let ease = currentState.easeFactor;

  if (grade >= 3) {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  } else {
    reps = 0;
    interval = 1;
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)));
  const easeFormatted = Number(ease.toFixed(2));

  return {
    repetitionCount: reps,
    intervalDays: interval,
    easeFactor: easeFormatted,
    intervalModifier: `+${interval} days`
  };
}

export function formatNextReviewInterval(intervalDays: number, lang: LanguageCode = 'es'): string {
  const days = Math.max(1, Math.round(intervalDays));
  if (days === 1) return translateKey(lang, 'review.interval.day');
  if (days < 30) return translateKey(lang, 'review.interval.days', { n: days });
  const months = Math.round(days / 30);
  return months === 1
    ? translateKey(lang, 'review.interval.month')
    : translateKey(lang, 'review.interval.months', { n: months });
}
