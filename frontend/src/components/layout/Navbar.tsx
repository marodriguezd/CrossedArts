import React from 'react';
import { 
  LayoutDashboard, 
  Library, 
  BrainCircuit, 
  Network, 
  BookOpen, 
  FileText, 
  Settings, 
  Download, 
  Upload, 
  Bot 
} from 'lucide-react';
import { exportSqliteFile } from '../../db/exportImport.ts';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  openAIPanel: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, setCurrentTab, openAIPanel }) => {
  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'library', label: 'Biblioteca', icon: Library },
    { id: 'review', label: 'Repaso SM-2', icon: BrainCircuit },
    { id: 'graph', label: 'Grafo', icon: Network },
    { id: 'notes', label: 'Notas', icon: FileText },
    { id: 'settings', label: 'Ajustes', icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentTab('dashboard')}>
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-purple-500/20 text-white font-bold text-xl">
            🏛️
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-purple-400 via-indigo-300 to-white bg-clip-text text-transparent">
                DomestiK
              </span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                PAGES
              </span>
            </div>
            <p className="text-[11px] text-slate-400">Learning Operating System</p>
          </div>
        </div>

        {/* Navigation items */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                  active
                    ? 'bg-purple-600/15 text-purple-400 border border-purple-500/30 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportSqliteFile()}
            title="Exportar base de datos SQLite (.sqlite)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-900 border border-slate-800 hover:border-slate-700 hover:bg-slate-850 transition"
          >
            <Download size={14} className="text-purple-400" />
            <span className="hidden sm:inline">Backup .db</span>
          </button>

          <button
            onClick={openAIPanel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 shadow-md shadow-purple-600/25 transition active:scale-95"
          >
            <Bot size={15} />
            <span>Tutor IA</span>
          </button>
        </div>
      </div>
    </header>
  );
};
