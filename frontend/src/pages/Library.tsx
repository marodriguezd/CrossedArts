import React, { useState, useRef, useEffect, useCallback, useDeferredValue, useMemo } from 'react';
import { useLanguage } from '../hooks/useLanguage.ts';
import { Course, Book, SearchResult, UnorganizedResource, GraphNodeType, LearningResource } from '../types/models.ts';
import { isTopOverlay, pushOverlay, removeOverlay } from '../services/overlayStack.ts';
import { Search, FolderOpen, Play, BookOpen, Layers, Plus, CheckCircle, AlertTriangle, FolderCheck, X, Bookmark, Edit3, Check, FileUp, Loader2, Link2, GraduationCap, FileText, Lightbulb, Brain, Sparkles, ListChecks, ClipboardList, ArrowUpRight, UploadCloud, Target } from 'lucide-react';
import { resolveSearchResultDestination, filterSupportedFiles, adjustBookPage } from '../services/domainLogic.ts';
import type { MediaScanReport } from '../services/localMediaService.ts';
import { dao } from '../db/dao.ts';
import { localIngestionService } from '../lib/localIngestion/service.ts';
import type { IngestionProgress } from '../lib/localIngestion/types.ts';
import { Button, Chip, SearchInput, Panel, SectionHeading, Badge, InlineStatus, ProgressBar, EmptyState, cn } from '../components/ui/index.tsx';
import {
  CatalogFilterBar,
  CourseCreationModal,
  DocumentImportModal,
  DocumentProvenanceModal,
  BookProgressEditor,
  UnorganizedResourcesSection,
} from '../components/library/index.ts';

interface LibraryProps {
  courses: Course[];
  books: Book[];
  /** Query coming from the header global search. */
  initialQuery?: string;
  onSelectCourse: (id: string) => void;
  onMountLocalFolder: () => void;
  scanReport?: MediaScanReport | null;
  onDismissReport?: () => void;
  onUpdateBookProgress?: () => void;
  onDocumentImported?: () => void;
  onStudyResource?: (resourceId: string, mode?: 'flashcards' | 'practice' | 'mixed') => void;
  onExplainResource?: (resourceId: string, label: string) => void;
  onOpenResource?: (resourceId: string) => void;
  onOpenNote?: (noteId: string) => void;
  onOpenConcept?: (conceptId: string) => void;
  /** Opens the Goals view, optionally with one goal selected. */
  onOpenGoals?: (goalId?: string) => void;
  onOpenDemoSelector?: () => void;
}

