import React, { useState } from 'react';
import { X, Send, Bot, Sparkles, User, RefreshCw, Cpu, Database, AlertCircle } from 'lucide-react';
import { aiService, AIChatMessage, AssistantResponse } from '../../ai/aiService.ts';

interface MessageItem extends AIChatMessage {
  sources?: string[];
  isLocalOnDevice?: boolean;
  retrievalMode?: 'hybrid' | 'lexical';
}

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeContext: string;
  /** Recurso activo: prioriza de forma determinista su contexto relacionado en el RAG. */
  activeResourceId?: string;
  /** Lección activa: extiende el ámbito determinista de recuperación a la lección. */
  activeLessonId?: string;
}

export const AIAssistantDrawer: React.FC<AIAssistantDrawerProps> = ({ isOpen, onClose, activeContext, activeResourceId, activeLessonId }) => {
  const retrievalScope = (activeResourceId || activeLessonId)
    ? { resourceId: activeResourceId, lessonId: activeLessonId }
    : undefined;
  const [messages, setMessages] = useState<MessageItem[]>([
    {
      role: 'assistant',
      content: '¡Hola! Soy tu tutor pedagógico de CrossedArts. Puedo responder dudas sobre tus cursos, libros y notas usando recuperación local en tu dispositivo. ¿En qué te ayudo hoy?'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const currentSettings = aiService.getSettings();

  if (!isOpen) return null;

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: MessageItem = { role: 'user', content: input };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      const response: AssistantResponse = await aiService.askTutor(
        newHistory.map(m => ({ role: m.role, content: m.content })),
        activeContext,
        undefined,
        retrievalScope
      );
      setMessages([
        ...newHistory,
        {
          role: 'assistant',
          content: response.answer,
          sources: response.sources,
          isLocalOnDevice: response.isLocalOnDevice,
          retrievalMode: response.retrievalMode
        }
      ]);
    } catch (err: any) {
      setMessages([
        ...newHistory,
        {
          role: 'assistant',
          content: `Error consultando al tutor: ${err?.message || 'Error desconocido'}`
        }
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[440px] bg-slate-950 border-l border-slate-800 shadow-2xl flex flex-col animate-slide-left">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20">
            <Bot size={18} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h3 className="font-bold text-sm text-white">Tutor Pedagógico</h3>
              {currentSettings.provider === 'local' ? (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-950/80 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                  <Cpu size={10} /> On-Device WebLLM
                </span>
              ) : (
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-purple-950/80 text-purple-400 border border-purple-500/30">
                  {currentSettings.provider.toUpperCase()}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate max-w-[280px]">Contexto: {activeContext || 'General'}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800">
          <X size={18} />
        </button>
      </div>

      {/* Messages thread */}
      <div className="flex-1 p-4 overflow-y-auto space-y-3">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div className={`flex gap-2.5 max-w-[90%] ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-purple-600/30 text-purple-300 flex items-center justify-center shrink-0 mt-1">
                  <Bot size={12} />
                </div>
              )}
              <div
                className={`p-3 rounded-2xl text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-purple-600 text-white rounded-tr-none'
                    : 'bg-slate-900 text-slate-200 border border-slate-800 rounded-tl-none whitespace-pre-wrap'
                }`}
              >
                {m.content}

                {/* Fuentes RAG recuperadas de SQLite */}
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-800 text-[10px] text-slate-400">
                    <span className="font-semibold text-slate-300 flex items-center justify-between gap-1 mb-1">
                      <span className="flex items-center gap-1">
                        <Database size={11} className="text-purple-400" /> Fuentes locales consultadas:
                      </span>
                      {m.retrievalMode && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${
                          m.retrievalMode === 'hybrid'
                            ? 'bg-purple-950/80 text-purple-300 border border-purple-800/50'
                            : 'bg-slate-800 text-slate-400'
                        }`}>
                          {m.retrievalMode === 'hybrid' ? '⚡ Híbrido' : 'Léxico'}
                        </span>
                      )}
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-slate-400">
                      {m.sources.map((s, sIdx) => (
                        <li key={sIdx} className="truncate">{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {m.role === 'user' && (
                <div className="w-6 h-6 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center shrink-0 mt-1">
                  <User size={12} />
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2 items-center text-xs text-purple-400 p-2">
            <RefreshCw size={14} className="animate-spin" />
            <span>Consultando y recuperando contexto local...</span>
          </div>
        )}
      </div>

      {/* Quick Action: Explicar este recurso */}
      {activeContext && activeContext !== 'General' && activeContext !== 'dashboard' && activeContext !== 'settings' && (
        <div className="px-3 pt-2 pb-1 border-t border-slate-800/60 bg-slate-900/40 flex items-center justify-between">
          <button
            type="button"
            onClick={async () => {
              if (loading) return;
              const promptMsg = `Explicar recurso: ${activeContext}`;
              const userMsg: MessageItem = { role: 'user', content: `📖 Explicar este recurso: "${activeContext}"` };
              const newHistory = [...messages, userMsg];
              setMessages(newHistory);
              setLoading(true);
              try {
                const response = await aiService.explainResource(activeContext, undefined, retrievalScope);
                setMessages([
                  ...newHistory,
                  {
                    role: 'assistant',
                    content: response.answer,
                    sources: response.sources,
                    isLocalOnDevice: response.isLocalOnDevice,
                    retrievalMode: response.retrievalMode
                  }
                ]);
              } catch (err: any) {
                setMessages([
                  ...newHistory,
                  {
                    role: 'assistant',
                    content: `Error al explicar recurso: ${err?.message || 'Error desconocido'}`
                  }
                ]);
              } finally {
                setLoading(false);
              }
            }}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-500/30 text-[11px] font-medium text-indigo-300 hover:text-white transition disabled:opacity-50"
          >
            <Sparkles size={12} className="text-indigo-400" />
            <span>Explicar este recurso</span>
          </button>
          <span className="text-[10px] text-slate-500 truncate max-w-[160px]">{activeContext}</span>
        </div>
      )}

      {/* Chat input */}
      <form onSubmit={handleSend} className="p-3 border-t border-slate-800 bg-slate-900/60 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Pregunta sobre tus cursos, libros o notas..."
          className="flex-1 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white focus:outline-none focus:border-purple-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white transition shadow-md shadow-purple-600/25"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
};
