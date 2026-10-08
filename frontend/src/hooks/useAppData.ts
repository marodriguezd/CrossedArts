import { useState, useEffect, useCallback } from 'react';
import { dbBridge, type DbInitFailure } from '../db/sqliteBridge.ts';
import { dao } from '../db/dao.ts';
import type { KPIMetrics, Course, Book, Flashcard, Note, LearningSession, LearningResource, PracticeWork, LearningGoal } from '../types/models.ts';

export interface AppDataState {
  loading: boolean;
  /**
   * Fallo terminal de inicialización. Mientras no sea null la aplicación NO debe
   * renderizar sus vistas de datos: hacerlo llevaba al grafo de conocimiento a
   * llamar a `getDatabase()` y a mostrar "Database not initialized".
   */
  initError: DbInitFailure | null;
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  flashcards: Flashcard[];
  notes: Note[];
  /** Recursos importados (documentos) que no son cursos ni libros. */
  resources: LearningResource[];
  /** Trabajo práctico producido por el estudiante (evidencia de aprendizaje). */
  practiceWork: PracticeWork[];
  recentSessions: LearningSession[];
  /** Metas de aprendizaje (planificación personal derivada de datos reales). */
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
      // Si otra pestaña ha persistido una versión más nueva, `ensureFresh()` recarga
      // el estado en memoria ANTES de que leamos, para no servir lecturas obsoletas.
      await dbBridge.ensureFresh();
      // El grafo de conocimiento se carga de forma perezosa solo al abrir su vista
      // (KnowledgeGraph.tsx), no en el arranque de la aplicación.
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
   * Inicialización de la aplicación.
   *
   * `dbBridge.init()` es concurrency-safe y devuelve una promesa compartida, de
   * modo que el doble montaje de StrictMode (montar -> desmontar -> montar) y
   * cualquier vista perezosa que se monte a la vez esperan la MISMA operación.
   *
   * Clave del defecto corregido: antes el `finally` hacia `setLoading(false)`
   * incluso cuando `init()` fallaba, así que la aplicación se renderizaba contra
   * una base de datos inexistente y el fallo aflora meses tarde como un error de
   * una vista hija. Ahora un fallo de inicialización es un estado de primer clase.
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

  /** Reintenta la inicialización tras un fallo recuperable (acción del usuario). */
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
