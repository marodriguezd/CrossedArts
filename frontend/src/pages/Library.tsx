import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Course, Book, SearchResult, UnorganizedResource, GraphNodeType } from '../types/models.ts';
import { Search, FolderOpen, Play, BookOpen, Layers, Plus, CheckCircle, AlertTriangle, FolderCheck, X, Bookmark, Edit3, Check, FileUp, Loader2, Link2, GraduationCap, FileText, Lightbulb, Brain, Sparkles, ListChecks, ArrowUpRight, UploadCloud } from 'lucide-react';
import { resolveSearchResultDestination, filterSupportedFiles, adjustBookPage } from '../services/domainLogic.ts';
import type { MediaScanReport } from '../services/localMediaService.ts';
import { dao } from '../db/dao.ts';
import { localIngestionService } from '../lib/localIngestion/service.ts';
import type { IngestionProgress } from '../lib/localIngestion/types.ts';
import { Button, Chip, SearchInput, Panel, SectionHeading, Badge, InlineStatus, ProgressBar, EmptyState, cn } from '../components/ui/index.tsx';

interface LibraryProps {
  courses: Course[];
  books: Book[];
  /** Consulta proveniente de la búsqueda global de la cabecera. */
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
  onOpenConcept
}) => {
  const [filter, setFilter] = useState<'all' | 'courses' | 'books'>('all');
  const [query, setQuery] = useState('');

  // La búsqueda global de la cabecera se convierte en el filtro de esta vista.
  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery]);

  const [editingBookId, setEditingBookId] = useState<string | null>(null);
  const [inputPage, setInputPage] = useState<string>('');
  const [bookFeedback, setBookFeedback] = useState<{ id: string; msg: string; isError?: boolean } | null>(null);

  // Estado del flujo de importación de documentos locales con Preview
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
    data?: { resource: any; sourceType: string; fileName?: string; fingerprint?: string; sectionCount: number; notesCount: number };
  }>({ isOpen: false });

  // Búsqueda local unificada y organización de recursos huérfanos
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [unorganized, setUnorganized] = useState<UnorganizedResource[]>([]);
  const [organizeTarget, setOrganizeTarget] = useState<Record<string, string>>({});
  const [organizeFeedback, setOrganizeFeedback] = useState<string | null>(null);

  // Creación de cursos
  const [isCreateCourseOpen, setIsCreateCourseOpen] = useState(false);
  const [courseForm, setCourseForm] = useState({ title: '', description: '', category: 'General', instructor: '' });
  const [courseError, setCourseError] = useState<string | null>(null);

  // Edición de metadatos del libro
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
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    setIsSearching(true);
    dao.searchKnowledge(q)
      .then(res => { if (!cancelled) setSearchResults(res); })
      .catch(err => console.warn('Error en búsqueda local:', err))
      .finally(() => { if (!cancelled) setIsSearching(false); });
    return () => { cancelled = true; };
  }, [query, courses, books]);

  // Accesibilidad de teclado: Escape cierra el diálogo superior activo
  // (previsualización, visor de origen o alta de curso).
  useEffect(() => {
    const anyOpen = !!previewDoc || sourceViewerMeta.isOpen || isCreateCourseOpen;
    if (!anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewDoc) setPreviewDoc(null);
      else if (sourceViewerMeta.isOpen) setSourceViewerMeta({ isOpen: false });
      else if (isCreateCourseOpen) setIsCreateCourseOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
      setBookFeedback({ id: book.id, msg: 'El número de páginas debe ser mayor que cero.', isError: true });
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
      default:
        break;
    }
  };

  const RESULT_ICONS: Record<GraphNodeType, React.ComponentType<{ size?: number; className?: string }>> = {
    course: GraduationCap,
    book: BookOpen,
    module: Layers,
    lesson: FileText,
    note: FileText,
    concept: Lightbulb,
    resource: BookOpen
  };

  // Estado de arrastrar y soltar (Drag and Drop)
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
   * Procesa una lista de archivos seleccionados o arrastrados.
   * Si es 1 archivo compatible, abre el modal de previsualización.
   * Si son múltiples archivos, los ingesta en lote con reporte de progreso.
   */
  const processIncomingFiles = useCallback(async (incoming: File[] | FileList | null | undefined) => {
    const validFiles = filterSupportedFiles(incoming);
    if (!validFiles || validFiles.length === 0) return;

    // Si es un único archivo, abrir modal de preview con validación y elección de destino
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

    // Si es lote múltiple, procesar en batch
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
        details: [err?.message || 'Error durante la importación de archivos.']
      });
    } finally {
      setIsImporting(false);
      setIngestionProgress(null);
      abortControllerRef.current = null;
    }
  }, [onUpdateBookProgress, onDocumentImported]);

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    await processIncomingFiles(files);
  };

  // Eventos globales de ventana para arrastrar y soltar archivos
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
      setBookFeedback({ id: book.id, msg: 'Introduce un número de página válido.', isError: true });
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

  const filteredCourses = courses.filter(c => 
    (filter === 'all' || filter === 'courses') && 
    (c.title.toLowerCase().includes(query.toLowerCase()) || c.category.toLowerCase().includes(query.toLowerCase()))
  );

  const filteredBooks = books.filter(b => 
    (filter === 'all' || filter === 'books') && 
    (b.title.toLowerCase().includes(query.toLowerCase()) || b.author?.toLowerCase().includes(query.toLowerCase()))
  );

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';
  const LABEL_CLS = 'mb-1 block text-meta font-medium text-muted';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Cabecera de página y acciones */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Biblioteca</h1>
          <p className="type-secondary mt-1">
            Explora y organiza todos tus recursos de aprendizaje.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Input oculto para selección de archivos */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFilesSelected}
            multiple
            accept=".txt,.md,.markdown,.pdf,.epub"
            className="hidden"
          />

          <Button
            variant="outline"
            onClick={() => { setCourseError(null); setIsCreateCourseOpen(true); }}
            title="Crear un curso estructurado"
          >
            <Plus size={15} aria-hidden="true" />
            Crear curso
          </Button>

          <Button
            variant="outline"
            onClick={handleTriggerFilePicker}
            disabled={isImporting}
            title="Importar documentos locales (.txt, .md, .pdf, .epub)"
          >
            {isImporting ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <FileUp size={15} aria-hidden="true" />}
            {isImporting ? 'Importando…' : 'Importar documentos'}
          </Button>

          <Button
            variant="outline"
            onClick={onMountLocalFolder}
            title="Escanear carpeta local con File System Access API"
          >
            <FolderOpen size={15} aria-hidden="true" />
            Vincular carpeta local
          </Button>
        </div>
      </div>

      {/* Progreso de importación de documentos */}
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

      {/* Reporte de importación */}
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

      {/* Reporte de escaneo de carpeta local */}
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

      {/* Zona visual para arrastrar y soltar archivos (Dropzone Card) */}
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

      {/* Búsqueda y filtros */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          label="Buscar por título, autor o tema"
          placeholder="Buscar por título, autor o tema…"
          value={query}
          onChange={setQuery}
          className="sm:w-80"
        />
        <div className="flex items-center gap-1.5" role="group" aria-label="Filtrar por tipo">
          {(['all', 'courses', 'books'] as const).map(mode => (
            <Chip key={mode} active={filter === mode} onClick={() => setFilter(mode)}>
              {mode === 'all' ? 'Todo' : mode === 'courses' ? 'Cursos' : 'Libros'}
            </Chip>
          ))}
        </div>
      </div>

      {/* Búsqueda local unificada (sin embeddings, funciona offline) */}
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
              Sin coincidencias en cursos, libros, lecciones, notas, conceptos o recursos importados.
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
                        <span className="type-micro block">{result.type}</span>
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

      {/* Recursos sin organizar */}
      {unorganized.length > 0 && (
        <Panel className="border-warning/40 p-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="type-micro flex items-center gap-2 text-warning">
              <Link2 size={13} aria-hidden="true" />
              Recursos sin organizar ({unorganized.length})
            </h2>
            {organizeFeedback && <span className="type-meta">{organizeFeedback}</span>}
          </div>
          <p className="type-meta">
            Documentos importados que aún no están asociados a ningún curso, libro o concepto.
          </p>
          <ul className="mt-3 space-y-2">
            {unorganized.map(item => (
              <li key={item.resource.id} className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-meta font-semibold text-ink">{item.resource.title}</p>
                  <p className="type-meta">{item.noteCount} fragmentos de estudio · sin conexiones</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onOpenResource?.(item.resource.id)}
                    aria-label={`Abrir recurso ${item.resource.title}`}
                  >
                    <ArrowUpRight size={12} aria-hidden="true" /> Abrir
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onStudyResource?.(item.resource.id, 'mixed')}
                    aria-label={`Estudiar recurso ${item.resource.title}`}
                  >
                    <Brain size={12} aria-hidden="true" /> Estudiar
                  </Button>
                  <select
                    value={organizeTarget[item.resource.id] || ''}
                    onChange={e => setOrganizeTarget(prev => ({ ...prev, [item.resource.id]: e.target.value }))}
                    className="rounded-lg border border-line bg-canvas px-2 py-1.5 text-meta text-ink focus:border-accent/50 focus:outline-none"
                    aria-label={`Asociar ${item.resource.title} a un curso`}
                  >
                    <option value="">Elegir curso…</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <Button
                    size="sm"
                    variant="solid"
                    onClick={() => handleOrganizeResource(item.resource.id)}
                    disabled={!organizeTarget[item.resource.id]}
                  >
                    Asociar
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {/* Cursos */}
      {(filter === 'all' || filter === 'courses') && (
        <section>
          <SectionHeading
            title={`Cursos (${filteredCourses.length})`}
            description="Cursos estructurados con módulos y lecciones."
          />
          {filteredCourses.length === 0 ? (
            <EmptyState title="Sin cursos" hint="Crea un curso o ajusta la búsqueda." />
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

      {/* Libros */}
      {(filter === 'all' || filter === 'books') && (
        <section className="pt-2">
          <SectionHeading
            title={`Libros y manuales (${filteredBooks.length})`}
            description="Lecturas con progreso de páginas y acciones de estudio."
          />
          {filteredBooks.length === 0 ? (
            <EmptyState title="Sin libros" hint="Importa un PDF o EPUB para añadirlo a la biblioteca." />
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
                        title="Actualizar página actual"
                      >
                        {editingBookId === book.id ? 'Cancelar' : 'Editar'}
                      </button>
                    </div>
                    <h4 className="type-item truncate text-ink">{book.title}</h4>
                    <p className="type-meta truncate">{book.author}</p>

                    {/* Acciones del recurso: fuentes, estudio, explicación y metadatos */}
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
                      <button
                        onClick={() => onExplainResource?.(book.id, book.title)}
                        className="flex items-center gap-0.5 text-meta text-accent hover:opacity-80"
                      >
                        <Sparkles size={11} aria-hidden="true" /> Explicar
                      </button>
                      <button
                        onClick={() => {
                          setEditingBookMeta(editingBookMeta === book.id ? null : book.id);
                          setBookMetaForm({ author: book.author || '', pageCount: String(book.page_count || '') });
                        }}
                        className="flex items-center gap-0.5 text-meta text-muted hover:text-ink"
                      >
                        <Edit3 size={11} aria-hidden="true" /> Metadatos
                      </button>
                    </div>

                    {editingBookMeta === book.id && (
                      <div className="mt-2 space-y-1.5 rounded-lg border border-line bg-canvas p-2">
                        <label className="sr-only" htmlFor={`meta-author-${book.id}`}>Autor del libro</label>
                        <input
                          id={`meta-author-${book.id}`}
                          type="text"
                          value={bookMetaForm.author}
                          onChange={e => setBookMetaForm(f => ({ ...f, author: e.target.value }))}
                          placeholder="Autor"
                          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-meta text-ink focus:border-accent/50 focus:outline-none"
                        />
                        <div className="flex items-center gap-1.5">
                          <label className="sr-only" htmlFor={`meta-pages-${book.id}`}>Páginas totales</label>
                          <input
                            id={`meta-pages-${book.id}`}
                            type="number"
                            min="1"
                            value={bookMetaForm.pageCount}
                            onChange={e => setBookMetaForm(f => ({ ...f, pageCount: e.target.value }))}
                            placeholder="Páginas"
                            className="w-20 rounded-md border border-line bg-surface px-2 py-1 text-right text-meta text-ink focus:border-accent/50 focus:outline-none"
                          />
                          <span className="text-meta">páginas totales</span>
                          <Button size="sm" variant="solid" className="ml-auto" onClick={() => handleSaveBookMeta(book)}>
                            <Check size={11} aria-hidden="true" /> Guardar
                          </Button>
                        </div>
                      </div>
                    )}

                    {editingBookId === book.id ? (
                      <div className="mt-2 space-y-2.5 rounded-xl border border-accent/40 bg-accent-soft/30 p-3 shadow-sm">
                        <div className="flex items-center justify-between text-meta">
                          <span className="font-semibold text-ink">Progreso de lectura</span>
                          <span className="font-semibold text-accent">
                            {Math.round(((parseInt(inputPage, 10) || 0) / (book.page_count || 1)) * 100)}%
                          </span>
                        </div>

                        {/* Deslizador interactivo sincronizado */}
                        <div className="space-y-1">
                          <input
                            type="range"
                            min="0"
                            max={book.page_count}
                            value={parseInt(inputPage, 10) || 0}
                            onChange={(e) => setInputPage(e.target.value)}
                            className="w-full accent-accent cursor-pointer"
                            aria-label={`Deslizador de lectura para ${book.title}`}
                          />
                          <div className="flex items-center justify-between text-micro text-muted">
                            <span>0 pág</span>
                            <span className="font-medium text-ink">
                              Página {parseInt(inputPage, 10) || 0} de {book.page_count}
                            </span>
                            <span>{book.page_count} pág</span>
                          </div>
                        </div>

                        {/* Botones de incremento rápido */}
                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => setInputPage(String(adjustBookPage(parseInt(inputPage, 10) || 0, 10, book.page_count ?? 0)))}
                            className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
                            title="Avanzar 10 páginas"
                          >
                            +10 pág
                          </button>
                          <button
                            type="button"
                            onClick={() => setInputPage(String(adjustBookPage(parseInt(inputPage, 10) || 0, 25, book.page_count ?? 0)))}
                            className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
                            title="Avanzar 25 páginas"
                          >
                            +25 pág
                          </button>
                          <button
                            type="button"
                            onClick={() => setInputPage(String(adjustBookPage(parseInt(inputPage, 10) || 0, 50, book.page_count ?? 0)))}
                            className="rounded-md border border-line bg-surface px-2 py-0.5 text-micro font-medium text-muted hover:text-ink hover:border-line-strong transition-colors cursor-pointer"
                            title="Avanzar 50 páginas"
                          >
                            +50 pág
                          </button>
                          <button
                            type="button"
                            onClick={() => setInputPage(String(book.page_count))}
                            className="rounded-md border border-success/40 bg-success-soft px-2 py-0.5 text-micro font-medium text-success hover:opacity-80 transition-colors cursor-pointer"
                            title="Marcar libro como completado"
                          >
                            Terminado (100%)
                          </button>
                        </div>

                        {/* Fila de entrada manual y botones de acción */}
                        <div className="flex items-center justify-between gap-2 border-t border-line/60 pt-2">
                          <div className="flex items-center gap-1.5">
                            <label htmlFor={`page-input-${book.id}`} className="text-micro text-muted">Pág:</label>
                            <input
                              id={`page-input-${book.id}`}
                              type="number"
                              min="0"
                              max={book.page_count}
                              value={inputPage}
                              onChange={(e) => setInputPage(e.target.value)}
                              className="w-16 rounded-md border border-line bg-surface px-2 py-1 text-right text-meta text-ink focus:border-accent/50 focus:outline-none"
                            />
                            <span className="text-meta text-muted">/ {book.page_count}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Button size="sm" variant="quiet" onClick={() => setEditingBookId(null)}>
                              Cancelar
                            </Button>
                            <Button size="sm" variant="solid" onClick={() => handleSaveProgress(book)}>
                              <Check size={12} aria-hidden="true" /> Guardar
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
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

      {/* Modal de previsualización de documento antes de persistir */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="preview-title" className="max-h-[90vh] w-full max-w-lg animate-fade-in space-y-4 overflow-y-auto rounded-xl border border-line bg-raised p-6 shadow-pop">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 id="preview-title" className="type-section flex items-center gap-2 text-ink">
                <FileUp size={17} className="text-accent" aria-hidden="true" /> Previsualización de importación
              </h3>
              <button onClick={() => setPreviewDoc(null)} aria-label="Cerrar previsualización" className="text-faint hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-2.5 text-body">
              <dl className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-canvas p-3 text-meta">
                <div>
                  <dt className="text-faint">Archivo:</dt>
                  <dd className="break-all font-semibold text-ink">{previewDoc.parsed.fileName}</dd>
                </div>
                <div>
                  <dt className="text-faint">Formato:</dt>
                  <dd className="font-semibold uppercase text-accent">{previewDoc.parsed.fileType}</dd>
                </div>
                <div>
                  <dt className="text-faint">Título detectado:</dt>
                  <dd className="font-semibold text-ink">{previewDoc.parsed.title}</dd>
                </div>
                <div>
                  <dt className="text-faint">Autor:</dt>
                  <dd className="text-muted">{previewDoc.parsed.author || 'No especificado'}</dd>
                </div>
                <div>
                  <dt className="text-faint">Páginas/Secciones:</dt>
                  <dd className="font-semibold text-ink">{previewDoc.parsed.pageCount || previewDoc.parsed.sections.length}</dd>
                </div>
                <div>
                  <dt className="text-faint">Palabras aproximadas:</dt>
                  <dd className="font-semibold text-ink">{previewDoc.parsed.estimatedWords || '~'}</dd>
                </div>
              </dl>

              {previewDoc.isDuplicate && (
                <InlineStatus tone="warning">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    <strong>Documento ya existente.</strong>{' '}
                    Este archivo tiene la misma huella SHA-256 que un recurso ya registrado en CrossedArts.
                  </span>
                </InlineStatus>
              )}

              {/* Selector de destino */}
              <div className="space-y-1.5 pt-1">
                <label className={LABEL_CLS} htmlFor="preview-destination">Destino del recurso:</label>
                <select
                  id="preview-destination"
                  value={previewDestinationType}
                  onChange={(e) => setPreviewDestinationType(e.target.value as any)}
                  className={INPUT_CLS}
                >
                  <option value="standalone">Recurso independiente (Standalone)</option>
                  <option value="book">Nuevo libro / manual en Biblioteca</option>
                  <option value="course">Asociar a curso existente</option>
                  <option value="lesson">Asociar a lección existente</option>
                </select>
              </div>

              {previewDestinationType === 'course' && (
                <div className="space-y-1">
                  <label className={LABEL_CLS} htmlFor="preview-target">Selecciona el curso:</label>
                  <select
                    id="preview-target"
                    value={previewTargetId}
                    onChange={(e) => setPreviewTargetId(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">-- Elige un curso --</option>
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Opción de indexación semántica */}
              <div className="flex items-center justify-between rounded-lg border border-line bg-canvas p-2.5">
                <label htmlFor="preview-semantic" className="text-meta font-medium text-ink">
                  Indexación semántica en segundo plano
                </label>
                <input
                  id="preview-semantic"
                  type="checkbox"
                  checked={previewEnableSemantic}
                  onChange={(e) => setPreviewEnableSemantic(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-line pt-3">
              <Button variant="quiet" onClick={() => setPreviewDoc(null)}>
                Cancelar
              </Button>
              <Button variant="solid" onClick={handleConfirmPreviewImport} disabled={isImporting || previewDoc.isDuplicate}>
                {isImporting ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                Importar a CrossedArts
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de origen de recursos */}
      {sourceViewerMeta.isOpen && sourceViewerMeta.data && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div role="dialog" aria-modal="true" aria-labelledby="source-title" className="w-full max-w-md animate-fade-in space-y-4 rounded-xl border border-line bg-raised p-6 shadow-pop">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 id="source-title" className="type-section flex items-center gap-2 text-ink">
                <Bookmark size={17} className="text-accent" aria-hidden="true" /> Origen del recurso
              </h3>
              <button onClick={() => setSourceViewerMeta({ isOpen: false })} aria-label="Cerrar visor de origen" className="text-faint hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <dl className="space-y-2 rounded-lg border border-line bg-canvas p-3 text-meta">
              <div>
                <dt className="text-faint">Título:</dt>
                <dd className="font-semibold text-ink">{sourceViewerMeta.data.resource?.title}</dd>
              </div>
              <div>
                <dt className="text-faint">Tipo de fuente:</dt>
                <dd className="font-semibold text-accent">{sourceViewerMeta.data.sourceType}</dd>
              </div>
              {sourceViewerMeta.data.fileName && (
                <div>
                  <dt className="text-faint">Archivo original:</dt>
                  <dd className="break-all font-mono text-ink">{sourceViewerMeta.data.fileName}</dd>
                </div>
              )}
              {sourceViewerMeta.data.fingerprint && (
                <div>
                  <dt className="text-faint">Huella digital (SHA-256):</dt>
                  <dd className="break-all font-mono text-muted">{sourceViewerMeta.data.fingerprint}</dd>
                </div>
              )}
              <div>
                <dt className="text-faint">Fragmentos de estudio creados:</dt>
                <dd className="font-semibold text-success">{sourceViewerMeta.data.sectionCount} fragmentos</dd>
              </div>
            </dl>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setSourceViewerMeta({ isOpen: false })}>
                Cerrar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de creación de curso */}
      {isCreateCourseOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <form onSubmit={handleCreateCourse} role="dialog" aria-modal="true" aria-labelledby="create-course-title" className="max-h-[90vh] w-full max-w-md animate-fade-in space-y-4 overflow-y-auto rounded-xl border border-line bg-raised p-6 shadow-pop">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 id="create-course-title" className="type-section flex items-center gap-2 text-ink">
                <GraduationCap size={17} className="text-accent" aria-hidden="true" /> Crear curso
              </h3>
              <button type="button" onClick={() => setIsCreateCourseOpen(false)} aria-label="Cerrar diálogo" className="text-faint hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className={LABEL_CLS} htmlFor="course-title">Título</label>
                <input
                  id="course-title"
                  type="text"
                  value={courseForm.title}
                  onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ej. Arquitectura de Sistemas"
                  className={INPUT_CLS}
                  required
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="course-desc">Descripción</label>
                <textarea
                  id="course-desc"
                  rows={3}
                  value={courseForm.description}
                  onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))}
                  className={cn(INPUT_CLS, 'resize-none')}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="course-category">Categoría</label>
                  <input
                    id="course-category"
                    type="text"
                    value={courseForm.category}
                    onChange={e => setCourseForm(f => ({ ...f, category: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="course-instructor">Instructor</label>
                  <input
                    id="course-instructor"
                    type="text"
                    value={courseForm.instructor}
                    onChange={e => setCourseForm(f => ({ ...f, instructor: e.target.value }))}
                    className={INPUT_CLS}
                  />
                </div>
              </div>
            </div>

            {courseError && (
              <div className="rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-meta text-error" role="alert">
                {courseError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setIsCreateCourseOpen(false)}>
                Cancelar
              </Button>
              <Button variant="solid" type="submit">
                Crear curso
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Overlay a pantalla completa al arrastrar archivos sobre cualquier parte de la ventana */}
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
