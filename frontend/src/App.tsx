import React, { useState, useEffect } from 'react';
import { dbBridge } from './db/sqliteBridge.ts';
import { dao } from './db/dao.ts';
import { KPIMetrics, Course, Book, Flashcard, Note, ConceptNode, ConceptEdge } from './types/models.ts';
import { Navbar } from './components/layout/Navbar.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Library } from './pages/Library.tsx';
import { CourseDetail } from './pages/CourseDetail.tsx';
import { ReviewCenter } from './pages/ReviewCenter.tsx';
import { KnowledgeGraph } from './pages/KnowledgeGraph.tsx';
import { NotesView } from './pages/NotesView.tsx';
import { SettingsView } from './pages/SettingsView.tsx';
import { AIAssistantDrawer } from './components/ai/AIAssistantDrawer.tsx';
import { Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [loading, setLoading] = useState(true);
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [isAIOpen, setIsAIOpen] = useState(false);

  // Estados de datos SQLite
  const [kpis, setKpis] = useState<KPIMetrics | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [graphData, setGraphData] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[] }>({ nodes: [], edges: [] });
  const [selectedCourse, setSelectedCourse] = useState<Course | null>(null);

  const loadAllData = async () => {
    try {
      const [k, c, b, f, n, g] = await Promise.all([
        dao.getKPIs(),
        dao.getCourses(),
        dao.getBooks(),
        dao.getFlashcards(),
        dao.getNotes(),
        dao.getKnowledgeGraph()
      ]);
      setKpis(k);
      setCourses(c);
      setBooks(b);
      setFlashcards(f);
      setNotes(n);
      setGraphData(g);

      if (selectedCourseId) {
        const fullCourse = await dao.getCourseById(selectedCourseId);
        setSelectedCourse(fullCourse);
      }
    } catch (err) {
      console.error('Error cargando datos de SQLite:', err);
    }
  };

  useEffect(() => {
    const initApp = async () => {
      try {
        await dbBridge.init();
        await loadAllData();
      } catch (err) {
        console.error('Error inicializando base de datos:', err);
      } finally {
        setLoading(false);
      }
    };
    initApp();
  }, []);

  const handleSelectCourse = async (id: string) => {
    setSelectedCourseId(id);
    const fullCourse = await dao.getCourseById(id);
    setSelectedCourse(fullCourse);
    setCurrentTab('course_detail');
  };

  const handleMountLocalFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const dirHandle = await window.showDirectoryPicker();
        alert(`Carpeta montada con éxito: ${dirHandle.name}. Puedes reproducir tus archivos locales directamente.`);
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.warn('Error accediendo a carpeta:', e);
        }
      }
    } else {
      alert('Tu navegador no soporta File System Access API de forma nativa. Usa Chrome, Edge o Brave para explorar directorios locales sin subirlos.');
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-slate-950 text-slate-100 gap-3">
        <Loader2 className="animate-spin text-purple-500" size={36} />
        <p className="text-sm font-semibold tracking-wide text-slate-300">Inicializando SQLite en WebAssembly...</p>
        <span className="text-xs text-slate-500">Cargando base de datos y esquemas relacionales</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-purple-600 selection:text-white">
      <Navbar 
        currentTab={currentTab} 
        setCurrentTab={tab => { setSelectedCourseId(null); setCurrentTab(tab); }} 
        openAIPanel={() => setIsAIOpen(true)} 
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === 'dashboard' && (
          <Dashboard 
            kpis={kpis} 
            courses={courses} 
            books={books} 
            onSelectCourse={handleSelectCourse} 
            onNavigate={setCurrentTab} 
          />
        )}

        {currentTab === 'library' && (
          <Library 
            courses={courses} 
            books={books} 
            onSelectCourse={handleSelectCourse} 
            onMountLocalFolder={handleMountLocalFolder} 
          />
        )}

        {currentTab === 'course_detail' && selectedCourse && (
          <CourseDetail 
            course={selectedCourse} 
            onBack={() => { setSelectedCourseId(null); setCurrentTab('library'); }} 
            onRefresh={loadAllData} 
          />
        )}

        {currentTab === 'review' && (
          <ReviewCenter flashcards={flashcards} onRefresh={loadAllData} />
        )}

        {currentTab === 'graph' && (
          <KnowledgeGraph graphData={graphData} />
        )}

        {currentTab === 'notes' && (
          <NotesView notes={notes} onRefresh={loadAllData} />
        )}

        {currentTab === 'settings' && (
          <SettingsView onDataReset={loadAllData} />
        )}
      </main>

      <AIAssistantDrawer 
        isOpen={isAIOpen} 
        onClose={() => setIsAIOpen(false)} 
        activeContext={selectedCourse ? selectedCourse.title : currentTab} 
      />
    </div>
  );
};
