import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Note, LearningResource } from '../types/models.ts';
import {
  FileText,
  Plus,
  Tag,
  Calendar,
  Save,
  Link2,
  GraduationCap,
  Edit3,
  Trash2,
  Eye,
  PenTool,
  X,
  Download,
  Mic,
  MicOff,
  Volume2,
  VolumeX
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { speechService } from '../services/speechService.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { MarkdownViewer } from '../components/common/MarkdownViewer.tsx';
import {
  exportNoteToMarkdown,
  exportNotesToSingleMarkdown,
  triggerTextDownload,
  extractUniqueTagsWithCounts,
  filterNotesByQueryAndTag
} from '../services/domainLogic.ts';
import { Button, SearchInput, Badge, EmptyState, Chip, cn } from '../components/ui/index.tsx';
import { useLanguage } from '../hooks/useLanguage.ts';









interface NotesViewProps {
  notes: Note[];
  onRefresh: () => void;
  initialNoteId?: string | null;
}

export const NotesView: React.FC<NotesViewProps> = ({ notes, onRefresh, initialNoteId }) => {
  const { t, effective } = useLanguage();
  const [selectedNote, setSelectedNote] = useState<Note | null>(notes[0] || null);

  const [isCreating, setIsCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write');

  const [formData, setFormData] = useState({
    title: '',
    content: '',
    tags: '',
    resource_id: '',
    lesson_id: ''
  });

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string; courseTitle: string }>>([]);
  const [query, setQuery] = useState('');

  const [isDictating, setIsDictating] = useState(false);
  const [dictationError, setDictationError] = useState<string | null>(null);
  const [isPlayingNoteAudio, setIsPlayingNoteAudio] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    return () => {
      speechService.stopDictation();
      speechService.stopSpeaking();
    };
  }, []);

  const handleToggleDictation = () => {
    if (isDictating) {
      speechService.stopDictation();
      setIsDictating(false);
    } else {
      setDictationError(null);
      const success = speechService.startDictation(
        (transcriptChunk: string, isFinal: boolean) => {
          if (!isFinal) return;
          setFormData(prev => {
            const textarea = textareaRef.current;
            if (!textarea) {
              return {
                ...prev,
                content: prev.content ? `${prev.content} ${transcriptChunk}` : transcriptChunk
              };
            }
            const start = textarea.selectionStart ?? prev.content.length;
            const end = textarea.selectionEnd ?? prev.content.length;
            const before = prev.content.substring(0, start);
            const after = prev.content.substring(end);
            const separator = (before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n')) ? ' ' : '';
            const insertion = separator + transcriptChunk;
            const newContent = before + insertion + after;
            setTimeout(() => {
              if (textareaRef.current) {
                const newPos = start + insertion.length;
                textareaRef.current.selectionStart = newPos;
                textareaRef.current.selectionEnd = newPos;
              }
            }, 0);
            return { ...prev, content: newContent };
          });
        },
        (errorMsg: string) => {
          setIsDictating(false);
          setDictationError(errorMsg);
        },
        effective
      );
      if (success) setIsDictating(true);
    }
  };

  const handleToggleNoteSpeech = () => {
    if (!selectedNote) return;
    if (isPlayingNoteAudio) {
      speechService.stopSpeaking();
      setIsPlayingNoteAudio(false);
    } else {
      setIsPlayingNoteAudio(true);
      const text = `${selectedNote.title}.\n\n${selectedNote.content}`;
      speechService.speak(
        text,
        () => setIsPlayingNoteAudio(false),
        () => setIsPlayingNoteAudio(false),
        effective
      );
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [res, les] = await Promise.all([dao.getLearningResources(), dao.getLessonOptions()]);
        if (!mounted) return;
        setResources(res);
        setLessons(les);
      } catch (err) {
        console.warn('No se pudieron cargar recursos para asociar notas:', err);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!initialNoteId) return;
    const target = notes.find(n => n.id === initialNoteId);
    if (target) {
      setSelectedNote(target);
      setIsCreating(false);
      setIsEditing(false);
    }
  }, [initialNoteId, notes]);

  useEffect(() => {
    if (selectedNote) {
      const updated = notes.find(n => n.id === selectedNote.id);
      if (updated) {
        setSelectedNote(updated);
      } else if (!notes.some(n => n.id === selectedNote.id)) {
        setSelectedNote(notes[0] || null);
      }
    } else if (notes.length > 0 && !isCreating) {
      setSelectedNote(notes[0]);
    }
  }, [notes, selectedNote, isCreating]);

  const handleStartCreate = () => {
    setFormData({
      title: '',
      content: '',
      tags: '',
      resource_id: '',
      lesson_id: ''
    });
    setIsCreating(true);
    setIsEditing(false);
    setActiveTab('write');
  };

  const handleStartEdit = () => {
    if (!selectedNote) return;
    setFormData({
      title: selectedNote.title,
      content: selectedNote.content,
      tags: selectedNote.tags || '',
      resource_id: selectedNote.resource_id || '',
      lesson_id: selectedNote.lesson_id || ''
    });
    setIsEditing(true);
    setIsCreating(false);
    setActiveTab('write');
  };

  const handleCancelForm = () => {
    setIsCreating(false);
    setIsEditing(false);
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) return;

    if (isCreating) {
      await dao.addNote({
        title: formData.title.trim(),
        content: formData.content,
        tags: formData.tags.trim() || undefined,
        resource_id: formData.resource_id || undefined,
        lesson_id: formData.lesson_id || undefined
      });
      setIsCreating(false);
    } else if (isEditing && selectedNote) {
      await dao.updateNote(selectedNote.id, {
        title: formData.title.trim(),
        content: formData.content,
        tags: formData.tags.trim() || undefined,
        resource_id: formData.resource_id || null,
        lesson_id: formData.lesson_id || null
      });
      setIsEditing(false);
    }
    onRefresh();
  };

  const handleDeleteNote = async () => {
    if (!selectedNote) return;
    await dao.deleteNote(selectedNote.id);
    setDeleteConfirmOpen(false);
    setSelectedNote(null);
    onRefresh();
  };

  const resourceName = (id?: string) => resources.find(r => r.id === id)?.title;
  const lessonName = (id?: string) => lessons.find(l => l.id === id)?.title;

  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  const availableTags = useMemo(() => extractUniqueTagsWithCounts(notes), [notes]);

  const filteredNotes = useMemo(() => {
    return filterNotesByQueryAndTag(notes, query, selectedTag);
  }, [notes, query, selectedTag]);

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';
  const LABEL_CLS = 'mb-1 block text-meta font-medium text-muted';

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">{t('notes.title')}</h1>
          <p className="type-secondary mt-1">{t('notes.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notes.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                const md = exportNotesToSingleMarkdown(filteredNotes.length > 0 ? filteredNotes : notes, effective);
                triggerTextDownload(md, `crossedarts-notas-${new Date().toISOString().slice(0, 10)}.md`);
              }}
              title={t('notes.exportAllTitle')}
            >
              <Download size={14} aria-hidden="true" /> {t('notes.exportNotes', { n: filteredNotes.length > 0 ? filteredNotes.length : notes.length })}
            </Button>
          )}
          <Button variant="solid" onClick={handleStartCreate}>
            <Plus size={15} aria-hidden="true" /> {t('notes.newNote')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Note list (left pane) */}
        <div className="md:col-span-1">
          <SearchInput
            label={t('notes.searchLabel')}
            placeholder={t('notes.searchPh')}
            value={query}
            onChange={setQuery}
            className="mb-3"
          />

          {availableTags.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5" role="toolbar" aria-label={t('notes.filterByTag')}>
              <Chip
                active={selectedTag === null}
                onClick={() => setSelectedTag(null)}
              >
                {t('notes.all', { n: notes.length })}
              </Chip>
              {availableTags.map(({ tag, count }) => (
                <Chip
                  key={tag}
                  active={selectedTag === tag}
                  onClick={() => setSelectedTag(prev => prev === tag ? null : tag)}
                >
                  #{tag} ({count})
                </Chip>
              ))}
            </div>
          )}

          <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {filteredNotes.length === 0 ? (
              <div className="rounded-xl border border-line bg-surface/50 p-4 text-center">
                <p className="type-meta text-muted">
                  {notes.length === 0
                    ? t('notes.emptyNone')
                    : selectedTag
                    ? t('notes.emptyTag', { tag: selectedTag, extra: query ? t('notes.emptyTagExtra') : '' })
                    : t('notes.emptySearch')}
                </p>
                {(selectedTag || query) && (
                  <Button
                    size="sm"
                    variant="quiet"
                    className="mt-2 text-micro"
                    onClick={() => {
                      setSelectedTag(null);
                      setQuery('');
                    }}
                  >
                    {t('notes.clearFilters')}
                  </Button>
                )}
              </div>
            ) : (
              filteredNotes.map(note => {
                const isSelected = selectedNote?.id === note.id && !isCreating;
                return (
                  <button
                    key={note.id}
                    onClick={() => {
                      setSelectedNote(note);
                      setIsCreating(false);
                      setIsEditing(false);
                    }}
                    aria-current={isSelected ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-xl border p-3.5 text-left transition-colors duration-fast',
                      isSelected
                        ? 'border-accent/40 bg-accent-soft shadow-card'
                        : 'border-line bg-surface hover:border-line-strong'
                    )}
                  >
                    <h4 className="truncate text-meta font-semibold text-ink">{note.title}</h4>
                    <p className="mt-1 line-clamp-2 text-meta text-muted">{note.content}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-micro">
                      <span className="flex items-center gap-1">
                        <Calendar size={10} aria-hidden="true" /> {note.created_at?.slice(0, 10)}
                      </span>
                      {note.tags && (
                        <div className="flex flex-wrap items-center gap-1 text-accent">
                          <Tag size={10} aria-hidden="true" />
                          {note.tags
                            .split(',')
                            .map(tag => tag.trim())
                            .filter(tag => tag && !tag.startsWith('sha256:'))
                            .map(tag => (
                              <span
                                key={tag}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedTag(prev => prev === tag.toLowerCase() ? null : tag.toLowerCase());
                                }}
                                className="cursor-pointer hover:underline"
                                title={t('notes.filterBy', { tag })}
                              >
                                #{tag}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Document reader / editor (right pane) */}
        <div className="min-h-[450px] rounded-xl border border-line bg-surface p-6 shadow-card md:col-span-2 sm:p-8">
          {isCreating || isEditing ? (
            <form onSubmit={handleSubmitForm} className="space-y-4">
              <div className="flex items-center justify-between border-b border-line pb-3">
                <h3 className="type-section text-ink">
                  {isCreating ? t('notes.createTitle') : t('notes.editTitle', { title: selectedNote?.title ?? '' })}
                </h3>
                <div className="flex items-center gap-1 rounded-lg border border-line bg-canvas p-1" role="tablist">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'write'}
                    onClick={() => setActiveTab('write')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                      activeTab === 'write' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                    )}
                  >
                    <PenTool size={12} aria-hidden="true" /> {t('notes.write')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'preview'}
                    onClick={() => setActiveTab('preview')}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-meta font-medium transition-colors',
                      activeTab === 'preview' ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'
                    )}
                  >
                    <Eye size={12} aria-hidden="true" /> {t('notes.preview')}
                  </button>
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="note-title">{t('notes.titleLabel')}</label>
                <input
                  id="note-title"
                  type="text"
                  value={formData.title}
                  onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder={t('notes.titlePh')}
                  required
                  className={INPUT_CLS}
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className={LABEL_CLS} htmlFor="note-tags">{t('notes.tagsLabel')}</label>
                  <input
                    id="note-tags"
                    type="text"
                    value={formData.tags}
                    onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))}
                    placeholder="react, hooks, architecture"
                    className={INPUT_CLS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="note-resource">{t('notes.resourceLabel')}</label>
                  <select
                    id="note-resource"
                    value={formData.resource_id}
                    onChange={e => setFormData(f => ({ ...f, resource_id: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">{t('notes.noResource')}</option>
                    {resources.map(r => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="note-lesson">{t('notes.lessonLabel')}</label>
                  <select
                    id="note-lesson"
                    value={formData.lesson_id}
                    onChange={e => setFormData(f => ({ ...f, lesson_id: e.target.value }))}
                    className={INPUT_CLS}
                  >
                    <option value="">{t('notes.noLesson')}</option>
                    {lessons.map(l => (
                      <option key={l.id} value={l.id}>{l.courseTitle} › {l.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              {activeTab === 'write' ? (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className={LABEL_CLS} htmlFor="note-content">{t('notes.contentLabel')}</label>
                    <button
                      type="button"
                      onClick={handleToggleDictation}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-meta font-medium border transition-colors cursor-pointer",
                        isDictating
                          ? "border-accent bg-accent-soft text-accent animate-pulse font-semibold"
                          : "border-line bg-surface text-muted hover:text-ink hover:bg-canvas"
                      )}
                      title={isDictating ? t('notes.dictStop') : t('notes.dictStart')}
                    >
                      {isDictating ? <MicOff size={13} className="text-accent" /> : <Mic size={13} />}
                      <span>{isDictating ? t('notes.listening') : t('notes.dictate')}</span>
                    </button>
                  </div>
                  {dictationError && (
                    <p className="text-meta text-error mb-1.5">{dictationError}</p>
                  )}
                  <textarea
                    ref={textareaRef}
                    id="note-content"
                    value={formData.content}
                    onChange={e => setFormData(f => ({ ...f, content: e.target.value }))}
                    placeholder={t('notes.contentPh')}
                    rows={12}
                    className={cn(INPUT_CLS, 'resize-y font-mono text-secondary')}
                  />
                </div>
              ) : (
                <div className="min-h-[280px] rounded-lg border border-line bg-canvas p-4">
                  {formData.content.trim() ? (
                    <MarkdownViewer content={formData.content} />
                  ) : (
                    <p className="type-meta italic text-muted">{t('notes.previewHint')}</p>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 border-t border-line pt-3">
                <Button variant="quiet" onClick={handleCancelForm}>
                  <X size={14} aria-hidden="true" /> {t('notes.cancel')}
                </Button>
                <Button variant="solid" type="submit">
                  <Save size={14} aria-hidden="true" /> {isCreating ? t('notes.saveNote') : t('notes.saveChanges')}
                </Button>
              </div>
            </form>
          ) : selectedNote ? (
            <article className="space-y-4">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
                <div className="min-w-0">
                  <h2 className="type-title text-ink break-words">{selectedNote.title}</h2>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-meta">{t('notes.date', { date: selectedNote.created_at?.slice(0, 10) ?? '' })}</span>
                    {selectedNote.tags && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {selectedNote.tags
                          .split(',')
                          .map(tag => tag.trim())
                          .filter(tag => tag && !tag.startsWith('sha256:'))
                          .map(tag => {
                            const isCurrentTag = selectedTag === tag.toLowerCase();
                            return (
                              <button
                                key={tag}
                                type="button"
                                onClick={() => setSelectedTag(prev => prev === tag.toLowerCase() ? null : tag.toLowerCase())}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-micro font-medium transition-colors cursor-pointer",
                                  isCurrentTag
                                    ? "bg-accent text-on-accent shadow-sm"
                                    : "bg-surface text-muted border border-line hover:text-ink hover:border-line-strong"
                                )}
                                title={t('notes.filterListBy', { tag })}
                              >
                                <Tag size={10} aria-hidden="true" /> #{tag}
                              </button>
                            );
                          })}
                      </div>
                    )}
                  </div>
                  {(selectedNote.resource_id || selectedNote.lesson_id) && (
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-meta">
                      <span className="inline-flex items-center gap-1 text-faint">
                        <Link2 size={11} aria-hidden="true" /> {t('notes.linkedAs')}
                      </span>
                      {resourceName(selectedNote.resource_id) && (
                        <Badge tone="info">
                          <GraduationCap size={10} aria-hidden="true" /> {resourceName(selectedNote.resource_id)}
                        </Badge>
                      )}
                      {lessonName(selectedNote.lesson_id) && (
                        <Badge tone="neutral">
                          <FileText size={10} aria-hidden="true" /> {lessonName(selectedNote.lesson_id)}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleNoteSpeech}
                    title={isPlayingNoteAudio ? t('notes.stopReading') : t('notes.readAloud')}
                  >
                    {isPlayingNoteAudio ? <VolumeX size={13} className="text-accent animate-pulse" /> : <Volume2 size={13} />}
                    {isPlayingNoteAudio ? t('notes.stop') : t('notes.listen')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const md = exportNoteToMarkdown(selectedNote, {
                        resourceTitle: resourceName(selectedNote.resource_id),
                        lessonTitle: lessonName(selectedNote.lesson_id)
                      }, effective);
                      const safeTitle = selectedNote.title.toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 30);
                      triggerTextDownload(md, `${safeTitle || 'nota'}.md`);
                    }}
                    title={t('notes.exportOneTitle')}
                  >
                    <Download size={13} aria-hidden="true" /> {t('notes.exportMd')}
                  </Button>
                  <Button size="sm" variant="outline" onClick={handleStartEdit}>
                    <Edit3 size={13} aria-hidden="true" /> {t('notes.edit')}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteConfirmOpen(true)}>
                    <Trash2 size={13} aria-hidden="true" /> {t('notes.delete')}
                  </Button>
                </div>
              </header>

              <div className="p-1">
                <MarkdownViewer content={selectedNote.content} />
              </div>
            </article>
          ) : (
            <EmptyState
              icon={<FileText size={30} aria-hidden="true" />}
              title={t('notes.selectNote')}
              hint={t('notes.selectHint')}
            />
          )}
        </div>
      </div>

      {/* Accessible confirmation dialog for note deletion */}
      <ConfirmDialog
        isOpen={deleteConfirmOpen}
        title={t('notes.deleteTitle')}
        consequence={t('notes.deleteCons', { title: selectedNote?.title ?? '' })}
        confirmLabel={t('notes.deleteTitle')}
        cancelLabel={t('notes.cancel')}
        tone="danger"
        onConfirm={handleDeleteNote}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
};
