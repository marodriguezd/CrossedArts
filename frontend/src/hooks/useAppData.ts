import { useState, useEffect, useCallback } from 'react';
import { dbBridge } from '../db/sqliteBridge.ts';
import { dao } from '../db/dao.ts';
import type { KPIMetrics, Course, Book, Flashcard, Note, LearningSession } from '../types/models.ts';

export interface AppDataState {
  loading: boolean;
  kpis: KPIMetrics | null;
  courses: Course[];
  books: Book[];
  flashcards: Flashcard[];
  notes: Note[];
  recentSessions: LearningSession[];
  selectedCourse: Course | null;
  refreshData: () => Promise<void>;
  selectCourse: (id: string | null) => Promise<void>;
}

export function useAppData(selectedCourseId: string | null): AppDataState {
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<KPIMetrics | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [recentSessions, setRecentSessions] = useState<LearningSession[]>([]);
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const refreshData = useCallback(async () => {
    try {
      // El grafo de conocimiento se carga de forma perezosa solo al abrir su vista
      // (KnowledgeGraph.tsx), no en el arranque de la aplicación.
      const [k, c, b, f, n, s] = await Promise.all([
        dao.getKPIs(),
        dao.getCourses(),
        dao.getBooks(),
        dao.getFlashcards(),
        dao.getNotes(),
        dao.getRecentStudySessions(4)
      ]);
      setKpis(k);
      setCourses(c);
      setBooks(b);
      setFlashcards(f);
      setNotes(n);
      setRecentSessions(s);

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

  useEffect(() => {
    let mounted = true;
    const initApp = async () => {
      try {
        await dbBridge.init();
        if (mounted) {
          await refreshData();
        }
      } catch (err) {
        console.error('Error inicializando base de datos:', err);
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
  }, [refreshData]);

  return {
    loading,
    kpis,
    courses,
    books,
    flashcards,
    notes,
    recentSessions,
    selectedCourse,
    refreshData,
    selectCourse
  };
}
