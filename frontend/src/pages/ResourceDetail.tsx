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
  Link2,
  ChevronDown,
  ChevronRight,
  Calendar,
  User,
  Hash,
  Layers
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { GRAPH_NODE_LABELS, GRAPH_RELATION_LABELS } from '../services/domainLogic.ts';
import { FlashcardGenerationModal } from '../components/study/FlashcardGenerationModal.tsx';

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
      <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-2">
        <Loader2 size={28} className="animate-spin text-purple-500" />
        <p className="text-xs">Cargando recurso local...</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition">
          <ArrowLeft size={16} /> Volver a la Biblioteca
        </button>
        <div className="p-8 rounded-2xl bg-slate-900/60 border border-rose-500/30 text-rose-300 flex items-center gap-2 text-sm">
          <AlertTriangle size={18} /> {error || 'Recurso no encontrado.'}
        </div>
      </div>
    );
  }

  const { resource, kind, book, source, fragments, related } = detail;
  const isConcept = kind === 'concept';
  const canStudy = !isConcept;

  return (
    <div className="space-y-6 animate-fade-in">
      <button onClick={onBack} className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-white transition">
        <ArrowLeft size={16} /> Volver a la Biblioteca
      </button>

      {/* Encabezado / metadatos */}
      <div className="p-6 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-4">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 uppercase">
              {GRAPH_NODE_LABELS[kind === 'resource' ? 'resource' : kind]}
            </span>
            <h1 className="text-xl font-bold text-white mt-1.5 break-words">{resource.title}</h1>
            {resource.description && <p className="text-xs text-slate-400 mt-1">{resource.description}</p>}
          </div>

          {canStudy && (
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => onStudyResource(resource.id, 'flashcards')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
              >
                <Brain size={13} /> Repasar
              </button>
              <button
                onClick={() => onStudyResource(resource.id, 'practice')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/40 transition"
              >
                <ListChecks size={13} /> Practicar
              </button>
              <button
                onClick={() => onStudyResource(resource.id, 'mixed')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              >
                <Play size={13} /> Estudiar
              </button>
              <button
                onClick={() => setIsGenOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 transition"
              >
                <Sparkles size={13} /> Generar tarjetas
              </button>
            </div>
          )}
          <button
            onClick={() => onExplainResource(resource.id, resource.title)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 hover:bg-slate-800 text-purple-300 border border-purple-800/40 transition self-start"
          >
            <Sparkles size={13} /> Explicar
          </button>
        </div>

        {/* Metadatos */}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3 text-[11px]">
          <div>
            <dt className="text-slate-500">Tipo</dt>
            <dd className="text-slate-300">{GRAPH_NODE_LABELS[kind === 'resource' ? 'resource' : kind]}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Categoría</dt>
            <dd className="text-slate-300">{resource.category}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Estado</dt>
            <dd className="text-slate-300">{resource.status}</dd>
          </div>
          {book && (
            <>
              <div>
                <dt className="text-slate-500 flex items-center gap-1"><User size={11} /> Autor</dt>
                <dd className="text-slate-300">{book.author || 'No especificado'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Progreso de lectura</dt>
                <dd className="text-slate-300">{book.current_page || 0} / {book.page_count} pág ({book.reading_percentage}%)</dd>
              </div>
            </>
          )}
          {source?.fileName && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-slate-500">Archivo original</dt>
              <dd className="text-slate-300 font-mono break-all">{source.fileName}</dd>
            </div>
          )}
          {source?.sourceType && (
            <div>
              <dt className="text-slate-500">Formato de origen</dt>
              <dd className="text-slate-300 uppercase">{source.sourceType}</dd>
            </div>
          )}
          {resource.created_at && (
            <div>
              <dt className="text-slate-500 flex items-center gap-1"><Calendar size={11} /> Importado</dt>
              <dd className="text-slate-300">{resource.created_at.slice(0, 10)}</dd>
            </div>
          )}
          {source?.fingerprint && (
            <div className="col-span-2 sm:col-span-3">
              <dt className="text-slate-500 flex items-center gap-1"><Hash size={11} /> Huella SHA-256</dt>
              <dd className="text-slate-400 font-mono text-[10px] break-all">{source.fingerprint}</dd>
            </div>
          )}
        </dl>

        {/* Indexación / contenido */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] p-2.5 rounded-lg bg-slate-950/60 border border-slate-800">
          <span className="flex items-center gap-1 text-slate-300">
            <Database size={12} className="text-purple-400" /> Fragmentos de contenido indexados: <strong className="text-white">{fragments.length}</strong>
          </span>
          <span className="text-slate-500">Indexación semántica local: opcional al importar; la búsqueda exacta siempre funciona sin embeddings.</span>
        </div>

        {book && (
          <div className="pt-1">
            {isEditingBook ? (
              <div className="p-3 rounded-xl bg-slate-950/70 border border-indigo-500/30 space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input
                    type="text"
                    value={bookForm.author}
                    onChange={e => setBookForm(f => ({ ...f, author: e.target.value }))}
                    placeholder="Autor"
                    aria-label="Autor del libro"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-indigo-400"
                  />
                  <input
                    type="number"
                    min="1"
                    value={bookForm.pageCount}
                    onChange={e => setBookForm(f => ({ ...f, pageCount: e.target.value }))}
                    placeholder="Páginas totales"
                    aria-label="Páginas totales"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-indigo-400"
                  />
                  <input
                    type="number"
                    min="0"
                    value={bookForm.currentPage}
                    onChange={e => setBookForm(f => ({ ...f, currentPage: e.target.value }))}
                    placeholder="Página actual"
                    aria-label="Página actual"
                    className="px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-[11px] text-white focus:outline-none focus:border-indigo-400"
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <button onClick={() => setIsEditingBook(false)} className="px-3 py-1 rounded-lg text-[11px] text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
                    Cancelar
                  </button>
                  <button onClick={handleSaveBook} className="px-3 py-1 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 transition">
                    <Check size={12} /> Guardar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => {
                  setBookForm({ author: book.author || '', pageCount: String(book.page_count || ''), currentPage: String(book.current_page || '') });
                  setIsEditingBook(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition"
              >
                <Edit3 size={12} /> Editar metadatos y progreso
              </button>
            )}
            {metaFeedback && (
              <div className={`mt-2 text-[11px] flex items-center gap-1 ${metaFeedback.isError ? 'text-rose-400' : 'text-emerald-400'}`}>
                {metaFeedback.isError ? <AlertTriangle size={12} /> : <CheckCircle size={12} />} {metaFeedback.text}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Contenido extraído (tratado como datos) */}
      {fragments.length > 0 && (
        <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
          <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
            <FileText size={14} className="text-purple-400" /> Contenido indexado ({fragments.length})
          </h2>
          <ul className="space-y-1.5">
            {fragments.map(frag => {
              const isOpen = expandedFragment === frag.id;
              return (
                <li key={frag.id} className="rounded-xl bg-slate-950/60 border border-slate-800 overflow-hidden">
                  <button
                    onClick={() => setExpandedFragment(isOpen ? null : frag.id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center justify-between gap-2 p-2.5 text-left hover:bg-slate-900/60 transition"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      {isOpen ? <ChevronDown size={14} className="text-purple-400 shrink-0" /> : <ChevronRight size={14} className="text-slate-500 shrink-0" />}
                      <span className="text-[11px] font-semibold text-slate-200 truncate">{frag.title}</span>
                    </span>
                  </button>
                  {isOpen && (
                    <pre className="px-3 pb-3 pt-0 text-[11px] text-slate-300 whitespace-pre-wrap break-words font-mono max-h-80 overflow-y-auto">
                      {frag.content}
                    </pre>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Relacionado */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 space-y-2">
        <h2 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-2">
          <Link2 size={14} className="text-purple-400" /> Relacionado ({related.length})
        </h2>
        {related.length === 0 ? (
          <p className="text-[11px] text-slate-500">Sin relaciones registradas. Puedes añadirlas desde el Grafo de Conocimiento.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
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
                    className="w-full text-left p-2 rounded-lg bg-slate-950/60 border border-slate-800 hover:border-purple-500/40 transition flex items-start gap-2"
                  >
                    <Icon size={14} className="text-purple-400 shrink-0 mt-0.5" />
                    <span className="min-w-0">
                      <span className="block text-[11px] font-semibold text-slate-200 truncate">{item.title}</span>
                      <span className="block text-[10px] text-slate-500">
                        {GRAPH_NODE_LABELS[item.type]} · {relationLabel}{item.derived ? ' (estructural)' : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
