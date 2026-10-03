import React, { useState, lazy, Suspense } from 'react';
import { dao } from './db/dao.ts';
import { Shell } from './components/layout/Shell.tsx';
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
import { Loader2, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { Button } from './components/ui/index.tsx';

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
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const [globalQuery, setGlobalQuery] = useState('');

  const {
    loading,
    initError,
    kpis,
    courses,
    books,
    flashcards,
    notes,
    recentSessions,
    selectedCourse,
    refreshData,
    selectCourse,
    retryInit
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
    setGlobalQuery('');
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
      // Aviso de capacidad del navegador mostrado en la propia interfaz (no con alert() nativo).
      setAppNotice('Tu navegador no soporta File System Access API de forma nativa. Usa navegadores basados en Chromium (Chrome, Edge, Brave) para conceder acceso a carpetas locales.');
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
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-canvas text-ink gap-3" role="status" aria-live="polite">
        <Loader2 className="animate-spin text-accent" size={36} />
        <p className="text-secondary font-semibold tracking-wide">Inicializando SQLite en WebAssembly...</p>
        <span className="text-meta">Cargando base de datos y esquemas relacionales</span>
      </div>
    );
  }

  /**
   * Fallo de inicialización de la base de datos.
   *
   * Se comprueba ANTES de montar cualquier vista de datos. Antes, un fallo de
   * inicialización solo se registraba en consola y la aplicación continuaba
   * renderizando: las vistas hijas llegaban a `getDatabase()` y exponían el
   * texto interno en inglés "Database not initialized". Aquí se detiene el
   * montaje y se ofrece una vía de recuperación segura. Nunca se borran datos
   * automáticamente: la acción destructiva sigue requiriendo confirmación
   * explícita en Ajustes.
   */
  if (initError) {
    return (
      <div className="flex min-h-screen w-screen items-center justify-center bg-canvas px-5 py-12 text-ink">
        <div
          role="alert"
          className="w-full max-w-lg space-y-4 rounded-xl border border-error/30 bg-surface p-6 text-center shadow-card"
        >
          <AlertTriangle size={30} className="mx-auto text-error" aria-hidden="true" />
          <div className="space-y-2">
            <h1 className="type-display text-ink">No se pudo abrir tu base de datos local</h1>
            <p className="text-body leading-relaxed text-muted">{initError.message}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button variant="solid" onClick={() => void retryInit()}>
              <RotateCcw size={15} aria-hidden="true" />
              {initError.retryable ? 'Reintentar' : 'Volver a intentar la carga'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            >
              Recargar la aplicación
            </Button>
          </div>
          <p className="text-micro text-faint">
            Tus datos no se han eliminado. Si el problema continúa, restaura un respaldo desde
            Ajustes una vez que la aplicación vuelva a cargar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
    <Shell
      currentTab={currentTab}
      onNavigate={handleNavigateTab}
      onOpenAI={() => { setAiResource(null); setIsAIOpen(true); }}
      onGlobalSearch={(q) => {
        handleNavigateTab('library');
        setGlobalQuery(q);
      }}
    >
      <>
        {appNotice && (
          <div
            role="status"
            aria-live="polite"
            className="mb-6 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2.5 text-secondary text-ink"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warning" />
            <span className="flex-1">{appNotice}</span>
            <button
              onClick={() => setAppNotice(null)}
              aria-label="Cerrar aviso"
              className="shrink-0 text-faint hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        )}

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
            initialQuery={globalQuery}
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
            <div className="flex flex-col items-center justify-center py-24 text-muted">
              <Loader2 className="w-8 h-8 animate-spin mb-3 text-accent" />
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
      </>
    </Shell>

      <AIAssistantDrawer
        isOpen={isAIOpen}
        onClose={() => { setIsAIOpen(false); setAiResource(null); }}
        activeContext={aiResource?.label || (selectedCourse ? selectedCourse.title : currentTab)}
        activeResourceId={aiResource?.id || selectedCourse?.id}
        activeLessonId={aiResource?.lessonId}
      />
    </>
  );
};
