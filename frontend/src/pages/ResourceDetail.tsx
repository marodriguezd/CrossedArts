import React, { useEffect, useState, useCallback } from 'react';
import { ResourceDetail as ResourceDetailModel, GraphNodeType, StudySessionMode } from '../types/models.ts';
import {
  ArrowLeft,
  BookOpen,
  FileText,
  Lightbulb,
  Brain,
  Sparkles,
  ListChecks,
  Play,
  Edit3,
  Check,
  AlertTriangle,
  CheckCircle,
  Loader2,
  Database,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  Hash,
  Layers,
  Download
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { GRAPH_NODE_LABELS, GRAPH_RELATION_LABELS } from '../services/domainLogic.ts';
import { FlashcardGenerationModal } from '../components/study/FlashcardGenerationModal.tsx';
import { PracticeWorkPanel } from '../components/practice/PracticeWorkPanel.tsx';
import { downloadJsonFile, slugifyForFilename } from '../db/exportImport.ts';
import { Button, Badge, InlineStatus, cn } from '../components/ui/index.tsx';

interface ResourceDetailProps {
  resourceId: string;
  onBack: () => void;
  onRefresh: () => void;
  onOpenResource: (id: string) => void;
  onOpenNote: (id: string) => void;
  onOpenConcept: (id: string) => void;
  onStudyResource: (id: string, mode?: StudySessionMode) => void;
  onExplainResource: (id: string, label: string) => void;
}

const RELATED_ICONS: Record<GraphNodeType, React.ComponentType<{ size?: number; className?: string }>> = {
  course: Layers,
  book: BookOpen,
  module: Layers,
  lesson: FileText,
  note: FileText,
  concept: Lightbulb,
  practice: ClipboardList,
  resource: BookOpen
};

export const ResourceDetail: React.FC<ResourceDetailProps> = ({
  resourceId,
  onBack,
  onRefresh,
  onOpenResource,
  onOpenNote,
  onOpenConcept,
  onStudyResource,
  onExplainResource
}) => {
  const [detail, setDetail] = useState<ResourceDetailModel | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedFragment, setExpandedFragment] = useState<string | null>(null);
  const [isGenOpen, setIsGenOpen] = useState(false);

  const [isEditingBook, setIsEditingBook] = useState(false);
  const [bookForm, setBookForm] = useState({ author: '', pageCount: '', currentPage: '' });
  const [metaFeedback, setMetaFeedback] = useState<{ text: string; isError?: boolean } | null>(null);
  const [packageFeedback, setPackageFeedback] = useState<string | null>(null);

  /**
   * Exporta el MATERIAL del recurso (estructura, contenido y trabajo práctico)
   * como paquete JSON. Nunca incluye notas, sesiones ni progreso del alumno.
   */
  const handleExportPackage = async () => {
    try {
      const pkg = await dao.exportCoursePackage(resourceId);
      if (!pkg) {
        setPackageFeedback('No se pudo preparar el paquete: el recurso ya no existe.');
        return;
      }
      downloadJsonFile(pkg, `crossedarts-paquete-${slugifyForFilename(pkg.resource.title)}.json`);
      setPackageFeedback(
        'Material exportado como paquete educativo (temario y trabajo propuesto). No incluye tu progreso, notas ni sesiones. Compártelo para que otra persona lo importe.'
      );
    } catch (err) {
      console.warn('No se pudo exportar el paquete:', err);
      setPackageFeedback('No se pudo exportar el paquete del recurso.');
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await dao.getResourceDetail(resourceId);
      if (!data) {
        setError('Este recurso ya no existe en la base local.');
        setDetail(null);
      } else {
        setDetail(data);
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el detalle del recurso.');
    } finally {
      setIsLoading(false);
    }
  }, [resourceId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSaveBook = async () => {
    if (!detail?.book) return;
    setMetaFeedback(null);
    const pageCount = bookForm.pageCount ? parseInt(bookForm.pageCount, 10) : undefined;
    const currentPage = bookForm.currentPage ? parseInt(bookForm.currentPage, 10) : undefined;

    if (pageCount !== undefined && (isNaN(pageCount) || pageCount <= 0)) {
      setMetaFeedback({ text: 'El número de páginas debe ser mayor que cero.', isError: true });
      return;
    }

    const res = await dao.updateBookDetails(detail.book.id, {
      author: bookForm.author || undefined,
      pageCount
    });
    if (!res.success) {
      setMetaFeedback({ text: res.error || 'No se pudieron actualizar los metadatos.', isError: true });
      return;
    }

    if (currentPage !== undefined) {
      const prog = await dao.updateBookProgress(detail.book.id, currentPage, pageCount || detail.book.page_count || 0);
      if (!prog.success) {
        setMetaFeedback({ text: prog.error || 'No se pudo actualizar el progreso.', isError: true });
        onRefresh();
        return;
      }
    }

    setIsEditingBook(false);
    setMetaFeedback({ text: 'Libro actualizado correctamente.' });
    await load();
    onRefresh();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted">
        <Loader2 size={26} className="animate-spin text-accent" aria-hidden="true" />
        <p className="text-meta">Cargando recurso local…</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-meta font-medium text-muted transition hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" /> Volver a la Biblioteca
        </button>
        <InlineStatus tone="error" className="text-body">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error || 'Recurso no encontrado.'}
        </InlineStatus>
      </div>
    );
  }

  const { resource, kind, book, source, fragments, related } = detail;
  const isConcept = kind === 'concept';
  const canStudy = !isConcept;

  const INPUT_CLS = 'rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-meta text-ink focus:border-accent/50 focus:outline-none';

  return (
    <div className="animate-fade-in space-y-6">
      <button onClick={onBack} className="flex items-center gap-2 text-meta font-medium text-muted transition hover:text-ink">
        <ArrowLeft size={15} aria-hidden="true" /> Volver a la Biblioteca
      </button>

      {/* Cabecera editorial del objeto de estudio */}
      <header className="border-b border-line pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Badge tone="accent">
              {GRAPH_NODE_LABELS[kind === 'resource' ? 'resource' : kind]}
            </Badge>
            <h1 className="type-display mt-2 break-words text-ink">{resource.title}</h1>
            {resource.description && <p className="type-secondary mt-1">{resource.description}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {canStudy && (
              <>
                <Button size="sm" variant="solid" onClick={() => onStudyResource(resource.id, 'mixed')}>
                  <Play size={13} aria-hidden="true" /> Estudiar
                </Button>
                <Button size="sm" variant="outline" onClick={() => onStudyResource(resource.id, 'flashcards')}>
                  <Brain size={13} aria-hidden="true" /> Repasar
                </Button>
                <Button size="sm" variant="outline" onClick={() => onStudyResource(resource.id, 'practice')}>
                  <ListChecks size={13} aria-hidden="true" /> Practicar
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsGenOpen(true)}>
                  <Sparkles size={13} aria-hidden="true" /> Generar tarjetas
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => onExplainResource(resource.id, resource.title)}>
              <Sparkles size={13} aria-hidden="true" /> Explicar
            </Button>
            {/*
              Paquete portable: SOLO material educativo (estructura, contenido y
              trabajo práctico propuesto). No es un respaldo de la cuenta ni
              incluye el progreso, las notas ni las sesiones del alumno.
            */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportPackage}
              title="Exportar el material educativo de este recurso como paquete JSON: temario y trabajo propuesto, sin tu progreso, notas ni sesiones"
            >
              <Download size={13} aria-hidden="true" /> Material</Button>
          </div>
        </div>

        {/* Metadatos discretos */}
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-meta sm:grid-cols-3">
          <div>
            <dt className="text-faint">Tipo</dt>
            <dd className="text-ink">{GRAPH_NODE_LABELS[kind === 'resource' ? 'resource' : kind]}</dd>
          </div>
          <div>
            <dt className="text-faint">Categoría</dt>
            <dd className="text-ink">{resource.category}</dd>
          </div>
          <div>
            <dt className="text-faint">Estado</dt>
            <dd className="text-ink">{resource.status}</dd>
          </div>
          {book && (
            <>
              <div>
                <dt className="flex items-center gap-1 text-faint"><User size={11} aria-hidden="true" /> Autor</dt>
                <dd className="text-ink">{book.author || 'No especificado'}</dd>
              </div>
              <div>
                <dt className="text-faint">Progreso de lectura</dt>
                <dd className="text-ink">{book.current_page || 0} / {book.page_count} pág ({book.reading_percentage}%)</dd>
              </div>
            </>
          )}
          {source?.sourceType && (
            <div>
              <dt className="text-faint">Formato de origen</dt>
              <dd className="uppercase text-ink">{source.sourceType}</dd>
            </div>
          )}
          {resource.created_at && (
            <div>
              <dt className="flex items-center gap-1 text-faint"><Calendar size={11} aria-hidden="true" /> Importado</dt>
              <dd className="text-ink">{resource.created_at.slice(0, 10)}</dd>
            </div>
          )}
        </dl>

        {/* Información técnica disponible sin dominar la lectura */}
        <div className="mt-4 space-y-1 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
            <span className="flex items-center gap-1 text-muted">
              <Database size={12} className="text-accent" aria-hidden="true" />
              Fragmentos de contenido indexados: <strong className="text-ink">{fragments.length}</strong>
            </span>
            <span className="text-faint">
              Indexación semántica local: opcional al importar; la búsqueda exacta siempre funciona sin embeddings.
            </span>
          </p>
          {source?.fileName && (
            <p className="text-meta">
              <span className="text-faint">Archivo original:</span>{' '}
              <span className="break-all font-mono text-muted">{source.fileName}</span>
            </p>
          )}
          {source?.fingerprint && (
            <p className="text-meta">
              <span className="flex items-center gap-1 text-faint">
                <Hash size={11} aria-hidden="true" /> Huella SHA-256:
              </span>
              <span className="break-all font-mono text-muted">{source.fingerprint}</span>
            </p>
          )}
        </div>

        {book && (
          <div className="mt-3">
            {isEditingBook ? (
              <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="sr-only" htmlFor="rd-author">Autor del libro</label>
                  <input
                    id="rd-author"
                    type="text"
                    value={bookForm.author}
                    onChange={e => setBookForm(f => ({ ...f, author: e.target.value }))}
                    placeholder="Autor"
                    aria-label="Autor del libro"
                    className={INPUT_CLS}
                  />
                  <label className="sr-only" htmlFor="rd-pages">Páginas totales</label>
                  <input
                    id="rd-pages"
                    type="number"
                    min="1"
                    value={bookForm.pageCount}
                    onChange={e => setBookForm(f => ({ ...f, pageCount: e.target.value }))}
                    placeholder="Páginas totales"
                    aria-label="Páginas totales"
                    className={INPUT_CLS}
                  />
                  <label className="sr-only" htmlFor="rd-current">Página actual</label>
                  <input
                    id="rd-current"
                    type="number"
                    min="0"
                    value={bookForm.currentPage}
                    onChange={e => setBookForm(f => ({ ...f, currentPage: e.target.value }))}
                    placeholder="Página actual"
                    aria-label="Página actual"
                    className={INPUT_CLS}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="quiet" onClick={() => setIsEditingBook(false)}>
                    Cancelar
                  </Button>
                  <Button size="sm" variant="solid" onClick={handleSaveBook}>
                    <Check size={12} aria-hidden="true" /> Guardar
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBookForm({ author: book.author || '', pageCount: String(book.page_count || ''), currentPage: String(book.current_page || '') });
                  setIsEditingBook(true);
                }}
              >
                <Edit3 size={12} aria-hidden="true" /> Editar metadatos y progreso
              </Button>
            )}
            {metaFeedback && (
              <div className={cn('mt-2 flex items-center gap-1 text-meta', metaFeedback.isError ? 'text-error' : 'text-success')}>
                {metaFeedback.isError ? <AlertTriangle size={12} aria-hidden="true" /> : <CheckCircle size={12} aria-hidden="true" />}
                {metaFeedback.text}
              </div>
            )}
            {packageFeedback && (
              <div className="mt-2 flex items-center gap-1 text-meta text-success" role="status" aria-live="polite">
                <CheckCircle size={12} aria-hidden="true" />
                {packageFeedback}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Contenido extraído (tratado como datos): protagonista de la página */}
      {fragments.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label="Contenido indexado">
          <h2 className="type-section mb-3 border-b border-line pb-2 text-ink">
            Contenido indexado ({fragments.length})
          </h2>
          <ul className="space-y-1.5">
            {fragments.map(frag => {
              const isOpen = expandedFragment === frag.id;
              return (
                <li key={frag.id} className="overflow-hidden rounded-lg border border-line bg-canvas">
                  <button
                    onClick={() => setExpandedFragment(isOpen ? null : frag.id)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center justify-between gap-2 p-2.5 text-left transition hover:bg-accent-soft/40"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {isOpen
                        ? <ChevronDown size={14} className="shrink-0 text-accent" aria-hidden="true" />
                        : <ChevronRight size={14} className="shrink-0 text-faint" aria-hidden="true" />}
                      <span className="truncate text-meta font-semibold text-ink">{frag.title}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 pt-0 font-mono text-meta text-muted">
                      {frag.content}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Trabajo práctico: artefactos producidos por el estudiante, vinculados al recurso */}
      <PracticeWorkPanel resourceId={resource.id} onChanged={onRefresh} />

      {/* Relacionado (solo relaciones canónicas) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label="Relacionado">
        <h2 className="type-section mb-3 border-b border-line pb-2 text-ink">
          Relacionado ({related.length})
        </h2>
        {related.length === 0 ? (
          <p className="type-meta">Sin relaciones registradas. Puedes añadirlas desde el Grafo de Conocimiento.</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {related.map(item => {
              const Icon = RELATED_ICONS[item.type] || FileText;
              const relationLabel = (GRAPH_RELATION_LABELS as Record<string, string>)[item.relation] || item.relation;
              return (
                <li key={`${item.id}-${item.relation}`}>
                  <button
                    onClick={() => {
                      if (item.type === 'note') onOpenNote(item.id);
                      else if (item.type === 'concept') onOpenConcept(item.id);
                      else onOpenResource(item.id);
                    }}
                    className="flex w-full items-start gap-2 rounded-lg border border-line bg-canvas p-2.5 text-left transition-colors duration-fast hover:border-accent/40 hover:bg-accent-soft/40"
                  >
                    <Icon size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-meta font-semibold text-ink">{item.title}</span>
                      <span className="block text-micro">
                        {GRAPH_NODE_LABELS[item.type]} · {relationLabel}{item.derived ? ' (estructural)' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <FlashcardGenerationModal
        isOpen={isGenOpen}
        onClose={() => setIsGenOpen(false)}
        resourceId={resource.id}
        initialTopic={resource.title}
        onCardsSaved={() => {
          onRefresh();
          load();
        }}
      />
    </div>
  );
};
