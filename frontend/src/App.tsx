import React, { useState, lazy, Suspense } from 'react';
import { dao } from './db/dao.ts';
import { Navbar } from './components/layout/Navbar.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Library } from './pages/Library.tsx';
import { CourseDetail } from './pages/CourseDetail.tsx';
import { ReviewCenter } from './pages/ReviewCenter.tsx';
import { NotesView } from './pages/NotesView.tsx';
import { ResourceDetail } from './pages/ResourceDetail.tsx';
import { SettingsView } from './pages/SettingsView.tsx';
import { AIAssistantDrawer } from './components/ai/AIAssistantDrawer.tsx';
import { localMediaService } from './services/localMediaService.ts';
import { useAppData } from './hooks/useAppData.ts';
import { Loader2 } from 'lucide-react';

const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph.tsx').then(m => ({ default: m.KnowledgeGraph })));

export const App: React.FC = () => {
  const [currentTab, setCurrentTab] = useState('dashboard');
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null);
  const [initialLessonId, setInitialLessonId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(null);
  const [studyResourceId, setStudyResourceId] = useState<string | null>(null);
  const [studyLessonId, setStudyLessonId] = useState<string | null>(null);
  const [studyMode, setStudyMode] = useState<'flashcards' | 'practice' | 'mixed' | undefined>(undefined);
  const [aiResource, setAiResource] = useState<{ id?: string; label: string; lessonId?: string } | null>(null);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [scanReport, setScanReport] = useState<any>(null);
  const [graphVersion, setGraphVersion] = useState(0);

  const {
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
  } = useAppData(selectedCourseId);

  const handleSelectCourse = async (id: string) => {
    setSelectedCourseId(id);
    await selectCourse(id);
    setCurrentTab('course_detail');
  };

  const handleNavigateTab = (tab: string) => {
    setSelectedCourseId(null);
    setInitialLessonId(null);
    setSelectedNoteId(null);
    setSelectedResourceId(null);
    setStudyResourceId(null);
    setStudyLessonId(null);
    setCurrentTab(tab);
  };

  /**
   * Abre cualquier recurso en su destino dedicado reutilizando el modelo de
   * navegación por estado existente (sin router).
   */
  const handleOpenResource = async (resourceId: string) => {
    const kind = await dao.resolveNodeKind(resourceId);
    if (kind === 'course') {
      setInitialLessonId(null);
      await handleSelectCourse(resourceId);
      return;
    }
    if (kind === 'lesson') {
      await handleOpenLesson(resourceId);
      return;
    }
    if (kind === 'note') {
      handleOpenNote(resourceId);
      return;
    }
    if (kind === 'concept') {
      handleOpenConcept(resourceId);
      return;
    }
    if (kind === 'module') {
      const courseId = await dao.getCourseIdForModule(resourceId);
      if (courseId) {
        setInitialLessonId(null);
        await handleSelectCourse(courseId);
        return;
      }
    }
    // book / resource / desconocido -> vista de detalle dedicada
    setSelectedResourceId(resourceId);
    setSelectedCourseId(null);
    setCurrentTab('resource_detail');
  };

  const handleOpenConcept = (conceptId: string) => {
    setSelectedResourceId(conceptId);
    setSelectedCourseId(null);
    setCurrentTab('resource_detail');
  };

  const handleOpenLesson = async (lessonId: string) => {
    const courseId = await dao.getCourseIdForLesson(lessonId);
    if (courseId) {
      setInitialLessonId(lessonId);
      await handleSelectCourse(courseId);
    }
  };

  const handleOpenNote = (noteId: string) => {
    setSelectedNoteId(noteId);
    setSelectedCourseId(null);
    setSelectedResourceId(null);
    setCurrentTab('notes');
  };

  const handleStudyResource = (resourceId: string, mode?: 'flashcards' | 'practice' | 'mixed') => {
    setStudyResourceId(resourceId);
    setStudyLessonId(null);
    setStudyMode(mode);
    setCurrentTab('review');
  };

  /** Estudio con ámbito de lección: prioriza la lección y su contenido asociado. */
  const handleStudyLesson = async (lessonId: string, mode?: 'flashcards' | 'practice' | 'mixed') => {
    const courseId = await dao.getCourseIdForLesson(lessonId);
    setStudyResourceId(courseId);
    setStudyLessonId(lessonId);
    setStudyMode(mode);
    setCurrentTab('review');
  };

  const handleExplainResource = (resourceId: string, label: string, lessonId?: string) => {
    setAiResource({ id: resourceId, label, lessonId });
    setIsAIOpen(true);
  };

  const handleMountLocalFolder = async () => {
    if (!localMediaService.isSupported()) {
      alert('Tu navegador no soporta File System Access API de forma nativa. Usa navegadores basados en Chromium (Chrome, Edge, Brave) para conceder acceso a carpetas locales.');
      return;
    }

    try {
      const allLessons: { id: string; title: string; media_url?: string }[] = [];
      for (const c of courses) {
        const fullCourse = await dao.getCourseById(c.id);
        if (fullCourse?.modules) {
          for (const m of fullCourse.modules) {
            if (m.lessons) {
              for (const l of m.lessons) {
                allLessons.push({ id: l.id, title: l.title, media_url: l.media_url });
              }
            }
          }
        }
      }

      const report = await localMediaService.pickAndScanDirectory(allLessons);
      setScanReport(report);
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.warn('Error escaneando carpeta local:', e);
      }
    }
  };

  const handleGraphMutated = () => {
    setGraphVersion(v => v + 1);
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
        setCurrentTab={handleNavigateTab}
        openAIPanel={() => { setAiResource(null); setIsAIOpen(true); }}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentTab === 'dashboard' && (
          <Dashboard
            kpis={kpis}
            courses={courses}
            books={books}
            recentSessions={recentSessions}
            onSelectCourse={handleSelectCourse}
            onNavigate={handleNavigateTab}
          />
        )}

        {currentTab === 'library' && (
          <Library
            courses={courses}
            books={books}
            onSelectCourse={handleSelectCourse}
            onMountLocalFolder={handleMountLocalFolder}
            scanReport={scanReport}
            onDismissReport={() => setScanReport(null)}
            onUpdateBookProgress={refreshData}
            onDocumentImported={handleGraphMutated}
            onStudyResource={handleStudyResource}
            onExplainResource={handleExplainResource}
            onOpenResource={handleOpenResource}
            onOpenNote={handleOpenNote}
            onOpenConcept={handleOpenConcept}
          />
        )}

        {currentTab === 'course_detail' && selectedCourse && (
          <CourseDetail
            course={selectedCourse}
            initialLessonId={initialLessonId}
            onBack={() => { setSelectedCourseId(null); setInitialLessonId(null); setCurrentTab('library'); }}
            onRefresh={refreshData}
            onStudyResource={handleStudyResource}
            onStudyLesson={handleStudyLesson}
            onExplainResource={handleExplainResource}
            onOpenNote={handleOpenNote}
            onOpenResource={handleOpenResource}
            onOpenConcept={handleOpenConcept}
          />
        )}

        {currentTab === 'resource_detail' && selectedResourceId && (
          <ResourceDetail
            resourceId={selectedResourceId}
            onBack={() => { setSelectedResourceId(null); setCurrentTab('library'); }}
            onRefresh={refreshData}
            onOpenResource={handleOpenResource}
            onOpenNote={handleOpenNote}
            onOpenConcept={handleOpenConcept}
            onStudyResource={handleStudyResource}
            onExplainResource={handleExplainResource}
          />
        )}

        {currentTab === 'review' && (
          <ReviewCenter
            flashcards={flashcards}
            initialResourceId={studyResourceId}
            initialLessonId={studyLessonId}
            initialMode={studyMode}
            onRefresh={refreshData}
          />
        )}

        {currentTab === 'graph' && (
          <Suspense fallback={
            <div className="flex flex-col items-center justify-center py-24 text-slate-400">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-purple-500" />
              <p className="text-sm">Cargando motor de grafo de conocimiento...</p>
            </div>
          }>
            <KnowledgeGraph
              version={graphVersion}
              onOpenResource={handleOpenResource}
              onOpenLesson={handleOpenLesson}
              onOpenNote={handleOpenNote}
              onOpenConcept={handleOpenConcept}
              onStudyResource={handleStudyResource}
              onNavigate={handleNavigateTab}
              onGraphMutated={handleGraphMutated}
            />
          </Suspense>
        )}

        {currentTab === 'notes' && (
          <NotesView notes={notes} initialNoteId={selectedNoteId} onRefresh={refreshData} />
        )}

        {currentTab === 'settings' && (
          <SettingsView onDataReset={refreshData} />
        )}
      </main>

      <AIAssistantDrawer
        isOpen={isAIOpen}
        onClose={() => { setIsAIOpen(false); setAiResource(null); }}
        activeContext={aiResource?.label || (selectedCourse ? selectedCourse.title : currentTab)}
        activeResourceId={aiResource?.id || selectedCourse?.id}
        activeLessonId={aiResource?.lessonId}
      />
    </div>
  );
};
