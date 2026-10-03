import React, { useState, useEffect } from 'react';
import { Note, LearningResource } from '../types/models.ts';
import { FileText, Plus, Tag, Calendar, Save, Link2, GraduationCap } from 'lucide-react';
import { dao } from '../db/dao.ts';

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

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <FileText size={24} className="text-purple-400" /> Notas de Estudio & Cuaderno
          </h1>
          <p className="text-xs text-slate-400">Toma de apuntes vinculados a tus recursos y lecciones</p>
        </div>
        <button
          onClick={() => setIsCreating(true)}
          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition"
        >
          <Plus size={15} /> Nueva Nota
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Notes sidebar */}
        <div className="space-y-2 md:col-span-1 max-h-[600px] overflow-y-auto">
          {notes.map(note => {
            const isSelected = selectedNote?.id === note.id && !isCreating;
            return (
              <div
                key={note.id}
                onClick={() => { setSelectedNote(note); setIsCreating(false); }}
                className={`p-3.5 rounded-xl border cursor-pointer transition ${
                  isSelected
                    ? 'bg-purple-600/20 border-purple-500/40 text-purple-200 shadow-md'
                    : 'bg-slate-900/50 hover:bg-slate-900 border-slate-800 text-slate-300'
                }`}
              >
                <h4 className="font-semibold text-xs text-slate-100 truncate">{note.title}</h4>
                <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{note.content}</p>
                <div className="flex items-center gap-2 mt-2 text-[10px] text-slate-500">
                  <span className="flex items-center gap-1"><Calendar size={10} /> {note.created_at?.slice(0, 10)}</span>
                  {note.tags && <span className="flex items-center gap-1 text-purple-400"><Tag size={10} /> {note.tags}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* Note Editor or Reader */}
        <div className="md:col-span-2 rounded-2xl bg-slate-900/50 border border-slate-800 p-6 min-h-[450px]">
          {isCreating ? (
            <form onSubmit={handleCreateNote} className="space-y-4">
              <h3 className="text-sm font-bold text-white">Crear Nueva Nota</h3>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="Título del apunte o concepto..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-white focus:outline-none focus:border-purple-500"
                required
              />
              <input
                type="text"
                value={newTags}
                onChange={e => setNewTags(e.target.value)}
                placeholder="Etiquetas (separadas por coma, ej: react, hooks, arquitectura)"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-purple-500"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1" htmlFor="note-resource">Asociar a recurso (opcional)</label>
                  <select
                    id="note-resource"
                    value={newResourceId}
                    onChange={e => setNewResourceId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Sin recurso</option>
                    {resources.map(r => (
                      <option key={r.id} value={r.id}>{r.title}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-300 mb-1" htmlFor="note-lesson">Asociar a lección (opcional)</label>
                  <select
                    id="note-lesson"
                    value={newLessonId}
                    onChange={e => setNewLessonId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500"
                  >
                    <option value="">Sin lección</option>
                    {lessons.map(l => (
                      <option key={l.id} value={l.id}>{l.courseTitle} › {l.title}</option>
                    ))}
                  </select>
                </div>
              </div>

              <textarea
                value={newContent}
                onChange={e => setNewContent(e.target.value)}
                placeholder="Escribe tus notas y reflexiones aquí..."
                rows={10}
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-purple-500 font-mono"
              />
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsCreating(false)}
                  className="px-3 py-1.5 rounded-lg text-xs text-slate-400 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/30"
                >
                  <Save size={14} /> Guardar Nota en SQLite
                </button>
              </div>
            </form>
          ) : selectedNote ? (
            <div className="space-y-4">
              <div className="border-b border-slate-800 pb-4">
                <h2 className="text-xl font-bold text-white">{selectedNote.title}</h2>
                <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-slate-400">
                  <span>Fecha: {selectedNote.created_at}</span>
                  {selectedNote.tags && (
                    <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px]">
                      {selectedNote.tags}
                    </span>
                  )}
                </div>
                {(selectedNote.resource_id || selectedNote.lesson_id) && (
                  <div className="flex flex-wrap items-center gap-2 mt-2 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-slate-400"><Link2 size={11} /> Asociada a:</span>
                    {resourceName(selectedNote.resource_id) && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-indigo-300 border border-slate-700">
                        <GraduationCap size={10} /> {resourceName(selectedNote.resource_id)}
                      </span>
                    )}
                    {lessonName(selectedNote.lesson_id) && (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-slate-700">
                        <FileText size={10} /> {lessonName(selectedNote.lesson_id)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
                {selectedNote.content}
              </div>
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-xs text-slate-500">
              Selecciona una nota para leer o haz clic en 'Nueva Nota'.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
