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
import { GRAPH_RELATION_LABELS, graphNodeLabel, graphRelationLabel } from '../services/domainLogic.ts';
import type { GraphRelationType } from '../types/models.ts';
import { useLanguage } from '../hooks/useLanguage.ts';
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
  const { t, effective } = useLanguage();
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
   * Exports the resource MATERIAL (structure, content, and practice work) as a
   * JSON package. Never includes notes, sessions, or learner progress.
   */
  const handleExportPackage = async () => {
    try {
      const pkg = await dao.exportCoursePackage(resourceId);
      if (!pkg) {
        setPackageFeedback(t('res.exportFailGone'));
        return;
      }
      downloadJsonFile(pkg, `crossedarts-paquete-${slugifyForFilename(pkg.resource.title)}.json`);
      setPackageFeedback(
        t('res.exportOk')
      );
    } catch (err) {
      console.warn('No se pudo exportar el paquete:', err);
      setPackageFeedback(t('res.exportFail'));
    }
  };

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await dao.getResourceDetail(resourceId);
      if (!data) {
        setError(t('res.goneError'));
        setDetail(null);
      } else {
        setDetail(data);
      }
    } catch (err: any) {
      setError(err?.message || t('res.loadFail'));
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
      setMetaFeedback({ text: t('res.pagesInvalid'), isError: true });
      return;
    }

    const res = await dao.updateBookDetails(detail.book.id, {
      author: bookForm.author || undefined,
      pageCount
    });
    if (!res.success) {
      setMetaFeedback({ text: res.error || t('res.metaFail'), isError: true });
      return;
    }

    if (currentPage !== undefined) {
      const prog = await dao.updateBookProgress(detail.book.id, currentPage, pageCount || detail.book.page_count || 0);
      if (!prog.success) {
        setMetaFeedback({ text: prog.error || t('res.progressFail'), isError: true });
        onRefresh();
        return;
      }
    }

    setIsEditingBook(false);
    setMetaFeedback({ text: t('res.bookUpdated') });
    await load();
    onRefresh();
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted">
        <Loader2 size={26} className="animate-spin text-accent" aria-hidden="true" />
        <p className="text-meta">{t('res.loading')}</p>
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="space-y-4">
        <button onClick={onBack} className="flex items-center gap-2 text-meta font-medium text-muted transition hover:text-ink">
          <ArrowLeft size={15} aria-hidden="true" /> {t('res.back')}
        </button>
        <InlineStatus tone="error" className="text-body">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          {error || t('res.notFound')}
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
        <ArrowLeft size={15} aria-hidden="true" /> {t('res.back')}
      </button>

      <header className="border-b border-line pb-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <Badge tone="accent">
              {graphNodeLabel(kind === 'resource' ? 'resource' : kind, effective)}
            </Badge>
            <h1 className="type-display mt-2 break-words text-ink">{resource.title}</h1>
            {resource.description && <p className="type-secondary mt-1">{resource.description}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2 md:justify-end">
            {canStudy && (
              <>
                <Button size="sm" variant="solid" onClick={() => onStudyResource(resource.id, 'mixed')}>
                  <Play size={13} aria-hidden="true" /> {t('res.study')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onStudyResource(resource.id, 'flashcards')}>
                  <Brain size={13} aria-hidden="true" /> {t('res.review')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => onStudyResource(resource.id, 'practice')}>
                  <ListChecks size={13} aria-hidden="true" /> {t('res.practice')}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setIsGenOpen(true)}>
                  <Sparkles size={13} aria-hidden="true" /> {t('res.genCards')}
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" onClick={() => onExplainResource(resource.id, resource.title)}>
              <Sparkles size={13} aria-hidden="true" /> {t('res.explain')}
            </Button>
            {/*
              Paquete portable: SOLO material educativo (estructura, contenido y
              trabajo práctico propuesto). No es un respaldo de la cuenta:
              sin tu progreso, notas ni sesiones.
            */}
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportPackage}
              title={t('res.packageTitle')}
            >
              <Download size={13} aria-hidden="true" /> {t('res.material')}</Button>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-meta sm:grid-cols-3">
          <div>
            <dt className="text-faint">{t('res.type')}</dt>
            <dd className="text-ink">{graphNodeLabel(kind === 'resource' ? 'resource' : kind, effective)}</dd>
          </div>
          <div>
            <dt className="text-faint">{t('res.category')}</dt>
            <dd className="text-ink">{resource.category}</dd>
          </div>
          <div>
            <dt className="text-faint">{t('res.status')}</dt>
            <dd className="text-ink">{resource.status}</dd>
          </div>
          {book && (
            <>
              <div>
                <dt className="flex items-center gap-1 text-faint"><User size={11} aria-hidden="true" /> {t('res.author')}</dt>
                <dd className="text-ink">{book.author || t('dashboard.authorUnknown')}</dd>
              </div>
              <div>
                <dt className="text-faint">{t('res.reading')}</dt>
                <dd className="text-ink">{t('res.pagesOf', { cur: book.current_page || 0, total: book.page_count, pct: book.reading_percentage })}</dd>
              </div>
            </>
          )}
          {source?.sourceType && (
            <div>
              <dt className="text-faint">{t('res.sourceFormat')}</dt>
              <dd className="uppercase text-ink">{source.sourceType}</dd>
            </div>
          )}
          {resource.created_at && (
            <div>
              <dt className="flex items-center gap-1 text-faint"><Calendar size={11} aria-hidden="true" /> {t('res.imported')}</dt>
              <dd className="text-ink">{resource.created_at.slice(0, 10)}</dd>
            </div>
          )}
        </dl>

        {/* Technical info available without dominating the read */}
        <div className="mt-4 space-y-1 rounded-lg border border-line bg-canvas px-3 py-2.5">
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
            <span className="flex items-center gap-1 text-muted">
              <Database size={12} className="text-accent" aria-hidden="true" />
              {t('res.indexed', { n: fragments.length }).split('{n}')[0]}<strong className="text-ink">{fragments.length}</strong>
            </span>
            <span className="text-faint">
              {t('res.semanticNote')}
            </span>
          </p>
          {source?.fileName && (
            <p className="text-meta">
              <span className="text-faint">{t('res.origFile')}</span>{' '}
              <span className="break-all font-mono text-muted">{source.fileName}</span>
            </p>
          )}
          {source?.fingerprint && (
            <p className="text-meta">
              <span className="flex items-center gap-1 text-faint">
                <Hash size={11} aria-hidden="true" /> {t('res.sha')}
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
                  <label className="sr-only" htmlFor="rd-author">{t('res.authorSr')}</label>
                  <input
                    id="rd-author"
                    type="text"
                    value={bookForm.author}
                    onChange={e => setBookForm(f => ({ ...f, author: e.target.value }))}
                    placeholder={t('res.authorPh')}
                    aria-label={t('res.authorSr')}
                    className={INPUT_CLS}
                  />
                  <label className="sr-only" htmlFor="rd-pages">{t('res.pagesTotal')}</label>
                  <input
                    id="rd-pages"
                    type="number"
                    min="1"
                    value={bookForm.pageCount}
                    onChange={e => setBookForm(f => ({ ...f, pageCount: e.target.value }))}
                    placeholder={t('res.pagesTotal')}
                    aria-label={t('res.pagesTotal')}
                    className={INPUT_CLS}
                  />
                  <label className="sr-only" htmlFor="rd-current">{t('res.currentPage')}</label>
                  <input
                    id="rd-current"
                    type="number"
                    min="0"
                    value={bookForm.currentPage}
                    onChange={e => setBookForm(f => ({ ...f, currentPage: e.target.value }))}
                    placeholder={t('res.currentPage')}
                    aria-label={t('res.currentPage')}
                    className={INPUT_CLS}
                  />
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="quiet" onClick={() => setIsEditingBook(false)}>
                    {t('res.cancel')}
                  </Button>
                  <Button size="sm" variant="solid" onClick={handleSaveBook}>
                    <Check size={12} aria-hidden="true" /> {t('res.save')}
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
                <Edit3 size={12} aria-hidden="true" /> {t('res.editMeta')}
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

      {/* Extracted content (treated as data): the page's centerpiece */}
      {fragments.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label={t('res.indexedLabel')}>
          <h2 className="type-section mb-3 border-b border-line pb-2 text-ink">
            {t('res.indexedCount', { n: fragments.length })}
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

      {/* Practice work: learner-produced artifacts linked to the resource */}
      <PracticeWorkPanel
        resourceId={resource.id}
        onChanged={onRefresh}
        onOpenResource={onOpenResource}
      />

      {/* Related (canonical relations only) */}
      <section className="rounded-xl border border-line bg-surface p-5 shadow-card" aria-label={t('res.relatedLabel')}>
        <h2 className="type-section mb-3 border-b border-line pb-2 text-ink">
          {t('res.relatedCount', { n: related.length })}
        </h2>
        {related.length === 0 ? (
          <p className="type-meta">{t('res.noRelations')}</p>
        ) : (
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {related.map(item => {
              const Icon = RELATED_ICONS[item.type] || FileText;
              const relationLabel = item.relation in GRAPH_RELATION_LABELS ? graphRelationLabel(item.relation as GraphRelationType, effective) : item.relation;
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
                        {graphNodeLabel(item.type, effective)} · {relationLabel}{item.derived ? t('res.structural') : ''}
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
