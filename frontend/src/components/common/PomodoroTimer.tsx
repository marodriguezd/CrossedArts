import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Timer, Play, Pause, RotateCcw, SkipForward, Coffee, Brain, X } from 'lucide-react';
import {
  PomodoroPhase,
  PomodoroState,
  formatCountdown,
  getPomodoroRemaining,
  loadPomodoro,
  pausePomodoro,
  resetPomodoro,
  savePomodoro,
  skipPomodoroPhase,
  startPomodoro,
  tickPomodoro
} from '../../services/pomodoro.ts';
import { cn } from '../ui/index.tsx';

/** Señal sonora suave generada con Web Audio API (sin archivos externos). */
function playSoftChime(): void {
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const notes = [660, 880];
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const start = ctx.currentTime + i * 0.28;
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.12, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.55);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.6);
    });
    setTimeout(() => void ctx.close().catch(() => {}), 1500);
  } catch {
    // Sin audio disponible: el aviso visual basta.
  }
}

const PHASE_LABEL: Record<PomodoroPhase, string> = { focus: 'Enfoque', break: 'Descanso' };

export const PomodoroTimer: React.FC = () => {
  const [state, setState] = useState<PomodoroState>(() => loadPomodoro());
  const [now, setNow] = useState(() => Date.now());
  const [alert, setAlert] = useState<PomodoroPhase | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const commit = useCallback((next: PomodoroState) => {
    setState(next);
    savePomodoro(next);
  }, []);

  // Reloj: refresca cada segundo solo mientras corre y detecta el fin de fase.
  useEffect(() => {
    if (state.status !== 'running') return;
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      const result = tickPomodoro(stateRef.current, t);
      if (result.finished) {
        commit(result.state);
        setAlert(result.finished);
        playSoftChime();
      }
    }, 500);
    return () => clearInterval(id);
  }, [state.status, commit]);

  // Atajo accesible: sincroniza el título de la pestaña con la cuenta atrás.
  useEffect(() => {
    const original = document.title;
    if (state.status === 'running') {
      document.title = `${formatCountdown(getPomodoroRemaining(state, now))} · ${PHASE_LABEL[state.phase]}`;
    }
    return () => {
      document.title = original;
    };
  }, [state, now]);

  const remaining = getPomodoroRemaining(state, now);
  const running = state.status === 'running';
  const PhaseIcon = state.phase === 'focus' ? Brain : Coffee;

  const toggle = () => {
    const t = Date.now();
    setNow(t);
    setAlert(null);
    commit(running ? pausePomodoro(state, t) : startPomodoro(state, t));
  };

  const btn =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-accent-soft/60 hover:text-ink';

  return (
    <div className="relative">
      <div
        className={cn(
          'flex h-10 items-center gap-1.5 rounded-lg border px-2',
          running ? 'border-accent/50 bg-accent-soft/50' : 'border-line bg-surface'
        )}
        role="group"
        aria-label="Temporizador Pomodoro"
      >
        <PhaseIcon size={14} className={running ? 'text-accent' : 'text-muted'} aria-hidden="true" />
        <span
          className="hidden min-w-[3.1rem] text-center font-mono text-secondary font-semibold text-ink sm:inline"
          aria-live="off"
          title={`${PHASE_LABEL[state.phase]} · ciclos completados: ${state.completedFocus}`}
        >
          {formatCountdown(remaining)}
        </span>
        <button
          type="button"
          onClick={toggle}
          className={btn}
          aria-label={running ? 'Pausar temporizador' : `Iniciar ${PHASE_LABEL[state.phase].toLowerCase()}`}
          title={running ? 'Pausar' : `Iniciar ${PHASE_LABEL[state.phase].toLowerCase()}`}
        >
          {running ? <Pause size={13} aria-hidden="true" /> : <Play size={13} aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={() => {
            setAlert(null);
            commit(resetPomodoro(state));
          }}
          className={cn(btn, 'hidden md:inline-flex')}
          aria-label="Reiniciar fase"
          title="Reiniciar fase"
        >
          <RotateCcw size={12} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => {
            setAlert(null);
            commit(skipPomodoroPhase(state));
          }}
          className={cn(btn, 'hidden md:inline-flex')}
          aria-label={`Saltar a ${state.phase === 'focus' ? 'descanso' : 'enfoque'}`}
          title="Saltar fase"
        >
          <SkipForward size={12} aria-hidden="true" />
        </button>
      </div>

      {alert && (
        <div
          role="status"
          aria-live="assertive"
          className="absolute right-0 top-12 z-50 flex w-64 items-start gap-2 rounded-lg border border-accent/40 bg-raised p-3 shadow-pop animate-fade-in"
        >
          <Timer size={16} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-secondary font-semibold text-ink">
              {alert === 'focus' ? '¡Enfoque completado!' : 'Descanso terminado'}
            </p>
            <p className="type-meta mt-0.5">
              {alert === 'focus'
                ? 'Tómate 5 minutos. Pulsa ▶ cuando quieras empezar el descanso.'
                : 'Listo para otra ronda de 25 minutos. Pulsa ▶ para empezar.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAlert(null)}
            className="text-muted hover:text-ink"
            aria-label="Cerrar aviso"
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
};
