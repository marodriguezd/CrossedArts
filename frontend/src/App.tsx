import React, { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import { dao, setDaoLanguage } from './db/dao.ts';
import { dbBridge, setDbLanguage } from './db/sqliteBridge.ts';
import { Shell } from './components/layout/Shell.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { CommandPalette } from './components/common/CommandPalette.ts';
import { localMediaService } from './services/localMediaService.ts';
import { localAiRuntime } from './services/localAiRuntime.ts';
import { aiService } from './ai/aiService.ts';
import { useAppData } from './hooks/useAppData.ts';
import { useTheme } from './hooks/useTheme.ts';
import { useLanguage } from './hooks/useLanguage.ts';
import { useCommandPaletteHotkey } from './hooks/useCommandPaletteHotkey.ts';
import {
  buildPaletteCatalog,
  navigateToDestination,
  resolveActionTab,
  type ConceptIndexRow,
  type LessonIndexRow,
  type ResourceIndexRow,
  type PracticeWorkIndexRow,
  type PaletteItem,
} from './services/commandPalette.ts';
import { exportSqliteFile } from './db/exportImport.ts';
import type { ResourceDestination } from './types/models.ts';
import { parseUrlState, serializeUrlState } from './services/deepLinking.ts';
import { Loader2, AlertTriangle, X, RotateCcw } from 'lucide-react';
import { Button } from './components/ui/index.tsx';

// Deferred code-splitting: every heavy view loads on demand
const Library = lazy(() => import('./pages/Library.tsx').then(m => ({ default: m.Library })));
const CourseDetail = lazy(() => import('./pages/CourseDetail.tsx').then(m => ({ default: m.CourseDetail })));
const ReviewCenter = lazy(() => import('./pages/ReviewCenter.tsx').then(m => ({ default: m.ReviewCenter })));
const NotesView = lazy(() => import('./pages/NotesView.tsx').then(m => ({ default: m.NotesView })));
const ResourceDetail = lazy(() => import('./pages/ResourceDetail.tsx').then(m => ({ default: m.ResourceDetail })));
const SettingsView = lazy(() => import('./pages/SettingsView.tsx').then(m => ({ default: m.SettingsView })));
const FocusToday = lazy(() => import('./pages/FocusToday.tsx').then(m => ({ default: m.FocusToday })));
const AnalyticsView = lazy(() => import('./pages/AnalyticsView.tsx').then(m => ({ default: m.AnalyticsView })));
const GoalsView = lazy(() => import('./pages/GoalsView.tsx').then(m => ({ default: m.GoalsView })));
const KnowledgeGraph = lazy(() => import('./pages/KnowledgeGraph.tsx').then(m => ({ default: m.KnowledgeGraph })));
const AIAssistantDrawer = lazy(() => import('./components/ai/AIAssistantDrawer.tsx').then(m => ({ default: m.AIAssistantDrawer })));

const TabLoadingFallback: React.FC = () => {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] py-16 text-muted animate-fade-in" aria-live="polite">
      <Loader2 className="w-7 h-7 animate-spin text-accent mb-2.5" aria-hidden="true" />
      <p className="text-secondary text-ink">{t('app.loadingView')}</p>
    </div>
  );
};

