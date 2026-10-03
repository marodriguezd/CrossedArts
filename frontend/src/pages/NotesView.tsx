import React, { useState, useEffect, useMemo } from 'react';
import { Note, LearningResource } from '../types/models.ts';
import { FileText, Plus, Tag, Calendar, Save, Link2, GraduationCap } from 'lucide-react';
import { dao } from '../db/dao.ts';
import { Button, SearchInput, Badge, EmptyState, cn } from '../components/ui/index.tsx';

interface NotesViewProps {
  notes: Note[];
  onRefresh: () => void;
  initialNoteId?: string | null;
}

export const NotesView: React.FC<NotesViewProps> = ({ notes, onRefresh, initialNoteId }) => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(notes[0] || null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [newResourceId, setNewResourceId] = useState('');
  const [newLessonId, setNewLessonId] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [resources, setResources] = useState<LearningResource[]>([]);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string; courseTitle: string }>>([]);
  const [query, setQuery] = useState('');

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
    }
  }, [initialNoteId, notes]);

  useEffect(() => {
    if (selectedNote && !notes.some(n => n.id === selectedNote.id)) {
      setSelectedNote(notes[0] || null);
    }
  }, [notes, selectedNote]);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await dao.addNote({
      title: newTitle,
      content: newContent,
      tags: newTags,
      resource_id: newResourceId || undefined,
      lesson_id: newLessonId || undefined
    });
    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setNewResourceId('');
    setNewLessonId('');
    setIsCreating(false);
    onRefresh();
  };

  const resourceName = (id?: string) => resources.find(r => r.id === id)?.title;
  const lessonName = (id?: string) => lessons.find(l => l.id === id)?.title;

  // Filtro local sobre títulos, contenido y etiquetas (sin red, sobre datos existentes).
  const filteredNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(n =>
      n.title.toLowerCase().includes(q) ||
      n.content.toLowerCase().includes(q) ||
      (n.tags || '').toLowerCase().includes(q)
    );
  }, [notes, query]);

  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none';
  const LABEL_CLS = 'mb-1 block text-meta font-medium text-muted';

  return (
    <div className="animate-fade-in space-y-6">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Notas</h1>
          <p className="type-secondary mt-1">Tus notas, ideas y referencias siempre a mano.</p>
        </div>
        <Button variant="solid" onClick={() => setIsCreating(true)}>
          <Plus size={15} aria-hidden="true" /> Nueva nota
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Lista de notas (izquierda) */}
        <div className="md:col-span-1">
          <SearchInput
            label="Buscar notas"
            placeholder="Buscar notas…"
            value={query}
            onChange={setQuery}
            className="mb-3"
          />
          <div className="max-h-[600px] space-y-2 overflow-y-auto pr-1">
            {filteredNotes.length === 0 ? (
              <p className="type-meta px-1">
                {notes.length === 0 ? 'Aún no hay notas.' : 'Sin coincidencias para esa búsqueda.'}
              </p>
            ) : (
              filteredNotes.map(note => {
                const isSelected = selectedNote?.id === note.id && !isCreating;
                return (
                  <button
                    key={note.id}
                    onClick={() => { setSelectedNote(note); setIsCreating(false); }}
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
                        <span className="flex items-center gap-1 text-accent">
                          <Tag size={10} aria-hidden="true" /> {note.tags}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* Lector / editor del documento (derecha) */}
        <div className="min-h-[450px] rounded-xl border border-line bg-surface p-6 shadow-card md:col-span-2 sm:p-8">
          {isCreating ? (
            <form onSubmit={handleCreateNote} className="space-y-4">
              <h3 className="type-section text-ink">Crear nueva nota</h3>
              <div>
                <label className={LABEL_CLS} htmlFor="note-title">Título</label>
                <input
                  id="note-title"
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder="Título del apunte o concepto…"
                  className={INPUT_CLS}
                  required
                />
              </div>
              <div>
                <label className={LABEL_CLS} htmlFor="note-tags">Etiquetas</label>
                <input
                  id="note-tags"
                  type="text"
                  value={newTags}
                  onChange={e => setNewTags(e.target.value)}
                  placeholder="Separadas por coma, ej: react, hooks, arquitectura"
                  className={INPUT_CLS}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className={LABEL_CLS} htmlFor="note-resource">Asociar a recurso (opcional)</label>
                  <select
                    id="note-resource"
                    value={newResourceId}
                    onChange={e => setNewResourceId(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">Sin recurso</option>
                    {resources.map(r => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={LABEL_CLS} htmlFor="note-lesson">Asociar a lección (opcional)</label>
                  <select
                    id="note-lesson"
                    value={newLessonId}
                    onChange={e => setNewLessonId(e.target.value)}
                    className={INPUT_CLS}
                  >
                    <option value="">Sin lección</option>
                    {lessons.map(l => (
                      <option key={l.id} value={l.id}>{l.courseTitle} › {l.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={LABEL_CLS} htmlFor="note-content">Contenido</label>
                <textarea
                  id="note-content"
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  placeholder="Escribe tus notas y reflexiones aquí…"
                  rows={10}
                  className={cn(INPUT_CLS, 'resize-y font-mono text-secondary')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="quiet" onClick={() => setIsCreating(false)}>
                  Cancelar
                </Button>
                <Button variant="solid" type="submit">
                  <Save size={14} aria-hidden="true" /> Guardar nota en SQLite
                </Button>
              </div>
            </form>
          ) : selectedNote ? (
            <article className="space-y-4">
              {/* Cabecera documental de la nota */}
              <header className="border-b border-line pb-4">
                <h2 className="font-serif text-title font-bold text-ink">{selectedNote.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <span className="text-meta">Fecha: {selectedNote.created_at}</span>
                  {selectedNote.tags && <Badge tone="accent">{selectedNote.tags}</Badge>}
                </div>
                {(selectedNote.resource_id || selectedNote.lesson_id) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-meta">
                    <span className="inline-flex items-center gap-1 text-faint">
                      <Link2 size={11} aria-hidden="true" /> Asociada a:
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
              </header>
              {/* Contenido con tipografía de lectura */}
              <div className="max-w-[68ch] whitespace-pre-wrap break-words text-body text-ink" style={{ lineHeight: 1.75 }}>
                {selectedNote.content}
              </div>
            </article>
          ) : (
            <EmptyState
              icon={<FileText size={30} aria-hidden="true" />}
              title="Selecciona una nota"
              hint="Elige una nota de la lista para leerla o pulsa «Nueva nota» para crearla."
            />
          )}
        </div>
      </div>
    </div>
  );
};
