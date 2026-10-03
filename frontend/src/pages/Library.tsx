import React, { useState } from 'react';
import { Course, Book } from '../types/models.ts';
import { Search, FolderOpen, Play, BookOpen, Layers, Plus } from 'lucide-react';

interface LibraryProps {
  courses: Course[];
  books: Book[];
  onSelectCourse: (id: string) => void;
  onMountLocalFolder: () => void;
}

export const Library: React.FC<LibraryProps> = ({ courses, books, onSelectCourse, onMountLocalFolder }) => {
  const [filter, setFilter] = useState<'all' | 'courses' | 'books'>('all');
  const [query, setQuery] = useState('');

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
                  <div className="relative h-36 rounded-lg overflow-hidden mb-3 border border-slate-800">
                    <img src={course.cover_path} alt={course.title} className="w-full h-full object-cover group-hover:scale-105 transition duration-300" />
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
                <img src={book.cover_path} alt={book.title} className="w-16 h-22 rounded-md object-cover border border-slate-700 shadow-md" />
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-medium text-indigo-400 uppercase tracking-wider">{book.category}</span>
                  <h4 className="font-semibold text-xs text-slate-100 truncate">{book.title}</h4>
                  <p className="text-[11px] text-slate-400 truncate">{book.author}</p>
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                      <span>{book.current_page || 0}/{book.page_count} pág</span>
                      <span className="font-bold text-indigo-400">{book.reading_percentage}%</span>
                    </div>
                    <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${book.reading_percentage}%` }} />
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
