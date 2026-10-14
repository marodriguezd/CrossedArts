import { useState, useEffect, useCallback } from 'react';
import { dbBridge, type DbInitFailure } from '../db/sqliteBridge.ts';
import { dao } from '../db/dao.ts';
import type { KPIMetrics, Course, Book, Flashcard, Note, LearningSession, LearningResource, PracticeWork, LearningGoal } from '../types/models.ts';

export interface AppDataState {
  loading: boolean;
  /**
   * Terminal initialization failure. While non-null the app must NOT render its
   * data views: doing so led the knowledge graph to call `getDatabase()` and
   * show "Database not initialized".
   */
  initError: DbInitFailure | null;
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  flashcards: Flashcard[];
  notes: Note[];
  /** Imported resources (documents) that are neither courses nor books. */
  resources: LearningResource[];
  /** Learner-produced practice work (learning evidence). */
  practiceWork: PracticeWork[];
  recentSessions: LearningSession[];
  /** Learning goals (personal planning derived from real data). */
  goals: LearningGoal[];
  selectedCourse: Course | null;
  refreshData: () => Promise<void>;
  selectCourse: (id: string | null) => Promise<void>;
  retryInit: () => Promise<void>;
}

export function useAppData(selectedCourseId: string | null): AppDataState {
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<DbInitFailure | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [kpis, setKpis] = useState<KPIMetrics | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [practiceWork, setPracticeWork] = useState<PracticeWork[]>([]);
  const [recentSessions, setRecentSessions] = useState<LearningSession[]>([]);
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const refreshData = useCallback(async () => {
    try {
      // If another tab persisted a newer version, `ensureFresh()` reloads the
      // in-memory state BEFORE we read, so no stale reads are served.
      await dbBridge.ensureFresh();
      // The knowledge graph loads lazily only when its view opens
      // (KnowledgeGraph.tsx), not at app startup.
      const [k, c, b, f, n, s, r, pw, g] = await Promise.all([
        dao.getKPIs(),
        dao.getCourses(),
        dao.getBooks(),
        dao.getFlashcards(),
        dao.getNotes(),
        dao.getRecentStudySessions(4),
        dao.getLearningResources(),
        dao.getAllPracticeWork(),
        dao.getGoals()
      ]);
      setKpis(k);
      setCourses(c);
      setBooks(b);
      setFlashcards(f);
      setNotes(n);
      setRecentSessions(s);
      setResources(r);
      setPracticeWork(pw);
      setGoals(g);

      if (selectedCourseId) {
        const fullCourse = await dao.getCourseById(selectedCourseId);
        setSelectedCourse(fullCourse);
      }
    } catch (err) {
      console.error('Error cargando datos de SQLite:', err);
    }
  }, [selectedCourseId]);

  const selectCourse = useCallback(async (id: string | null) => {
    if (!id) {
      setSelectedCourse(null);
      return;
    }
    const fullCourse = await dao.getCourseById(id);
    setSelectedCourse(fullCourse);
  }, []);

  /**
   * Application initialization.
   *
   * `dbBridge.init()` is concurrency-safe and returns a shared promise, so
   * StrictMode's double mount (mount -> unmount -> mount) and any lazily mounted
   * view awaiting at the same time share the SAME operation.
   *
   * Key to the fixed defect: previously `finally` ran `setLoading(false)` even
   * when `init()` failed, so the app rendered against a nonexistent database and
   * the failure surfaced months later as an error in a child view. Now an
   * initialization failure is a first-class state.
   */
  useEffect(() => {
    let mounted = true;
    const initApp = async () => {
      try {
        await dbBridge.init();
        if (!mounted) return;
        await refreshData();
        if (mounted) setInitError(null);
      } catch (err: any) {
        if (!mounted) return;
        const failure = err?.failure ?? {
          code: 'unknown' as const,
          message: 'No se pudo inicializar la base de datos local. Vuelve a cargar la aplicación.',
          retryable: true,
          detail: err?.message
        };
        console.error('Error inicializando base de datos:', failure.detail || failure.message);
        setInitError(failure);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    initApp();

    return () => {
      mounted = false;
    };
  }, [refreshData, retryToken]);

  /** Retries initialization after a recoverable failure (user action). */
  const retryInit = useCallback(async () => {
    setLoading(true);
    setInitError(null);
    setRetryToken(t => t + 1);
  }, []);

  return {
    loading,
    initError,
    retryInit,
    kpis,
    courses,
    books,
    flashcards,
    notes,
    resources,
    practiceWork,
    recentSessions,
    goals,
    selectedCourse,
    refreshData,
    selectCourse
  };
}
