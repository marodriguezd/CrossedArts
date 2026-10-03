import React, { useState } from 'react';
import { Download, Upload, RotateCcw, Bot, ShieldCheck, Database, HardDrive, Check } from 'lucide-react';
import { exportSqliteFile, importSqliteFile, exportJsonBackup } from '../db/exportImport.ts';
import { dbBridge } from '../db/sqliteBridge.ts';
import { aiService, AISettings } from '../ai/aiService.ts';

interface SettingsViewProps {
  onDataReset: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({ onDataReset }) => {
  const [aiConfig, setAiConfig] = useState<AISettings>(aiService.getSettings());
  const [savedSuccess, setSavedSuccess] = useState(false);

  const handleSaveAi = (e: React.FormEvent) => {
    e.preventDefault();
    aiService.saveSettings(aiConfig);
    setSavedSuccess(true);
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await importSqliteFile(file);
      alert('¡Base de datos importada exitosamente!');
      onDataReset();
    } catch (err: any) {
      alert('Error importando base de datos: ' + err.message);
    }
  };

  const handleResetDemo = async () => {
    if (confirm('¿Restablecer datos a la versión de demostración inicial? Los cambios actuales se sobreescribirán.')) {
      await dbBridge.resetDemo();
      onDataReset();
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-extrabold text-white">Ajustes & Gestión de Datos</h1>
        <p className="text-xs text-slate-400">Configura la persistencia local, respaldos SQLite y proveedores de IA</p>
      </div>

      {/* Persistencia & Backups */}
      <div className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Database size={18} className="text-purple-400" />
          <span>Base de Datos Local (SQLite WASM & IndexedDB)</span>
        </div>
        <p className="text-xs text-slate-300">
          CrossedArts almacena todas tus entidades (cursos, libros, notas, flashcards SM-2) en un archivo SQLite relacional dentro de tu navegador.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
          <button
            onClick={() => exportSqliteFile()}
            className="flex items-center justify-center gap-2 p-3 rounded-xl bg-purple-600/20 hover:bg-purple-600/30 text-purple-200 border border-purple-500/30 text-xs font-semibold transition"
          >
            <Download size={15} /> Exportar .sqlite
          </button>

          <button
            onClick={() => exportJsonBackup()}
            className="flex items-center justify-center gap-2 p-3 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 border border-indigo-500/30 text-xs font-semibold transition"
          >
            <Download size={15} /> Exportar JSON
          </button>

          <label className="flex items-center justify-center gap-2 p-3 rounded-xl bg-slate-800 hover:bg-slate-750 text-slate-200 border border-slate-700 text-xs font-semibold cursor-pointer transition">
            <Upload size={15} /> Importar .sqlite
            <input type="file" accept=".sqlite,.db" onChange={handleFileUpload} className="hidden" />
          </label>
        </div>

        <div className="pt-2">
          <button
            onClick={handleResetDemo}
            className="flex items-center gap-2 text-xs text-rose-400 hover:text-rose-300 font-medium"
          >
            <RotateCcw size={13} /> Reiniciar datos al dataset de demostración
          </button>
        </div>
      </div>

      {/* IA & LLM Provider Configuration */}
      <form onSubmit={handleSaveAi} className="p-6 rounded-2xl bg-slate-900/50 border border-slate-800 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold text-white">
          <Bot size={18} className="text-purple-400" />
          <span>Configuración del Tutor IA & Modelos</span>
        </div>
        <p className="text-xs text-slate-300">
          Elige entre el asistente de demostración offline, tu servidor local de Ollama (con privacidad total), o API Keys comerciales.
        </p>

        <div className="space-y-3 pt-2">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Proveedor de Inferencia:</label>
            <select
              value={aiConfig.provider}
              onChange={e => setAiConfig({ ...aiConfig, provider: e.target.value as any })}
              className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
            >
              <option value="demo">Modo Demostración / Offline Educativo</option>
              <option value="ollama">Ollama Local (http://localhost:11434)</option>
              <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
            </select>
          </div>

          {aiConfig.provider === 'ollama' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">URL de Ollama:</label>
                <input
                  type="text"
                  value={aiConfig.ollamaUrl}
                  onChange={e => setAiConfig({ ...aiConfig, ollamaUrl: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Modelo de Ollama:</label>
                <input
                  type="text"
                  value={aiConfig.ollamaModel}
                  onChange={e => setAiConfig({ ...aiConfig, ollamaModel: e.target.value })}
                  placeholder="llama3:8b"
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
                />
              </div>
            </div>
          )}

          {aiConfig.provider === 'openai' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">OpenAI API Key:</label>
              <input
                type="password"
                value={aiConfig.apiKey}
                onChange={e => setAiConfig({ ...aiConfig, apiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
              />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-2">
          {savedSuccess && (
            <span className="text-xs text-emerald-400 flex items-center gap-1">
              <Check size={14} /> Preferencias guardadas correctamente
            </span>
          )}
          <button
            type="submit"
            className="ml-auto px-4 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25"
          >
            Guardar Configuración
          </button>
        </div>
      </form>
    </div>
  );
};