export const App: React.FC = () => {
  const initialUrlState = typeof window !== 'undefined'
    ? parseUrlState(window.location.hash || window.location.search)
    : { tab: 'dashboard' };

  const [currentTab, setCurrentTab] = useState(initialUrlState.tab);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialUrlState.courseId ?? null);
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(initialUrlState.goalId ?? null);
  const [initialLessonId, setInitialLessonId] = useState<string | null>(initialUrlState.lessonId ?? null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialUrlState.noteId ?? null);
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(initialUrlState.resourceId ?? null);
  const [studyResourceId, setStudyResourceId] = useState<string | null>(initialUrlState.studyResourceId ?? null);
  const [studyLessonId, setStudyLessonId] = useState<string | null>(initialUrlState.studyLessonId ?? null);
  const [studyMode, setStudyMode] = useState<'flashcards' | 'practice' | 'mixed' | undefined>(initialUrlState.studyMode ?? undefined);
  const [aiResource, setAiResource] = useState<{ id?: string; label: string; lessonId?: string } | null>(null);
  const [isAIOpen, setIsAIOpen] = useState(false);
  const [scanReport, setScanReport] = useState<any>(null);
  const [graphVersion, setGraphVersion] = useState(0);
  const [appNotice, setAppNotice] = useState<string | null>(null);
  const [globalQuery, setGlobalQuery] = useState('');
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const { loading, initError, kpis, courses, books, flashcards, notes, resources, practiceWork, recentSessions, goals, selectedCourse, refreshData, selectCourse, retryInit } =
    useAppData(selectedCourseId);

  // Sync React state -> URL hash
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const targetHash = serializeUrlState({
      tab: currentTab,
      courseId: selectedCourseId,
      lessonId: initialLessonId,
      resourceId: selectedResourceId,
      noteId: selectedNoteId,
      goalId: selectedGoalId,
      studyResourceId,
      studyLessonId,
      studyMode,
    });
    if (window.location.hash !== targetHash) {
      window.history.replaceState(null, '', targetHash || window.location.pathname);
    }
  }, [currentTab, selectedCourseId, initialLessonId, selectedResourceId, selectedNoteId, selectedGoalId, studyResourceId, studyLessonId, studyMode]);

  // Sync URL hash (back / forward / popstate) -> React state
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      const parsed = parseUrlState(window.location.hash || window.location.search);
      setCurrentTab(parsed.tab);
      setSelectedCourseId(parsed.courseId ?? null);
      setInitialLessonId(parsed.lessonId ?? null);
      setSelectedResourceId(parsed.resourceId ?? null);
      setSelectedNoteId(parsed.noteId ?? null);
      setSelectedGoalId(parsed.goalId ?? null);
      setStudyResourceId(parsed.studyResourceId ?? null);
      setStudyLessonId(parsed.studyLessonId ?? null);
      setStudyMode(parsed.studyMode ?? undefined);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectCourse = async (id: string) => {
    setSelectedCourseId(id);
    await selectCourse(id);
    setCurrentTab('course_detail');
  };

  const handleNavigateTab = (tab: string) => {
    setSelectedCourseId(null);
    setSelectedGoalId(null);
    setInitialLessonId(null);
    setSelectedNoteId(null);
    setSelectedResourceId(null);
    setStudyResourceId(null);
    setStudyLessonId(null);
    setGlobalQuery('');
    setCurrentTab(tab);
  };

  /**
   * Opens any resource in its dedicated destination by reusing the existing
   * state-based navigation model (no router).
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
    // book / resource / unknown -> dedicated detail view
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

  /** Lesson-scoped study: prioritizes the lesson and its associated content. */
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

  /**
   * Deterministic target of an entity: shared by palette, search, graph, Today,
   * and Goals, so every route opens exactly the same place.
   */
  const handleOpenDestination = (destination: ResourceDestination) => {
    switch (destination.tab) {
      case 'course':
        if (destination.lessonId) void handleOpenLesson(destination.lessonId);
        else void handleSelectCourse(destination.resourceId);
        return;
      case 'note':
        handleOpenNote(destination.noteId);
        return;
      case 'concept':
        handleOpenConcept(destination.conceptId);
        return;
      case 'resource':
        void handleOpenResource(destination.resourceId);
        return;
      case 'goals':
        handleNavigateTab('goals');
        setSelectedGoalId(destination.goalId ?? null);
        return;
      case 'library':
        handleNavigateTab('library');
        return;
      default:
        return;
    }
  };

  const { t, effective } = useLanguage();

  useEffect(() => {
    setDaoLanguage(effective);
    setDbLanguage(effective);
  }, [effective]);

  const handleMountLocalFolder = async () => {
    if (!localMediaService.isSupported()) {
      // Browser capability notice shown in the app UI itself (not a native alert()).
      setAppNotice(t('app.fsNotice'));
      return;
    }

    try {
      const allLessons: { id: string; title: string; media_url?: string }[] = [];
      const coursesWithModules = await dao.getCoursesWithModules();
      for (const c of coursesWithModules) {
        if (c.modules) {
          for (const m of c.modules) {
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
    // The palette flat index may go stale: it is invalidated so the next
    // open reads it again.
    paletteLoadRef.current = null;
    // After importing/changing content, the semantic index regenerates in the
    // background automatically and deduplicated (without blocking the UI).
    localAiRuntime.scheduleIndexing(aiService.getSettings().provider);
  };

  /* Global command palette (Ctrl+K / Cmd+K) */
  const [theme, toggleTheme] = useTheme();
  const [lessonIndex, setLessonIndex] = useState<LessonIndexRow[]>([]);
  const [conceptIndex, setConceptIndex] = useState<ConceptIndexRow[]>([]);
  const [resourceIndex, setResourceIndex] = useState<ResourceIndexRow[]>([]);
  const [practiceIndex, setPracticeIndex] = useState<PracticeWorkIndexRow[]>([]);
  const [continueTarget, setContinueTarget] = useState<{
    courseId: string;
    lessonId: string;
    courseTitle: string;
    lessonTitle: string;
  } | null>(null);

  const paletteOpenRef = useRef(false);
  const paletteLoadRef = useRef<Promise<void> | null>(null);

  /**
   * Prepares the flat index of lessons, concepts, and imported resources so the
   * palette can filter in memory. It fires on open and is DEDUPLICATED: several
   * consecutive opens share the same promise, just like `dbBridge.init`.
   *
   * It lives here and not in `useAppData` on purpose: these are screen indexes,
   * not startup data, and loading a PDF for every imported document at app start
   * would be a cost the user always pays to use Ctrl+K once.
   */
  const ensurePaletteIndex = useCallback(async () => {
    if (paletteLoadRef.current) return paletteLoadRef.current;
    const job = (async () => {
      try {
        const [lessons, concepts, resources, practiceRows] = await Promise.all([
          dao.getLessonIndex(),
          dao.getConceptIndex(),
          dao.getResourceIndex(),
          dao.getPracticeWorkIndex()
        ]);
        setLessonIndex(lessons);
        setConceptIndex(concepts);
        setResourceIndex(resources);
        setPracticeIndex(practiceRows);
      } catch (e) {
        console.warn('No se pudo preparar el índice de la paleta de comandos:', e);
      }
    })();
    paletteLoadRef.current = job;
    return job;
  }, []);

  const openPalette = useCallback(() => {
    paletteOpenRef.current = true;
    // The palette sits above the AI Tutor drawer: both overlays are mutually
    // exclusive so Escape and focus never overlap.
    setIsAIOpen(false);
    setAiResource(null);
    setIsPaletteOpen(true);
    void ensurePaletteIndex();
  }, [ensurePaletteIndex]);

  const closePalette = useCallback(() => {
    paletteOpenRef.current = false;
    setIsPaletteOpen(false);
  }, []);

  const togglePalette = useCallback(() => {
    if (paletteOpenRef.current) closePalette();
    else openPalette();
  }, [openPalette, closePalette]);

  /**
   * The hotkey is inert while the app is not ready.
   *
   * The listener mounts before the `loading` and `initError` guards, so without
   * this, pressing Ctrl+K during startup left `isPaletteOpen` true and the
   * palette appeared on its own once loading finished, with nobody asking for it.
   */
  useCommandPaletteHotkey(loading || initError ? () => undefined : togglePalette);

  /**
   * "Continue learning" points at the next pending lesson. A single candidate
   * course is chosen (the in-progress one first) and only ONE lesson resolves:
   * the remaining lessons already live in the palette index.
   */
  useEffect(() => {
    if (!isPaletteOpen) return;
    let cancelled = false;

    const candidate =
      courses.find(course => course.status === 'IN_PROGRESS') ??
      courses.find(course => course.status === 'NOT_STARTED');
    if (!candidate) {
      setContinueTarget(null);
      return;
    }

    dao
      .getNextLessonForCourse(candidate.id)
      .then(result => {
        if (cancelled || !result) return;
        setContinueTarget({
          courseId: candidate.id,
          lessonId: result.lesson.id,
          courseTitle: candidate.title,
          lessonTitle: result.lesson.title
        });
      })
      .catch(() => {
        if (!cancelled) setContinueTarget(null);
      });

    return () => {
      cancelled = true;
    };
  }, [isPaletteOpen, courses]);

  const paletteItems = useMemo(
    () =>
      buildPaletteCatalog({
        courses,
        books,
        notes,
        lessons: lessonIndex,
        concepts: conceptIndex,
        resources: resourceIndex,
        practiceWork: practiceIndex,
        goals,
        pendingReviews: kpis?.pending_reviews ?? 0,
        continueTarget,
        isDarkTheme: theme === 'dark'
      }, effective),
    [courses, books, notes, lessonIndex, conceptIndex, resourceIndex, practiceIndex, goals, kpis, continueTarget, theme, effective]
  );

  /** Dispatches the chosen item: entity target or action by id. */
  const handlePaletteExecute = (item: PaletteItem) => {
    if (item.destination) {
      navigateToDestination(item.destination, {
        openCourse: id => {
          if (id) void handleSelectCourse(id);
        },
        openLesson: id => {
          void handleOpenLesson(id);
        },
        openNote: handleOpenNote,
        openConcept: handleOpenConcept,
        openResource: id => {
          void handleOpenResource(id);
        },
        openLibrary: () => handleNavigateTab('library'),
        openGoals: goalId => {
          handleNavigateTab('goals');
          setSelectedGoalId(goalId ?? null);
        }
      });
      return;
    }

    const tab = resolveActionTab(item.id);
    if (tab) {
      handleNavigateTab(tab);
      return;
    }

    switch (item.id) {
      case 'accion:review':
        // Global review session: no specific resource or lesson.
        setStudyResourceId(null);
        setStudyLessonId(null);
        setStudyMode(undefined);
        setCurrentTab('review');
        return;
      case 'accion:ai':
        setAiResource(null);
        setIsAIOpen(true);
        return;
      case 'accion:mount-folder':
        void handleMountLocalFolder();
        return;
      case 'accion:backup':
        void exportSqliteFile();
        return;
      case 'accion:theme':
        toggleTheme();
        return;
      default:
        return;
    }
  };

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-canvas text-ink gap-3" role="status" aria-live="polite">
        <Loader2 className="animate-spin text-accent" size={36} />
        <p className="text-secondary font-semibold tracking-wide">{t('app.dbLoading')}</p>
        <span className="text-meta">{t('app.dbLoadingSub')}</span>
      </div>
    );
  }

  /**
   * Database initialization failure.
   *
   * Checked BEFORE mounting any data view. Previously, an initialization failure
   * was only logged to console and the app kept rendering: child views reached
   * `getDatabase()` and leaked the internal English text "Database not
   * initialized". Here mounting stops and a safe recovery path is offered. Data
   * is never wiped automatically: the destructive action still requires explicit
   * confirmation in Settings.
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
            <h1 className="type-display text-ink">{t('app.dbErrorTitle')}</h1>
            <p className="text-body leading-relaxed text-muted">{initError.message}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Button variant="solid" onClick={() => void retryInit()}>
              <RotateCcw size={15} aria-hidden="true" />
              {initError.retryable ? t('app.retry') : t('app.retryLoading')}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.reload();
              }}
            >
              {t('app.reloadApp')}
            </Button>
            {initError.code === 'corrupt-storage' && (
              <Button
                variant="outline"
                onClick={() => void dbBridge.exportPersistedRecovery()}
              >
                {t('app.saveRecovery')}
              </Button>
            )}
          </div>
          <p className="text-micro text-faint">
            {t('app.dbPersistNote')}
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
      onOpenCommandPalette={openPalette}
      paletteOpen={isPaletteOpen}
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
              aria-label={t('app.dismissNotice')}
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
            resources={resources}
            practiceWork={practiceWork}
            recentSessions={recentSessions}
            onSelectCourse={handleSelectCourse}
            onOpenLesson={handleOpenLesson}
            onOpenResource={handleOpenResource}
            onNavigate={handleNavigateTab}
          />
        )}

        <Suspense fallback={<TabLoadingFallback />}>
          {currentTab === 'focus' && (
            <FocusToday
              kpis={kpis}
              courses={courses}
              books={books}
              practiceWork={practiceWork}
              goals={goals}
              recentSessions={recentSessions}
              onNavigate={handleNavigateTab}
              onOpenDestination={handleOpenDestination}
            />
          )}

          {currentTab === 'analytics' && (
            <AnalyticsView
              courses={courses}
              books={books}
              practiceWork={practiceWork}
            />
          )}

          {currentTab === 'goals' && (
            <GoalsView
              goals={goals}
              courses={courses}
              books={books}
              practiceWork={practiceWork}
              initialGoalId={selectedGoalId}
              onRefresh={refreshData}
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
              onOpenGoals={goalId => {
                handleNavigateTab('goals');
                setSelectedGoalId(goalId ?? null);
              }}
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
          )}

          {currentTab === 'notes' && (
            <NotesView notes={notes} initialNoteId={selectedNoteId} onRefresh={refreshData} />
          )}

          {currentTab === 'settings' && (
            <SettingsView onDataReset={refreshData} />
          )}
        </Suspense>
      </>
    </Shell>

      <Suspense fallback={null}>
        <AIAssistantDrawer
          isOpen={isAIOpen}
          onClose={() => { setIsAIOpen(false); setAiResource(null); }}
          activeContext={aiResource?.label || (selectedCourse ? selectedCourse.title : currentTab)}
          activeResourceId={aiResource?.id || selectedCourse?.id}
          activeLessonId={aiResource?.lessonId}
          onOpenCitation={citation => {
            // Every citation target resolves through the same path as the graph
            // and palette: `handleOpenResource` identifies the type and opens its view.
            if (citation.navigate) void handleOpenResource(citation.navigate.id);
          }}
          onOpenSettings={() => {
            setIsAIOpen(false);
            handleNavigateTab('settings');
          }}
        />
      </Suspense>

      {/* The palette mounts as a sibling of the Shell so its overlay does not
          depend on the active view's layout. */}
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={closePalette}
        items={paletteItems}
        onExecute={handlePaletteExecute}
        onSearchAll={(q) => {
          handleNavigateTab('library');
          setGlobalQuery(q);
        }}
      />
    </>
  );
};
