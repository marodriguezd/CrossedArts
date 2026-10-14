/**
 * Pure state machine for the Pomodoro timer.
 * Uses absolute timestamps (`endsAt`) instead of counters so it survives
 * reloads and the timer throttling applied to background tabs.
 */

export type PomodoroPhase = 'focus' | 'break';
export type PomodoroStatus = 'idle' | 'running' | 'paused';

export const POMODORO_FOCUS_MS = 25 * 60 * 1000;
export const POMODORO_BREAK_MS = 5 * 60 * 1000;

export interface PomodoroState {
  phase: PomodoroPhase;
  status: PomodoroStatus;
  /** Absolute completion instant (only while `running`). */
  endsAt: number | null;
  /** Frozen remaining time (in `idle` and `paused`). */
  remainingMs: number;
  /** Focus cycles completed in this session. */
  completedFocus: number;
}

export function phaseDuration(phase: PomodoroPhase): number {
  return phase === 'focus' ? POMODORO_FOCUS_MS : POMODORO_BREAK_MS;
}

export function createInitialPomodoro(): PomodoroState {
  return { phase: 'focus', status: 'idle', endsAt: null, remainingMs: POMODORO_FOCUS_MS, completedFocus: 0 };
}

export function startPomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.status === 'running') return state;
  return { ...state, status: 'running', endsAt: now + state.remainingMs };
}

export function pausePomodoro(state: PomodoroState, now: number): PomodoroState {
  if (state.status !== 'running' || state.endsAt === null) return state;
  return { ...state, status: 'paused', endsAt: null, remainingMs: Math.max(0, state.endsAt - now) };
}

export function resetPomodoro(state: PomodoroState): PomodoroState {
  return { ...state, status: 'idle', endsAt: null, remainingMs: phaseDuration(state.phase) };
}

/** Skips to the opposite phase without counting the cycle as completed. */
export function skipPomodoroPhase(state: PomodoroState): PomodoroState {
  const phase: PomodoroPhase = state.phase === 'focus' ? 'break' : 'focus';
  return { ...state, phase, status: 'idle', endsAt: null, remainingMs: phaseDuration(phase) };
}

export function getPomodoroRemaining(state: PomodoroState, now: number): number {
  if (state.status === 'running' && state.endsAt !== null) return Math.max(0, state.endsAt - now);
  return state.remainingMs;
}

/**
 * Advances the clock. When the phase ended, it moves to the next one (paused
 * and ready to start: it never starts on its own) and reports which phase
 * finished.
 */
export function tickPomodoro(
  state: PomodoroState,
  now: number
): { state: PomodoroState; finished: PomodoroPhase | null } {
  if (state.status !== 'running' || state.endsAt === null || now < state.endsAt) {
    return { state, finished: null };
  }
  const finished = state.phase;
  const nextPhase: PomodoroPhase = finished === 'focus' ? 'break' : 'focus';
  return {
    finished,
    state: {
      phase: nextPhase,
      status: 'idle',
      endsAt: null,
      remainingMs: phaseDuration(nextPhase),
      completedFocus: state.completedFocus + (finished === 'focus' ? 1 : 0)
    }
  };
}

/** Formats milliseconds as `MM:SS` (rounded up to the second). */
export function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const STORAGE_KEY = 'crossedarts-pomodoro';

/** Loads persisted state; any invalid data returns the initial state. */
export function loadPomodoro(): PomodoroState {
  try {
    if (typeof localStorage === 'undefined') return createInitialPomodoro();
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialPomodoro();
    const p = JSON.parse(raw);
    const validPhase = p?.phase === 'focus' || p?.phase === 'break';
    const validStatus = p?.status === 'idle' || p?.status === 'running' || p?.status === 'paused';
    if (!validPhase || !validStatus || typeof p.remainingMs !== 'number') return createInitialPomodoro();
    if (p.status === 'running' && typeof p.endsAt !== 'number') return createInitialPomodoro();
    return {
      phase: p.phase,
      status: p.status,
      endsAt: p.status === 'running' ? p.endsAt : null,
      remainingMs: Math.max(0, p.remainingMs),
      completedFocus: Number.isFinite(p.completedFocus) ? Math.max(0, p.completedFocus) : 0
    };
  } catch {
    return createInitialPomodoro();
  }
}

export function savePomodoro(state: PomodoroState): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable: the timer keeps running in memory.
  }
}
