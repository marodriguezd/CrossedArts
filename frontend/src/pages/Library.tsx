import React, { useState, useRef, useEffect } from 'react';
import { Course, Book, SearchResult, UnorganizedResource, GraphNodeType } from '../types/models.ts';
import { Search, FolderOpen, Play, BookOpen, Layers, Plus, CheckCircle, AlertTriangle, FolderCheck, X, Bookmark, Edit3, Check, FileUp, Loader2, Link2, GraduationCap, FileText, Lightbulb, Brain, Sparkles, ListChecks, ArrowUpRight } from 'lucide-react';
import { resolveSearchResultDestination } from '../services/domainLogic.ts';
import type { MediaScanReport } from '../services/localMediaService.ts';
import { dao } from '../db/dao.ts';
import { localIngestionService } from '../lib/localIngestion/service.ts';
import type { IngestionProgress, IngestionResult } from '../lib/localIngestion/types.ts';

interface LibraryProps {
  courses: Course[];
  books: Book[];
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

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const handleTriggerFilePicker = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Si es un único archivo, abrir modal de preview con validación y elección de destino
    if (files.length === 1) {
      const file = files[0];
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

    const fileList = Array.from(files);
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
  };

  const handleConfirmPreviewImport = async () => {
    if (!previewDoc) return;
    setIsImporting(true);
    const { file, parsed } = previewDoc;

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

    const res = await dao.updateBookProgress(book.id, pageNum, book.page_count);
    if (res.success) {
      const clamped = Math.max(0, Math.min(pageNum, book.page_count));
      const pct = Math.round((clamped / book.page_count) * 100);
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

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header and Action controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Biblioteca Educativa</h1>
          <p className="text-xs text-slate-400">Catálogo modular de cursos estructurados y libros de estudio</p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Input oculto para selección de archivos */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFilesSelected}
            multiple
            accept=".txt,.md,.markdown,.pdf,.epub"
            className="hidden"
          />

          <button
            onClick={() => { setCourseError(null); setIsCreateCourseOpen(true); }}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/25 transition"
            title="Crear un curso estructurado"
          >
            <Plus size={15} />
            <span>Crear Curso</span>
          </button>

          <button
            onClick={handleTriggerFilePicker}
            disabled={isImporting}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white shadow-md shadow-indigo-600/25 transition"
            title="Importar documentos locales (.txt, .md, .pdf, .epub)"
          >
            {isImporting ? <Loader2 size={15} className="animate-spin" /> : <FileUp size={15} />}
            <span>{isImporting ? 'Importando...' : 'Importar Documentos'}</span>
          </button>

          <button
            onClick={onMountLocalFolder}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition"
            title="Escanear carpeta local con File System Access API"
          >
            <FolderOpen size={15} />
            <span>Vincular Carpeta Local</span>
          </button>
        </div>
      </div>

      {/* Banner de progreso de importación de documentos */}
      {isImporting && ingestionProgress && (
        <div className="p-4 rounded-xl bg-indigo-950/40 border border-indigo-500/40 text-slate-200 flex items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="text-indigo-400 animate-spin shrink-0" />
            <div className="space-y-0.5 text-xs">
              <p className="font-semibold text-indigo-200">
                Procesando archivo ({ingestionProgress.currentFileIndex}/{ingestionProgress.totalFiles}): <span className="font-mono text-white">{ingestionProgress.fileName}</span>
              </p>
              <p className="text-slate-300">{ingestionProgress.message}</p>
            </div>
          </div>
          <button
            onClick={handleCancelIngestion}
            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-rose-300 transition"
          >
            Cancelar
          </button>
        </div>
      )}

      {/* Banner de reporte de importación de documentos */}
      {ingestionReport && (
        <div className="p-4 rounded-xl bg-slate-900 border border-indigo-500/30 text-slate-200 flex items-start justify-between gap-3 animate-fade-in">
          <div className="space-y-1 text-xs">
            <p className="font-semibold text-indigo-300">
              Resultado de importación ({ingestionReport.total} archivo{ingestionReport.total !== 1 ? 's' : ''})
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
              <span className="text-emerald-400">✓ Importados: <strong>{ingestionReport.success}</strong></span>
              {ingestionReport.duplicates > 0 && (
                <span className="text-slate-400">↷ Duplicados omitidos: {ingestionReport.duplicates}</span>
              )}
              {ingestionReport.errors > 0 && (
                <span className="text-rose-400">✕ Errores: {ingestionReport.errors}</span>
              )}
            </div>
            <ul className="mt-2 space-y-0.5 text-[11px] text-slate-400 max-h-24 overflow-y-auto">
              {ingestionReport.details.slice(0, 5).map((d, i) => (
                <li key={i}>{d}</li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => setIngestionReport(null)}
            className="text-slate-400 hover:text-white p-1"
            title="Cerrar reporte"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Banner de reporte de escaneo factual */}
      {scanReport && (
        <div className="p-4 rounded-xl bg-purple-950/40 border border-purple-500/40 text-slate-200 flex items-start justify-between gap-3 animate-fade-in">
          <div className="flex items-start gap-3">
            <FolderCheck size={20} className="text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <p className="font-semibold text-purple-200">
                Carpeta vinculada: <span className="font-mono text-white">"{scanReport.directoryName}"</span>
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-300">
                <span>📁 Archivos multimedia encontrados: <strong>{scanReport.totalDiscovered}</strong></span>
                <span className="text-emerald-400">✓ Lecciones emparejadas: <strong>{scanReport.matchedCount}</strong></span>
                {scanReport.unmatchedCount > 0 && (
                  <span className="text-slate-400">○ Archivos sin emparejar: {scanReport.unmatchedCount}</span>
                )}
                {scanReport.ambiguousMatches.length > 0 && (
                  <span className="text-amber-400 flex items-center gap-1">
                    <AlertTriangle size={12} /> Ambigüedades detectadas: {scanReport.ambiguousMatches.length}
                  </span>
                )}
              </div>
            </div>
          </div>
          {onDismissReport && (
            <button 
              onClick={onDismissReport} 
              className="text-slate-400 hover:text-white p-1"
              title="Cerrar aviso"
            >
              <X size={16} />
            </button>
          )}
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900/60 p-3 rounded-xl border border-slate-800">
        <div className="relative w-full sm:w-72">
          <Search size={16} className="absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar por título, autor o tema..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-purple-500"
          />
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {(['all', 'courses', 'books'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                filter === mode
                  ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
              }`}
            >
              {mode === 'all' ? 'Todo' : mode === 'courses' ? 'Cursos' : 'Libros'}
            </button>
          ))}
        </div>
      </div>

      {/* Búsqueda local unificada (sin embeddings, funciona offline) */}
      {query.trim().length >= 2 && (
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Search size={14} className="text-purple-400" /> Resultados locales ({searchResults.length})
            </h2>
            {isSearching && <Loader2 size={13} className="animate-spin text-purple-400" />}
          </div>
          {searchResults.length === 0 && !isSearching ? (
            <p className="text-[11px] text-slate-500">Sin coincidencias en cursos, libros, lecciones, notas, conceptos o recursos importados.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {searchResults.slice(0, 20).map(result => {
                const Icon = RESULT_ICONS[result.type] || FileText;
                return (
                  <li key={`${result.type}-${result.id}`}>
                    <button
                      onClick={() => handleSearchResultNavigate(result)}
                      aria-label={`Abrir ${result.type}: ${result.title}`}
                      className="w-full text-left p-2 rounded-lg border border-slate-800 bg-slate-950/50 flex items-start gap-2 transition hover:border-purple-500/40 cursor-pointer"
                    >
                      <Icon size={14} className="text-purple-400 shrink-0 mt-0.5" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold text-slate-200 truncate">{result.title}</span>
                        {result.subtitle && <span className="block text-[10px] text-slate-500 truncate">{result.subtitle}</span>}
                        <span className="block text-[9px] uppercase tracking-wider text-slate-600">{result.type}</span>
                      </span>
                      <ArrowUpRight size={13} className="text-slate-500 shrink-0 mt-0.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* Recursos sin organizar */}
      {unorganized.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-amber-500/30 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
              <Link2 size={14} className="text-amber-400" /> Recursos sin organizar ({unorganized.length})
            </h2>
            {organizeFeedback && <span className="text-[10px] text-slate-400">{organizeFeedback}</span>}
          </div>
          <p className="text-[11px] text-slate-500">Documentos importados que aún no están asociados a ningún curso, libro o concepto.</p>
          <ul className="space-y-2">
            {unorganized.map(item => (
              <li key={item.resource.id} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold text-slate-200 truncate">{item.resource.title}</p>
                  <p className="text-[10px] text-slate-500">{item.noteCount} fragmentos de estudio · sin conexiones</p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    onClick={() => onOpenResource?.(item.resource.id)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1 transition"
                    aria-label={`Abrir recurso ${item.resource.title}`}
                  >
                    <ArrowUpRight size={12} /> Abrir
                  </button>
                  <button
                    onClick={() => onStudyResource?.(item.resource.id, 'mixed')}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 flex items-center gap-1 transition"
                    aria-label={`Estudiar recurso ${item.resource.title}`}
                  >
                    <Brain size={12} /> Estudiar
                  </button>
                  <select
                    value={organizeTarget[item.resource.id] || ''}
                    onChange={e => setOrganizeTarget(prev => ({ ...prev, [item.resource.id]: e.target.value }))}
                    className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-800 text-[11px] text-slate-200 focus:outline-none focus:border-amber-500"
                    aria-label={`Asociar ${item.resource.title} a un curso`}
                  >
                    <option value="">Elegir curso…</option>
                    {courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
                  </select>
                  <button
                    onClick={() => handleOrganizeResource(item.resource.id)}
                    disabled={!organizeTarget[item.resource.id]}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white transition"
                  >
                    Asociar
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Cursos Grid */}
      {(filter === 'all' || filter === 'courses') && (
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <Layers size={16} className="text-purple-400" /> Cursos Estructurados ({filteredCourses.length})
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCourses.map(course => (
              <div
                key={course.id}
                onClick={() => onSelectCourse(course.id)}
                className="group rounded-xl bg-slate-900/50 hover:bg-slate-900 border border-slate-800/80 hover:border-purple-500/40 p-4 cursor-pointer transition flex flex-col justify-between"
              >
                <div>
                  <div className="relative h-36 rounded-lg overflow-hidden mb-3 border border-slate-800 bg-slate-950 flex items-center justify-center">
                    {course.cover_path ? (
                      <img src={course.cover_path} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
                    ) : (
                      <div className="w-full h-full bg-gradient-to-br from-purple-950/60 to-slate-950 flex items-center justify-center text-purple-400">
                        <Layers size={36} className="opacity-70 group-hover:scale-110 transition duration-300" />
                      </div>
                    )}
                    <span className="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold bg-slate-950/80 text-purple-300 backdrop-blur-md">
                      {course.difficulty}
                    </span>
                  </div>
                  <h3 className="font-semibold text-sm text-slate-100 group-hover:text-purple-300 transition line-clamp-1">
                    {course.title}
                  </h3>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{course.description}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/60 flex items-center justify-between text-xs text-slate-400">
                  <span>{course.completed_lessons || 0}/{course.total_lessons || 0} lecciones</span>
                  <span className="text-purple-400 font-semibold flex items-center gap-1 group-hover:translate-x-0.5 transition">
                    Ver curso <Play size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Libros Grid */}
      {(filter === 'all' || filter === 'books') && (
        <div className="space-y-3 pt-4">
          <h2 className="text-sm font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <BookOpen size={16} className="text-indigo-400" /> Libros & Manuales ({filteredBooks.length})
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBooks.map(book => (
              <div
                key={book.id}
                className="rounded-xl bg-slate-900/50 border border-slate-800/80 p-4 flex gap-3 items-center"
              >
                {book.cover_path ? (
                  <img src={book.cover_path} alt={book.title} className="w-16 h-22 rounded-md object-cover border border-slate-700 shadow-md" />
                ) : (
                  <div className="w-16 h-22 rounded-md bg-gradient-to-br from-indigo-950/70 to-slate-900 border border-indigo-800/40 shadow-md flex items-center justify-center text-indigo-400 shrink-0">
                    <BookOpen size={24} className="opacity-80" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider">{book.category}</span>
                    <button
                      onClick={() => handleStartEdit(book)}
                      className="text-[10px] text-slate-400 hover:text-indigo-300 flex items-center gap-1 transition"
                      title="Actualizar página actual"
                    >
                      <Edit3 size={11} /> {editingBookId === book.id ? 'Cancel' : 'Editar'}
                    </button>
                  </div>
                  <h4 className="font-semibold text-xs text-slate-100 truncate">{book.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{book.author}</p>
                  
                  {/* Acciones del recurso: fuentes, estudio, explicación y metadatos */}
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      onClick={() => handleOpenSourceViewer(book.id)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline underline-offset-2 flex items-center gap-0.5"
                    >
                      Origen del recurso
                    </button>
                    <button
                      onClick={() => onStudyResource?.(book.id, 'flashcards')}
                      className="text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-0.5"
                    >
                      <Brain size={10} /> Repasar
                    </button>
                    <button
                      onClick={() => onStudyResource?.(book.id, 'practice')}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300 flex items-center gap-0.5"
                    >
                      <ListChecks size={10} /> Practicar
                    </button>
                    <button
                      onClick={() => onExplainResource?.(book.id, book.title)}
                      className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-0.5"
                    >
                      <Sparkles size={10} /> Explicar
                    </button>
                    <button
                      onClick={() => {
                        setEditingBookMeta(editingBookMeta === book.id ? null : book.id);
                        setBookMetaForm({ author: book.author || '', pageCount: String(book.page_count || '') });
                      }}
                      className="text-[10px] text-slate-400 hover:text-white flex items-center gap-0.5"
                    >
                      <Edit3 size={10} /> Metadatos
                    </button>
                  </div>

                  {editingBookMeta === book.id && (
                    <div className="mt-2 p-2 rounded-lg bg-slate-950/80 border border-indigo-500/30 space-y-1.5">
                      <input
                        type="text"
                        value={bookMetaForm.author}
                        onChange={e => setBookMetaForm(f => ({ ...f, author: e.target.value }))}
                        placeholder="Autor"
                        className="w-full px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-indigo-400"
                      />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="1"
                          value={bookMetaForm.pageCount}
                          onChange={e => setBookMetaForm(f => ({ ...f, pageCount: e.target.value }))}
                          placeholder="Páginas"
                          className="w-20 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-[11px] text-white text-right focus:outline-none focus:border-indigo-400"
                        />
                        <span className="text-[10px] text-slate-400">páginas totales</span>
                        <button
                          onClick={() => handleSaveBookMeta(book)}
                          className="ml-auto px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold text-white flex items-center gap-1 transition"
                        >
                          <Check size={11} /> Guardar
                        </button>
                      </div>
                    </div>
                  )}
                  
                  {editingBookId === book.id ? (
                    <div className="mt-2 p-2 rounded-lg bg-slate-950/80 border border-indigo-500/30 space-y-1.5">
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          min="0"
                          max={book.page_count}
                          value={inputPage}
                          onChange={(e) => setInputPage(e.target.value)}
                          className="w-16 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-xs text-white text-right focus:outline-none focus:border-indigo-400"
                        />
                        <span className="text-[10px] text-slate-400">/ {book.page_count} pág</span>
                        <button
                          onClick={() => handleSaveProgress(book)}
                          className="ml-auto px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-[10px] font-semibold text-white flex items-center gap-1 transition"
                        >
                          <Check size={11} /> Guardar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span>{book.current_page || 0}/{book.page_count} pág</span>
                        <span className="font-bold text-indigo-400">{book.reading_percentage}%</span>
                      </div>
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${book.reading_percentage}%` }} />
                      </div>
                    </div>
                  )}

                  {bookFeedback && bookFeedback.id === book.id && (
                    <div className={`mt-1.5 text-[10px] flex items-center gap-1 ${bookFeedback.isError ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {bookFeedback.isError ? <AlertTriangle size={11} /> : <CheckCircle size={11} />}
                      <span>{bookFeedback.msg}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal de Previsualización de Documento antes de Persistir */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <FileUp size={18} className="text-indigo-400" /> Previsualización de Importación
              </h3>
              <button onClick={() => setPreviewDoc(null)} className="text-slate-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="grid grid-cols-2 gap-2 p-3 bg-slate-950 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Archivo:</span>
                  <span className="font-semibold text-white break-all">{previewDoc.parsed.fileName}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Formato:</span>
                  <span className="font-semibold text-indigo-300 uppercase">{previewDoc.parsed.fileType}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Título detectado:</span>
                  <span className="font-semibold text-white">{previewDoc.parsed.title}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Autor:</span>
                  <span className="text-slate-300">{previewDoc.parsed.author || 'No especificado'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Páginas/Secciones:</span>
                  <span className="font-semibold text-white">{previewDoc.parsed.pageCount || previewDoc.parsed.sections.length}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Palabras aproximadas:</span>
                  <span className="font-semibold text-white">{previewDoc.parsed.estimatedWords || '~'}</span>
                </div>
              </div>

              {previewDoc.isDuplicate && (
                <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/40 text-amber-200 flex items-start gap-2">
                  <AlertTriangle size={16} className="shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-semibold">Documento ya existente</p>
                    <p className="text-[11px] text-amber-300/90">Este archivo tiene la misma huella SHA-256 que un recurso ya registrado en CrossedArts.</p>
                  </div>
                </div>
              )}

              {/* Selector de destino */}
              <div className="space-y-1.5 pt-1">
                <label className="text-slate-400 font-medium block">Destino del recurso:</label>
                <select
                  value={previewDestinationType}
                  onChange={(e) => setPreviewDestinationType(e.target.value as any)}
                  className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                >
                  <option value="standalone">Recurso independiente (Standalone)</option>
                  <option value="book">Nuevo Libro / Manual en Biblioteca</option>
                  <option value="course">Asociar a Curso existente</option>
                  <option value="lesson">Asociar a Lección existente</option>
                </select>
              </div>

              {previewDestinationType === 'course' && (
                <div className="space-y-1">
                  <label className="text-slate-400 block">Selecciona el curso:</label>
                  <select
                    value={previewTargetId}
                    onChange={(e) => setPreviewTargetId(e.target.value)}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-indigo-500"
                  >
                    <option value="">-- Elige un curso --</option>
                    {courses.map(c => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Opción de Indexación Semántica */}
              <div className="pt-2 flex items-center justify-between p-2.5 bg-slate-950 rounded-xl border border-slate-800">
                <span className="text-slate-300 font-medium">Indexación semántica en segundo plano</span>
                <input
                  type="checkbox"
                  checked={previewEnableSemantic}
                  onChange={(e) => setPreviewEnableSemantic(e.target.checked)}
                  className="rounded border-slate-700 text-indigo-600 focus:ring-0 cursor-pointer"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setPreviewDoc(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmPreviewImport}
                disabled={isImporting || previewDoc.isDuplicate}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white transition flex items-center gap-1.5"
              >
                {isImporting ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                <span>Importar a CrossedArts</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Origen de Recursos (Resource Sources View) */}
      {sourceViewerMeta.isOpen && sourceViewerMeta.data && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Bookmark size={18} className="text-purple-400" /> Origen del Recurso
              </h3>
              <button onClick={() => setSourceViewerMeta({ isOpen: false })} className="text-slate-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div>
                  <span className="text-slate-500 block">Título:</span>
                  <span className="font-semibold text-white">{sourceViewerMeta.data.resource?.title}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Tipo de Fuente:</span>
                  <span className="font-semibold text-indigo-300">{sourceViewerMeta.data.sourceType}</span>
                </div>
                {sourceViewerMeta.data.fileName && (
                  <div>
                    <span className="text-slate-500 block">Archivo original:</span>
                    <span className="font-mono text-white text-[11px]">{sourceViewerMeta.data.fileName}</span>
                  </div>
                )}
                {sourceViewerMeta.data.fingerprint && (
                  <div>
                    <span className="text-slate-500 block">Huella digital (SHA-256):</span>
                    <span className="font-mono text-slate-400 text-[10px] break-all">{sourceViewerMeta.data.fingerprint}</span>
                  </div>
                )}
                <div>
                  <span className="text-slate-500 block">Fragmentos de estudio creados:</span>
                  <span className="font-semibold text-emerald-400">{sourceViewerMeta.data.sectionCount} fragmentos</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSourceViewerMeta({ isOpen: false })}
                className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de creación de curso */}
      {isCreateCourseOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateCourse} className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <GraduationCap size={18} className="text-emerald-400" /> Crear Curso
              </h3>
              <button type="button" onClick={() => setIsCreateCourseOpen(false)} className="text-slate-400 hover:text-white p-1">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-slate-400 mb-1" htmlFor="course-title">Título</label>
                <input
                  id="course-title"
                  type="text"
                  value={courseForm.title}
                  onChange={e => setCourseForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="Ej. Arquitectura de Sistemas"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
                  required
                />
              </div>
              <div>
                <label className="block text-slate-400 mb-1" htmlFor="course-desc">Descripción</label>
                <textarea
                  id="course-desc"
                  rows={3}
                  value={courseForm.description}
                  onChange={e => setCourseForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-400 mb-1" htmlFor="course-category">Categoría</label>
                  <input
                    id="course-category"
                    type="text"
                    value={courseForm.category}
                    onChange={e => setCourseForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 mb-1" htmlFor="course-instructor">Instructor</label>
                  <input
                    id="course-instructor"
                    type="text"
                    value={courseForm.instructor}
                    onChange={e => setCourseForm(f => ({ ...f, instructor: e.target.value }))}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {courseError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs" role="alert">
                {courseError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setIsCreateCourseOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
                Cancelar
              </button>
              <button type="submit" className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition">
                Crear Curso
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
