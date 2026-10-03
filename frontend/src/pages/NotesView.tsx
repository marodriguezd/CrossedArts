import React, { useState } from 'react';
import { Note } from '../types/models.ts';
import { FileText, Plus, Tag, Calendar, Save } from 'lucide-react';
import { dao } from '../db/dao.ts';

interface NotesViewProps {
  notes: Note[];
  onRefresh: () => void;
}

export const NotesView: React.FC<NotesViewProps> = ({ notes, onRefresh }) => {
  const [selectedNote, setSelectedNote] = useState<Note | null>(notes[0] || null);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newTags, setNewTags] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await dao.addNote({
      title: newTitle,
      content: newContent,
      tags: newTags
    });
    setNewTitle('');
    setNewContent('');
    setNewTags('');
    setIsCreating(false);
    onRefresh();
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <FileText size={24} className="text-purple-400" /> Notas de Estudio & Cuaderno
          </h1>
          <p className="text-xs text-slate-400">Toma de apuntes vinculados a tus recursos con formato Markdown</p>
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
                <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
                  <span>Fecha: {selectedNote.created_at}</span>
                  {selectedNote.tags && (
                    <span className="px-2 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800 text-[10px]">
                      {selectedNote.tags}
                    </span>
                  )}
                </div>
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
