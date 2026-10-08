import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POMODORO_BREAK_MS,
  POMODORO_FOCUS_MS,
  createInitialPomodoro,
  formatCountdown,
  getPomodoroRemaining,
  loadPomodoro,
  pausePomodoro,
  resetPomodoro,
  savePomodoro,
  skipPomodoroPhase,
  startPomodoro,
  tickPomodoro
} from '../src/services/pomodoro.ts';

test('19.1 Pomodoro starts idle in focus phase with 25 minutes', () => {
  const s = createInitialPomodoro();
  assert.equal(s.phase, 'focus');
  assert.equal(s.status, 'idle');
  assert.equal(s.remainingMs, POMODORO_FOCUS_MS);
  assert.equal(s.completedFocus, 0);
});

test('19.2 Start, pause and resume preserve the remaining time exactly', () => {
  const t0 = 1_000_000;
  let s = startPomodoro(createInitialPomodoro(), t0);
  assert.equal(s.status, 'running');
  assert.equal(getPomodoroRemaining(s, t0 + 60_000), POMODORO_FOCUS_MS - 60_000);

  s = pausePomodoro(s, t0 + 60_000);
  assert.equal(s.status, 'paused');
  assert.equal(s.remainingMs, POMODORO_FOCUS_MS - 60_000);
  // Pasar el tiempo en pausa no consume la cuenta atrás
  assert.equal(getPomodoroRemaining(s, t0 + 999_999), POMODORO_FOCUS_MS - 60_000);

  s = startPomodoro(s, t0 + 500_000);
  assert.equal(getPomodoroRemaining(s, t0 + 500_000), POMODORO_FOCUS_MS - 60_000);
});

test('19.3 Finishing focus counts a cycle and moves to a non-running break', () => {
  const t0 = 5_000;
  const running = startPomodoro(createInitialPomodoro(), t0);

  const early = tickPomodoro(running, t0 + POMODORO_FOCUS_MS - 1);
  assert.equal(early.finished, null);

  const done = tickPomodoro(running, t0 + POMODORO_FOCUS_MS);
  assert.equal(done.finished, 'focus');
  assert.equal(done.state.phase, 'break');
  assert.equal(done.state.status, 'idle'); // nunca arranca sola
  assert.equal(done.state.remainingMs, POMODORO_BREAK_MS);
  assert.equal(done.state.completedFocus, 1);
});

test('19.4 Finishing a break does not add a focus cycle and returns to focus', () => {
  const brk = skipPomodoroPhase(createInitialPomodoro());
  assert.equal(brk.phase, 'break');
  const t0 = 10_000;
  const done = tickPomodoro(startPomodoro(brk, t0), t0 + POMODORO_BREAK_MS + 5);
  assert.equal(done.finished, 'break');
  assert.equal(done.state.phase, 'focus');
  assert.equal(done.state.completedFocus, 0);
});

test('19.5 Skip and reset never count cycles and restore phase duration', () => {
  let s = startPomodoro(createInitialPomodoro(), 0);
  s = skipPomodoroPhase(s);
  assert.equal(s.completedFocus, 0);
  assert.equal(s.status, 'idle');
  s = resetPomodoro({ ...s, status: 'paused', remainingMs: 1234 });
  assert.equal(s.remainingMs, POMODORO_BREAK_MS);
  assert.equal(s.status, 'idle');
});

test('19.6 formatCountdown rounds up to the second and never goes negative', () => {
  assert.equal(formatCountdown(POMODORO_FOCUS_MS), '25:00');
  assert.equal(formatCountdown(POMODORO_FOCUS_MS - 1), '25:00');
  assert.equal(formatCountdown(61_000), '01:01');
  assert.equal(formatCountdown(0), '00:00');
  assert.equal(formatCountdown(-500), '00:00');
});

test('19.7 loadPomodoro falls back to the initial state on invalid persisted data', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  };
  try {
    assert.equal(loadPomodoro().status, 'idle');

    store.set('crossedarts-pomodoro', '{basura');
    assert.equal(loadPomodoro().phase, 'focus');

    store.set('crossedarts-pomodoro', JSON.stringify({ phase: 'focus', status: 'running', remainingMs: 1000 }));
    assert.equal(loadPomodoro().status, 'idle'); // running sin endsAt es inválido

    const valid = startPomodoro(createInitialPomodoro(), 42);
    savePomodoro(valid);
    const restored = loadPomodoro();
    assert.equal(restored.status, 'running');
    assert.equal(restored.endsAt, 42 + POMODORO_FOCUS_MS);
  } finally {
    delete (globalThis as any).localStorage;
  }
});