export const Library: React.FC<LibraryProps> = ({ 
  courses, 
  books, 
  initialQuery,
  onSelectCourse, 
  onMountLocalFolder,
  scanReport,
  onDismissReport,
  onUpdateBookProgress,
  onDocumentImported,
  onStudyResource,
  onExplainResource,
  onOpenResource,
  onOpenNote,
  onOpenConcept,
  onOpenGoals,
  onOpenDemoSelector,
}) => {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<'all' | 'courses' | 'books'>('all');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  // The header global search becomes this view's filter.
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [inputPage, setInputPage] = useState<string>('');
  const [bookFeedback, setBookFeedback] = useState<{ id: string; msg: string; isError?: boolean } | null>(null);

  // Local document import flow state with Preview
  const [isImporting, setIsImporting] = useState(false);
  const [ingestionProgress, setIngestionProgress] = useState<IngestionProgress | null>(null);
  const [ingestionReport, setIngestionReport] = useState<{ total: number; success: number; duplicates: number; errors: number; details: string[] } | null>(null);
  const [previewDoc, setPreviewDoc] = useState<{
    file: File;
    parsed: import('../lib/localIngestion/types.ts').ParsedDocument;
    isDuplicate: boolean;
    existingResourceId?: string;
  } | null>(null);
  const [previewDestinationType, setPreviewDestinationType] = useState<import('../lib/localIngestion/types.ts').ResourceDestinationType>('standalone');
  const [previewTargetId, setPreviewTargetId] = useState<string>('');
  const [previewEnableSemantic, setPreviewEnableSemantic] = useState<boolean>(false);
  const [sourceViewerMeta, setSourceViewerMeta] = useState<{
    isOpen: boolean;
    data?: { resource: LearningResource | null; sourceType: string; fileName?: string; fingerprint?: string; sectionCount: number; notesCount: number };
  }>({ isOpen: false });

  // Unified local search and orphan-resource organization
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [unorganized, setUnorganized] = useState<UnorganizedResource[]>([]);
  const [organizeTarget, setOrganizeTarget] = useState<Record<string, string>>({});
  const [organizeFeedback, setOrganizeFeedback] = useState<string | null>(null);

  const [isCreateCourseOpen, setIsCreateCourseOpen] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', description: '', category: 'General', instructor: '' });
  const [courseError, setCourseError] = useState<string | null>(null);

  const [editingBookMeta, setEditingBookMeta] = useState<string | null>(null);
  const [bookMetaForm, setBookMetaForm] = useState({ author: '', pageCount: '' });

  const refreshUnorganized = React.useCallback(async () => {
    try {
      setUnorganized(await dao.getUnorganizedResources());
    } catch (err) {
      console.warn('No se pudieron cargar los recursos sin organizar:', err);
    }
  }, []);

  useEffect(() => {
    refreshUnorganized();
  }, [refreshUnorganized, courses, books]);

  useEffect(() => {
    const q = deferredQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    dao.searchKnowledge(q)
      .then(res => { if (!cancelled) setSearchResults(res); })
      .catch(err => console.warn('Local search failed:', err))
      .finally(() => { if (!cancelled) setIsSearching(false); });
    return () => { cancelled = true; };
  }, [deferredQuery, courses, books]);

  // Keyboard accessibility: Escape closes the active top dialog
  // (preview, source viewer, or course creation). These dialogs sit ABOVE the
  // AI drawer, so they are registered as one overlay and only the topmost
  // overlay reacts to Escape.
  useEffect(() => {
    const anyOpen = !!previewDoc || sourceViewerMeta.isOpen || isCreateCourseOpen;
    if (!anyOpen) return;
    pushOverlay('library-dialogs');
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isTopOverlay('library-dialogs')) return;
      if (previewDoc) setPreviewDoc(null);
      else if (sourceViewerMeta.isOpen) setSourceViewerMeta({ isOpen: false });
      else if (isCreateCourseOpen) setIsCreateCourseOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      removeOverlay('library-dialogs');
    };
  }, [previewDoc, sourceViewerMeta.isOpen, isCreateCourseOpen]);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setCourseError(null);
    const res = await dao.createCourse({
      title: courseForm.title,
      description: courseForm.description,
      category: courseForm.category,
      instructor: courseForm.instructor
    });
    if (!res.success) {
      setCourseError(res.error || 'No se pudo crear el curso.');
      return;
    }
    setCourseForm({ title: '', description: '', category: 'General', instructor: '' });
    setIsCreateCourseOpen(false);
    if (onUpdateBookProgress) onUpdateBookProgress();
  };

  const handleOrganizeResource = async (resourceId: string) => {
    const courseId = organizeTarget[resourceId];
    if (!courseId) return;
    const res = await dao.createKnowledgeConnection({ sourceId: courseId, targetId: resourceId, relationType: 'references' });
    setOrganizeFeedback(res.success ? 'Recurso asociado al curso correctamente.' : (res.error || 'No se pudo asociar.'));
    if (res.success) {
      await refreshUnorganized();
      if (onDocumentImported) onDocumentImported();
    }
  };

  const handleSaveBookMeta = async (book: Book) => {
    const pageCount = bookMetaForm.pageCount ? parseInt(bookMetaForm.pageCount, 10) : undefined;
    if (pageCount !== undefined && (isNaN(pageCount) || pageCount <= 0)) {
      setBookFeedback({ id: book.id, msg: t('library.errPagesPositive'), isError: true });
      return;
    }
    const res = await dao.updateBookDetails(book.id, {
      author: bookMetaForm.author || undefined,
      pageCount
    });
    if (res.success) {
      setEditingBookMeta(null);
      setBookFeedback({ id: book.id, msg: 'Metadatos del libro actualizados.', isError: false });
      if (onUpdateBookProgress) onUpdateBookProgress();
    } else {
      setBookFeedback({ id: book.id, msg: res.error || 'Error al actualizar el libro.', isError: true });
    }
  };

  const handleSearchResultNavigate = (result: SearchResult) => {
    const dest = resolveSearchResultDestination(result);
    switch (dest.tab) {
      case 'course':
        onSelectCourse(dest.resourceId);
        break;
      case 'note':
        onOpenNote?.(dest.noteId);
        break;
      case 'concept':
        onOpenConcept?.(dest.conceptId);
        break;
      case 'resource':
        onOpenResource?.(dest.resourceId);
        break;
      case 'goals':
        onOpenGoals?.(dest.goalId);
        break;
      default:
        break;
    }
  };

  const RESULT_ICONS: Partial<Record<GraphNodeType | 'goal', React.ComponentType<{ size?: number; className?: string }>>> = {
    course: GraduationCap,
    book: BookOpen,
    module: Layers,
    lesson: FileText,
    note: FileText,
    concept: Lightbulb,
    practice: ClipboardList,
    resource: BookOpen,
    goal: Target
  };

  /** Localized label for the search-result type. Defaults to Spanish. */
  const SEARCH_TYPE_LABELS: Partial<Record<SearchResult['type'], string>> = {
    course: t('graph.node.course'),
    book: t('graph.node.book'),
    module: t('graph.node.module'),
    lesson: t('graph.node.lesson'),
    note: t('graph.node.note'),
    concept: t('graph.node.concept'),
    practice: t('graph.node.practice'),
    resource: t('graph.node.resource'),
    goal: t('search.type.goal')
  };

  const [isWindowDragging, setIsWindowDragging] = useState(false);
  const [isDropzoneDragging, setIsDropzoneDragging] = useState(false);
  const dragCounterRef = useRef(0);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleTriggerFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  /**
   * Processes a list of selected or dropped files.
   * With 1 compatible file, opens the preview modal.
   * With multiple files, ingests them in a batch with a progress report.
   */
  const processIncomingFiles = useCallback(async (incoming: File[] | FileList | null | undefined) => {
    const validFiles = filterSupportedFiles(incoming);
    if (!validFiles || validFiles.length === 0) return;

    // Single file: open the preview modal with validation and destination choice
    if (validFiles.length === 1) {
      const file = validFiles[0];
      try {
        const parsed = await localIngestionService.parseFile(file);
        const existingId = await localIngestionService.findExistingResourceByFingerprint(parsed.fingerprint);
        setPreviewDoc({
          file,
          parsed,
          isDuplicate: existingId !== null,
          existingResourceId: existingId || undefined
        });
        setPreviewDestinationType(parsed.fileType === 'pdf' || parsed.fileType === 'epub' ? 'book' : 'standalone');
        setPreviewTargetId('');
        return;
      } catch (err: any) {
        setIngestionReport({
          total: 1,
          success: 0,
          duplicates: 0,
          errors: 1,
          details: [err?.message || 'Error al procesar el archivo.']
        });
        return;
      }
    }

    // Multiple files: process as a batch
    setIsImporting(true);
    setIngestionReport(null);
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const fileList = validFiles;
    try {
      const results = await localIngestionService.ingestBatch(fileList, {
        signal: controller.signal,
        onProgress: (p) => setIngestionProgress(p)
      });

      let successCount = 0;
      let dupCount = 0;
      let errorCount = 0;
      const details: string[] = [];

      for (const res of results) {
        if (res.isDuplicate) {
          dupCount++;
          details.push(`↷ Omitido por duplicado (mismo SHA-256): ${res.title}`);
        } else if (res.success) {
          successCount++;
          details.push(`✓ Importado: ${res.title} (${res.fileType.toUpperCase()}, ${res.sectionsCount} secciones)`);
        } else {
          errorCount++;
          details.push(`✕ Fallo en ${res.title}: ${res.error || 'Error'}`);
        }
      }

      setIngestionReport({
        total: fileList.length,
        success: successCount,
        duplicates: dupCount,
        errors: errorCount,
        details
      });

      if (successCount > 0) {
        if (onUpdateBookProgress) onUpdateBookProgress();
        if (onDocumentImported) onDocumentImported();
      }
    } catch (err: any) {
      setIngestionReport({
        total: fileList.length,
        success: 0,
        duplicates: 0,
        errors: fileList.length,
        details: [err?.message || t('library.errImport')]
      });
    } finally {
      setIsImporting(false);
      setIngestionProgress(null);
      abortControllerRef.current = null;
    }
  }, [onUpdateBookProgress, onDocumentImported, t]);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processIncomingFiles(files);
  };

  // Global window listeners for drag-and-drop file handling
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        dragCounterRef.current += 1;
        setIsWindowDragging(true);
      }
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsWindowDragging(false);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsWindowDragging(false);
      setIsDropzoneDragging(false);
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        await processIncomingFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [processIncomingFiles]);

  const handleConfirmPreviewImport = async () => {
    if (!previewDoc) return;
    setIsImporting(true);
    const { file } = previewDoc;

    try {
      const res = await localIngestionService.ingestFile(file, {
        destination: {
          type: previewDestinationType,
          targetId: previewTargetId || undefined
        },
        importAsBook: previewDestinationType === 'book',
        enableSemanticIndexing: previewEnableSemantic
      });

      if (res.isDuplicate) {
        setIngestionReport({
          total: 1,
          success: 0,
          duplicates: 1,
          errors: 0,
          details: [`↷ Documento ya importado previamente con la misma huella SHA-256: "${res.title}".`]
        });
      } else if (res.success) {
        setIngestionReport({
          total: 1,
          success: 1,
          duplicates: 0,
          errors: 0,
          details: [`✓ Documento importado correctamente: "${res.title}" (${res.sectionsCount} fragmentos).`]
        });
        if (onUpdateBookProgress) onUpdateBookProgress();
        if (onDocumentImported) onDocumentImported();
      }
    } catch (err: any) {
      setIngestionReport({
        total: 1,
        success: 0,
        duplicates: 0,
        errors: 1,
        details: [err?.message || 'Error al guardar el documento.']
      });
    } finally {
      setIsImporting(false);
      setPreviewDoc(null);
    }
  };

  const handleOpenSourceViewer = async (resourceId: string) => {
    const data = await dao.getResourceSourceMeta(resourceId);
    setSourceViewerMeta({
      isOpen: true,
      data
    });
  };

  const handleCancelIngestion = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const handleStartEdit = (book: Book) => {
    setEditingBookId(book.id);
    setInputPage(String(book.current_page || 0));
    setBookFeedback(null);
  };

  const handleSaveProgress = async (book: Book) => {
    const pageNum = parseInt(inputPage, 10);
    if (isNaN(pageNum)) {
      setBookFeedback({ id: book.id, msg: t('library.errPageInvalid'), isError: true });
      return;
    }

    const totalPages = book.page_count ?? 0;
    const res = await dao.updateBookProgress(book.id, pageNum, totalPages);
    if (res.success) {
      const clamped = Math.max(0, Math.min(pageNum, totalPages));
      const pct = totalPages > 0 ? Math.round((clamped / totalPages) * 100) : 0;
      setEditingBookId(null);
      setBookFeedback({
        id: book.id,
        msg: `Progreso actualizado: pág. ${clamped}/${book.page_count} (${pct}%)`,
        isError: false
      });
      if (onUpdateBookProgress) {
        onUpdateBookProgress();
      }
    } else {
      setBookFeedback({ id: book.id, msg: res.error || 'Error al actualizar progreso.', isError: true });
    }
  };

  const filteredCourses = useMemo(() => {
    const q = deferredQuery.toLowerCase();
    return courses.filter(c => 
      (filter === 'all' || filter === 'courses') && 
      (c.title.toLowerCase().includes(q) || c.category.toLowerCase().includes(q))
    );
  }, [courses, filter, deferredQuery]);

  const filteredBooks = useMemo(() => {
    const q = deferredQuery.toLowerCase();
    return books.filter(b => 
      (filter === 'all' || filter === 'books') && 
      (b.title.toLowerCase().includes(q) || b.author?.toLowerCase().includes(q))
    );
  }, [books, filter, deferredQuery]);

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';
  const LABEL_CLS = 'mb-1 block text-meta font-medium text-muted';

  return (
    <div className="space-y-6 animate-fade-in">
      <CatalogFilterBar
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        onCreateCourse={() => { setCourseError(null); setIsCreateCourseOpen(true); }}
        onImportDocuments={handleTriggerFilePicker}
        onMountLocalFolder={onMountLocalFolder}
        isImporting={isImporting}
        fileInputRef={fileInputRef}
        onFilesSelected={handleFilesSelected}
      >

      {isImporting && ingestionProgress && (
        <InlineStatus tone="info" className="justify-between">
          <span className="flex items-center gap-3">
            <Loader2 size={16} className="animate-spin shrink-0" aria-hidden="true" />
            <span>
              Procesando archivo ({ingestionProgress.currentFileIndex}/{ingestionProgress.totalFiles}):{' '}
              <strong className="font-mono">{ingestionProgress.fileName}</strong>
              <span className="mt-0.5 block">{ingestionProgress.message}</span>
            </span>
          </span>
          <button
            onClick={handleCancelIngestion}
            className="shrink-0 rounded-md border border-error/40 px-2 py-1 text-meta font-medium text-error hover:bg-error-soft"
          >
            Cancelar
          </button>
        </InlineStatus>
      )}

      {ingestionReport && (
        <InlineStatus tone={ingestionReport.errors > 0 ? 'warning' : 'success'} className="justify-between">
          <span className="min-w-0">
            <strong>Resultado de importación ({ingestionReport.total} archivo{ingestionReport.total !== 1 ? 's' : ''})</strong>
            <span className="mt-1 flex flex-wrap gap-x-4">
              <span>✓ Importados: <strong>{ingestionReport.success}</strong></span>
              {ingestionReport.duplicates > 0 && <span>↷ Duplicados omitidos: {ingestionReport.duplicates}</span>}
              {ingestionReport.errors > 0 && <span>✕ Errores: {ingestionReport.errors}</span>}
            </span>
            <span className="mt-1 block max-h-24 overflow-y-auto">
              {ingestionReport.details.slice(0, 5).map((d, i) => (
                <span key={i} className="block">{d}</span>
              ))}
            </span>
          </span>
          <button
            onClick={() => setIngestionReport(null)}
            aria-label="Cerrar reporte"
            className="shrink-0 opacity-70 hover:opacity-100"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </InlineStatus>
      )}

      {scanReport && (
        <InlineStatus tone="info" className="justify-between">
          <span className="flex min-w-0 items-start gap-3">
            <FolderCheck size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              <strong>Carpeta vinculada:</strong>{' '}
              <span className="font-mono">"{scanReport.directoryName}"</span>
              <span className="mt-1 flex flex-wrap gap-x-4">
                <span>Archivos multimedia encontrados: <strong>{scanReport.totalDiscovered}</strong></span>
                <span>✓ Lecciones emparejadas: <strong>{scanReport.matchedCount}</strong></span>
                {scanReport.unmatchedCount > 0 && <span>○ Archivos sin emparejar: {scanReport.unmatchedCount}</span>}
                {scanReport.ambiguousMatches.length > 0 && (
                  <span className="flex items-center gap-1">
                    <AlertTriangle size={12} aria-hidden="true" /> Ambigüedades detectadas: {scanReport.ambiguousMatches.length}
                  </span>
                )}
              </span>
            </span>
          </span>
          {onDismissReport && (
            <button
              onClick={onDismissReport}
              aria-label="Cerrar aviso"
              className="shrink-0 opacity-70 hover:opacity-100"
            >
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </InlineStatus>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDropzoneDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDropzoneDragging(false);
        }}
        onDrop={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsDropzoneDragging(false);
          setIsWindowDragging(false);
          dragCounterRef.current = 0;
          if (e.dataTransfer && e.dataTransfer.files.length > 0) {
            await processIncomingFiles(e.dataTransfer.files);
          }
        }}
        onClick={handleTriggerFilePicker}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handleTriggerFilePicker();
          }
        }}
        className={cn(
          'group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-6 text-center transition-all duration-fast cursor-pointer select-none',
          isDropzoneDragging
            ? 'border-accent bg-accent-soft/40 shadow-sm scale-[1.005]'
            : 'border-line hover:border-accent/40 hover:bg-surface/60 bg-surface/30'
        )}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent transition-transform duration-fast group-hover:scale-110">
          <UploadCloud size={22} aria-hidden="true" />
        </div>
        <p className="type-item mt-3 text-ink">
          Arrastra y suelta documentos aquí o <span className="text-accent underline underline-offset-2">selecciona archivos</span>
        </p>
        <p className="type-meta mt-1 text-muted">
          Formatos admitidos: <strong>.pdf</strong>, <strong>.epub</strong>, <strong>.md</strong>, <strong>.txt</strong> (procesamiento 100% local en tu navegador)
        </p>
      </div>

      </CatalogFilterBar>

      {/* Unified local search (no embeddings, works offline) */}
      {query.trim().length >= 2 && (
        <Panel className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="type-micro flex items-center gap-2">
              <Search size={13} className="text-accent" aria-hidden="true" />
              Resultados locales ({searchResults.length})
            </h2>
            {isSearching && <Loader2 size={13} className="animate-spin text-accent" aria-hidden="true" />}
          </div>
          {searchResults.length === 0 && !isSearching ? (
            <p className="type-meta">
              Sin coincidencias en cursos, libros, lecciones, notas, conceptos, recursos importados o metas.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {searchResults.slice(0, 20).map(result => {
                const Icon = RESULT_ICONS[result.type] || FileText;
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      onClick={() => handleSearchResultNavigate(result)}
                      aria-label={`Abrir ${result.type}: ${result.title}`}
                      className="flex w-full items-start gap-2 rounded-lg border border-line bg-canvas p-2 text-left transition-colors duration-fast hover:border-accent/40 hover:bg-accent-soft/40"
                    >
                      <Icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-meta font-semibold text-ink">{result.title}</span>
                        {result.subtitle && <span className="block truncate text-micro">{result.subtitle}</span>}
                        <span className="type-micro block">{SEARCH_TYPE_LABELS[result.type] ?? result.type}</span>
                      </span>
                      <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-faint" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      <UnorganizedResourcesSection
        unorganized={unorganized}
        organizeFeedback={organizeFeedback}
        organizeTarget={organizeTarget}
        onOrganizeTargetChange={(resourceId, courseId) =>
          setOrganizeTarget((prev) => ({ ...prev, [resourceId]: courseId }))
        }
        onOrganizeResource={handleOrganizeResource}
        courses={courses}
        onOpenResource={onOpenResource}
        onStudyResource={onStudyResource}
      />

      {(filter === 'all' || filter === 'courses') && (
        <section>
          <SectionHeading
            title={`Cursos (${filteredCourses.length})`}
            description={t('library.coursesDescription')}
          />
          {filteredCourses.length === 0 ? (
            <EmptyState
              title={t('library.emptyCoursesTitle')}
              hint={t('library.emptyCoursesHint')}
              action={
                onOpenDemoSelector ? (
                  <Button variant="outline" size="sm" onClick={onOpenDemoSelector}>
                    <Sparkles size={14} aria-hidden="true" />
                    {t('library.exploreDemos')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {filteredCourses.map(course => (
                <button
                  key={course.id}
                  onClick={() => onSelectCourse(course.id)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-line bg-surface text-left shadow-card transition-colors duration-fast hover:border-accent/40"
                >
                  <span className="relative block h-36 border-b border-line bg-canvas">
                    {course.cover_path ? (
                      <img src={course.cover_path} alt="" aria-hidden="true" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center bg-accent-soft text-accent">
                        <Layers size={32} aria-hidden="true" />
                      </span>
                    )}
                    <span className="absolute right-2 top-2">
                      <Badge tone="neutral">{course.difficulty}</Badge>
                    </span>
                  </span>
                  <span className="flex flex-1 flex-col p-4">
                    <span className="type-item line-clamp-1 text-ink group-hover:text-accent">{course.title}</span>
                    <span className="type-meta mt-1 line-clamp-2 flex-1">{course.description}</span>
                    <span className="mt-3 flex items-center justify-between border-t border-line pt-3">
                      <span className="text-meta text-muted">
                        {course.completed_lessons || 0}/{course.total_lessons || 0} lecciones
                      </span>
                      <span className="flex items-center gap-1 text-meta font-semibold text-accent">
                        Ver curso <Play size={12} aria-hidden="true" />
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      )}

      {(filter === 'all' || filter === 'books') && (
        <section className="pt-2">
          <SectionHeading
            title={`Libros y manuales (${filteredBooks.length})`}
            description={t('library.booksDescription')}
          />
          {filteredBooks.length === 0 ? (
            <EmptyState title={t('library.emptyBooksTitle')} hint={t('library.emptyBooksHint')} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredBooks.map(book => (
                <div key={book.id} className="flex gap-3 rounded-xl border border-line bg-surface p-4 shadow-card">
                  {book.cover_path ? (
                    <img src={book.cover_path} alt="" aria-hidden="true" className="h-24 w-16 shrink-0 rounded border border-line object-cover" />
                  ) : (
                    <span className="flex h-24 w-16 shrink-0 items-center justify-center rounded border border-line bg-accent-soft text-accent">
                      <BookOpen size={22} aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="type-micro">{book.category}</span>
                      <button
                        onClick={() => handleStartEdit(book)}
                        className="text-meta text-muted underline underline-offset-2 hover:text-ink"
                        title={t('library.updatePageTitle')}
                      >
                        {editingBookId === book.id ? 'Cancelar' : 'Editar'}
                      </button>
                    </div>
                    <h4 className="type-item truncate text-ink">
                      <button
                        type="button"
                        onClick={() => onOpenResource?.(book.id)}
                        className="block w-full truncate text-left transition hover:text-accent"
                        aria-label={`Abrir recurso ${book.title}`}
                        title="Abrir el detalle del recurso"
                      >
                        {book.title}
                      </button>
                    </h4>
                    <p className="type-meta truncate">{book.author}</p>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <button
                        onClick={() => handleOpenSourceViewer(book.id)}
                        className="text-meta text-accent underline underline-offset-2 hover:opacity-80"
                      >
                        Origen del recurso
                      </button>
                      <button
                        onClick={() => onStudyResource?.(book.id, 'flashcards')}
                        className="flex items-center gap-0.5 text-meta text-muted hover:text-ink"
                      >
                        <Brain size={11} aria-hidden="true" /> Repasar
                      </button>
                      <button
                        onClick={() => onStudyResource?.(book.id, 'practice')}
                        className="flex items-center gap-0.5 text-meta text-muted hover:text-ink"
                      >
                        <ListChecks size={11} aria-hidden="true" /> Practicar
                      </button>
                    </div>

                    <BookProgressEditor
                      book={book}
                      isEditingMeta={editingBookMeta === book.id}
                      onToggleMeta={() => {
                        setEditingBookMeta(editingBookMeta === book.id ? null : book.id);
                        setBookMetaForm({ author: book.author || '', pageCount: String(book.page_count || '') });
                      }}
                      metaForm={bookMetaForm}
                      onMetaFormChange={setBookMetaForm}
                      onSaveMeta={handleSaveBookMeta}
                      isEditingProgress={editingBookId === book.id}
                      onToggleProgress={() => setEditingBookId(null)}
                      inputPage={inputPage}
                      onInputPageChange={setInputPage}
                      onSaveProgress={handleSaveProgress}
                      onExplain={onExplainResource ? () => onExplainResource(book.id, book.title) : undefined}
                    />

                    {editingBookId !== book.id && (
                      <div
                        className="mt-2 cursor-pointer group/progress rounded-lg p-1.5 -m-1.5 hover:bg-canvas/60 transition-colors"
                        onClick={() => handleStartEdit(book)}
                        title="Haz clic para actualizar tu progreso de lectura"
                      >
                        <div className="mb-1 flex items-center justify-between">
                          <span className="text-meta group-hover/progress:text-accent group-hover/progress:underline underline-offset-2">
                            {book.current_page || 0}/{book.page_count} pág
                          </span>
                          <span className="text-meta font-semibold text-muted">{book.reading_percentage}%</span>
                        </div>
                        <ProgressBar value={book.reading_percentage || 0} label={`Lectura de ${book.title}`} />
                      </div>
                    )}

                    {bookFeedback && bookFeedback.id === book.id && (
                      <div className={cn('mt-1.5 flex items-center gap-1 text-meta', bookFeedback.isError ? 'text-error' : 'text-success')}>
                        {bookFeedback.isError ? <AlertTriangle size={11} aria-hidden="true" /> : <CheckCircle size={11} aria-hidden="true" />}
                        <span>{bookFeedback.msg}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Document preview modal before persisting */}
      <DocumentImportModal
        previewDoc={previewDoc}
        previewDestinationType={previewDestinationType}
        onDestinationTypeChange={setPreviewDestinationType}
        previewTargetId={previewTargetId}
        onTargetIdChange={setPreviewTargetId}
        previewEnableSemantic={previewEnableSemantic}
        onEnableSemanticChange={setPreviewEnableSemantic}
        isImporting={isImporting}
        courses={courses}
        onClose={() => setPreviewDoc(null)}
        onConfirm={handleConfirmPreviewImport}
      />

      <DocumentProvenanceModal
        isOpen={sourceViewerMeta.isOpen}
        data={sourceViewerMeta.data}
        onClose={() => setSourceViewerMeta({ isOpen: false })}
      />

      <CourseCreationModal
        isOpen={isCreateCourseOpen}
        onClose={() => setIsCreateCourseOpen(false)}
        onSubmit={handleCreateCourse}
        form={courseForm}
        onChange={setCourseForm}
        error={courseError}
      />

      {/* Full-screen overlay while dragging files anywhere in the window */}
      {isWindowDragging && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/80 backdrop-blur-sm pointer-events-none animate-fade-in"
          aria-hidden="true"
        >
          <div className="m-6 flex max-w-lg flex-col items-center justify-center rounded-2xl border-4 border-dashed border-accent bg-surface/90 p-10 text-center shadow-overlay animate-scale-in">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-accent-soft text-accent">
              <UploadCloud size={40} className="animate-bounce" />
            </div>
            <h3 className="type-title mt-5 text-ink">Suelta tus documentos aquí</h3>
            <p className="type-secondary mt-2">
              Importaremos tus archivos (.pdf, .epub, .md, .txt) directamente a tu biblioteca local.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
