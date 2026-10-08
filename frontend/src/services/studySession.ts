import type { StudySessionMode } from '../types/models.ts';

/**
 * Máquina de estados pura y determinista para el ciclo de vida de una sesión de estudio.
 * Se mantiene independiente de React para poder testearla sin DOM.
 *
 *   idle -> starting -> active -> paused -> active ... -> completed
 *                          \-> completed
 *                          \-> cancelled
 *   starting -> failed (persistencia fallida)
 */
export type StudySessionPhase =
  | 'idle'
  | 'starting'
  | 'active'
  | 'paused'
  | 'completed'
  | 'cancelled'
  | 'failed';

export interface StudySessionState {
  phase: StudySessionPhase;
  mode: StudySessionMode;
  resourceId?: string;
  /** Ámbito de lección opcional asociado a la sesión (Iteración 14). */
  lessonId?: string;
  sessionId: string | null;
  startedAt: number | null;
  error: string | null;
  /** Indica si el registro de la sesión fue persistido correctamente. */
  persisted: boolean;
}

export type StudySessionAction =
  | { type: 'START_REQUESTED'; mode: StudySessionMode; resourceId?: string; lessonId?: string }
  | { type: 'STARTED'; sessionId: string; startedAt: number }
  | { type: 'START_FAILED'; error: string }
  | { type: 'RESUMED'; sessionId: string; mode: StudySessionMode; resourceId?: string; lessonId?: string; startedAt: number }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'COMPLETED' }
  | { type: 'CANCELLED' }
  | { type: 'FINALIZE_FAILED'; error: string }
  | { type: 'RESET' };

export const initialStudySessionState: StudySessionState = {
  phase: 'idle',
  mode: 'flashcards',
  sessionId: null,
  startedAt: null,
  error: null,
  persisted: false
};

export function studySessionReducer(
  state: StudySessionState,
  action: StudySessionAction
): StudySessionState {
  switch (action.type) {
    case 'START_REQUESTED':
      if (state.phase === 'active' || state.phase === 'paused' || state.phase === 'starting') return state;
      return {
        ...initialStudySessionState,
        phase: 'starting',
        mode: action.mode,
        resourceId: action.resourceId,
        lessonId: action.lessonId
      };

    case 'STARTED':
      if (state.phase !== 'starting') return state;
      return {
        ...state,
        phase: 'active',
        sessionId: action.sessionId,
        startedAt: action.startedAt,
        persisted: true,
        error: null
      };

    case 'START_FAILED':
      return {
        ...initialStudySessionState,
        phase: 'failed',
        mode: state.mode,
        resourceId: state.resourceId,
        lessonId: state.lessonId,
        error: action.error,
        persisted: false
      };

    case 'RESUMED':
      return {
        ...initialStudySessionState,
        phase: 'active',
        mode: action.mode,
        resourceId: action.resourceId,
        lessonId: action.lessonId,
        sessionId: action.sessionId,
        startedAt: action.startedAt,
        persisted: true
      };

    case 'PAUSE':
      if (state.phase !== 'active') return state;
      return { ...state, phase: 'paused' };

    case 'RESUME':
      if (state.phase !== 'paused') return state;
      return { ...state, phase: 'active' };

    case 'COMPLETED':
      if (state.phase !== 'active' && state.phase !== 'paused') return state;
      return { ...state, phase: 'completed', error: null };

    case 'CANCELLED':
      if (state.phase !== 'active' && state.phase !== 'paused') return state;
      return { ...state, phase: 'cancelled', error: null };

    case 'FINALIZE_FAILED':
      // Nunca se reporta una finalización si la persistencia falló: la sesión
      // permanece activa para permitir reintentar.
      if (state.phase !== 'active' && state.phase !== 'paused') return state;
      return { ...state, phase: 'active', error: action.error, persisted: true };

    case 'RESET':
      return { ...initialStudySessionState };

    default:
      return state;
  }
}
