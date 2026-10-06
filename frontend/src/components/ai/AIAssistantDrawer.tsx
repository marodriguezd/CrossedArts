import React, { useEffect, useRef, useState } from 'react';
import { X, Send, Bot, Sparkles, User, RefreshCw, Cpu, Database, AlertCircle, ArrowUpRight } from 'lucide-react';
import { aiService, AIChatMessage, AssistantResponse, type AISettings, type AIProvider } from '../../ai/aiService.ts';
import type { RagSourceCitation } from '../../lib/localRag/contextBuilder.ts';
import { localLlmEngine } from '../../lib/localLlm/engine.ts';
import { cn, Button, ProgressBar } from '../ui/index.tsx';
import { MessageBody, SourceTitle } from './MarkdownMessage.ts';
import { localAiRuntime, type LocalAiStatus } from '../../services/localAiRuntime.ts';

interface MessageItem extends AIChatMessage {
  sources?: string[];
  isLocalOnDevice?: boolean;
  retrievalMode?: 'hybrid' | 'lexical' | 'semantic';
  /** Citas estructuradas de la respuesta final (ausente en streaming/saludos). */
  citations?: RagSourceCitation[];
  /** Modelo concreto que generó la respuesta final. */
  modelUsed?: string;
  /** Proveedor que generó la respuesta final. */
  provider?: AIProvider;
}

interface AIAssistantDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeContext: string;
  /** Recurso activo: prioriza de forma determinista su contexto relacionado en el RAG. */
  activeResourceId?: string;
  /** Lección activa: extiende el ámbito determinista de recuperación a la lección. */
  activeLessonId?: string;
  /** Abre la fuente de una cita en su vista de origen (navegación determinista). */
  onOpenCitation?: (citation: RagSourceCitation) => void;
}

/** Etiquetas de tipo para las rutas de procedencia de las citas. */
const CITATION_TYPE_LABELS: Record<RagSourceCitation['sourceType'], string> = {
  course: 'Curso',
  lesson: 'Lección',
  book: 'Libro',
  note: 'Nota',
  concept: 'Concepto',
  flashcard: 'Tarjeta'
};

const PROVIDER_LABELS: Record<AIProvider, string> = {
  demo: 'Modo demo local',
  local: 'IA local en tu dispositivo',
  ollama: 'Ollama local',
  openai: 'OpenAI'
};

/**
 * Cajón del tutor pedagógico. Mantiene visible el contexto activo, las fuentes
 * RAG recuperadas de SQLite y el PROVEEDOR real: nunca sugiere que una
 * interacción con proveedor remoto ocurre en el dispositivo.
 */
export const AIAssistantDrawer: React.FC<AIAssistantDrawerProps> = ({ isOpen, onClose, activeContext, activeResourceId, activeLessonId, onOpenCitation }) => {
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
  const [runtimeStatus, setRuntimeStatus] = useState<LocalAiStatus>(localAiRuntime.getStatus());
  const [consentDismissed, setConsentDismissed] = useState(false);
  const [currentSettings, setCurrentSettings] = useState<AISettings>(aiService.getSettings());
  const inputRef = useRef<HTMLInputElement>(null);

  // Sincronizar ajustes en tiempo real cuando el usuario cambie de proveedor
  useEffect(() => aiService.subscribeSettings(setCurrentSettings), []);

  // Accesibilidad del cajón: Escape cierra el cajón, pero primero permite
  // descartar el consentimiento cuando el modal de activación está abierto.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const consentIsOpen =
          localAiRuntime.getStatus().stage === 'consent-required' && !consentDismissed;
        if (consentIsOpen) {
          e.preventDefault();
          setConsentDismissed(true);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    inputRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, consentDismissed]);

  // La preparación de IA local es automática: se refleja en la UI sin que el
  // usuario gestione modelos, WebGPU ni índices.
  useEffect(() => localAiRuntime.subscribe(setRuntimeStatus), []);

  useEffect(() => {
    if (!isOpen) return;
    if (currentSettings.provider !== 'local') return;
    void localAiRuntime.prepareForTutor('local');
    // Solo al abrir el cajón / cambiar de proveedor: nunca descarga por arrancar la app.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, currentSettings.provider]);

  if (!isOpen) return null;

  const isOnDevice = currentSettings.provider === 'local' || currentSettings.provider === 'demo';
  const isRemote = currentSettings.provider === 'openai';
  const isLocalServer = currentSettings.provider === 'ollama';

  const isLocalProvider = currentSettings.provider === 'local';
  const preparingLocal =
    isLocalProvider && ['preparing', 'downloading', 'compiling'].includes(runtimeStatus.stage);
  const needsConsent = isLocalProvider && runtimeStatus.stage === 'consent-required';
  const localUnavailable = isLocalProvider && runtimeStatus.stage === 'unsupported';
  // La acción del usuario comparte la preparación en vuelo y continúa al terminar.
  // Solo la decisión de primera descarga bloquea el envío.
  const sendBlocked = needsConsent;


  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: MessageItem = { role: 'user', content: input };
    const newHistory = [...messages, userMsg];
    setMessages(newHistory);
    setInput('');
    setLoading(true);

    try {
      let streamingText = '';
      const response: AssistantResponse = await aiService.askTutor(
        newHistory.map(m => ({ role: m.role, content: m.content })),
        activeContext,
        (tokenChunk) => {
          streamingText = tokenChunk;
          setMessages([
            ...newHistory,
            {
              role: 'assistant',
              content: streamingText,
              isLocalOnDevice: true
            }
          ]);
        },
        retrievalScope
      );
      setMessages([
        ...newHistory,
        {
          role: 'assistant',
          content: response.answer || streamingText,
          sources: response.sources,
          isLocalOnDevice: response.isLocalOnDevice,
          retrievalMode: response.retrievalMode,
          citations: response.citations,
          modelUsed: response.modelUsed,
          provider: response.providerUsed
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
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Tutor pedagógico"
      className="fixed inset-y-0 right-0 z-50 flex w-full animate-slide-left flex-col border-l border-line bg-surface shadow-pop sm:w-[440px]"
    >
      {/* Cabecera */}
      <div className="flex items-center justify-between border-b border-line bg-raised p-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="rounded-lg border border-accent/25 bg-accent-soft p-2 text-accent">
            <Bot size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="type-section text-ink">Tutor pedagógico</h3>
              {currentSettings.provider === 'local' ? (
                <span className="flex items-center gap-1 rounded-full border border-success/30 bg-success-soft px-1.5 py-0.5 text-micro font-semibold text-success">
                  <Cpu size={10} aria-hidden="true" /> {
                    localLlmEngine.getLoadedModelId()?.includes('onnx') ||
                    localLlmEngine.getLoadedModelId()?.includes('SmolLM2-360M') ||
                    currentSettings.localModelId?.includes('onnx') ||
                    currentSettings.localModelId?.includes('SmolLM2-360M')
                      ? 'On-Device CPU (WASM)'
                      : 'On-Device WebLLM'
                  }
                </span>
              ) : currentSettings.provider === 'demo' ? (
                <span className="rounded-full border border-line bg-canvas px-1.5 py-0.5 text-micro font-semibold text-muted">
                  Demo local
                </span>
              ) : (
                <span className="rounded-full border border-warning/30 bg-warning-soft px-1.5 py-0.5 text-micro font-semibold text-warning">
                  {isRemote ? 'Proveedor remoto' : 'Ollama local'}
                </span>
              )}
            </div>
            <p className="truncate text-meta">Contexto: {activeContext || 'General'}</p>
            {/* Límite honesto de privacidad del proveedor activo */}
            <p className="mt-0.5 flex items-center gap-1 text-micro">
              <AlertCircle size={10} aria-hidden="true" />
              {isOnDevice
                ? 'Las respuestas se generan en tu dispositivo.'
                : isLocalServer
                  ? 'Se envía a tu servidor local de Ollama.'
                  : 'Las consultas salen hacia la API de OpenAI.'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Cerrar panel del tutor"
          className="rounded-lg p-1.5 text-faint transition hover:bg-canvas hover:text-ink"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {/* Hilos de mensajes */}
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m, idx) => (
          <div
            key={idx}
            className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}
          >
            <div className={cn('flex max-w-[90%] gap-2.5', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              {m.role === 'assistant' && (
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                  <Bot size={12} aria-hidden="true" />
                </div>
              )}
              <div
                className={cn(
                  'rounded-2xl p-3 text-body leading-relaxed',
                  m.role === 'user'
                    ? 'rounded-tr-none bg-accent text-on-accent'
                    : 'rounded-tl-none border border-line bg-canvas text-ink'
                )}
              >
                {/* El asistente renderiza Markdown seguro; el usuario conserva texto plano. */}
                <MessageBody role={m.role} content={m.content} />

                {/* Fuentes RAG recuperadas de SQLite, con procedencia navegable */}
                {m.citations !== undefined && (
                  <div className="mt-2.5 border-t border-line pt-2 text-micro">
                    <span className="mb-1 flex items-center justify-between gap-1 font-semibold">
                      <span className="flex items-center gap-1 text-muted">
                        <Database size={11} className="text-accent" aria-hidden="true" />
                        {m.citations.length > 0 ? 'Fuentes recuperadas:' : 'Sin fuentes recuperadas'}
                      </span>
                      {m.retrievalMode && (
                        <span
                          className={cn(
                            'rounded px-1.5 py-0.5 font-medium',
                            m.retrievalMode === 'hybrid'
                              ? 'border border-accent/30 bg-accent-soft text-accent'
                              : m.retrievalMode === 'semantic'
                                ? 'border border-success/30 bg-success-soft text-success'
                                : 'border border-line bg-canvas text-muted'
                          )}
                        >
                          {m.retrievalMode === 'hybrid' ? '⚡ Híbrido' : m.retrievalMode === 'semantic' ? 'Semántico' : 'Léxico'}
                        </span>
                      )}
                    </span>
                    {m.citations.length === 0 ? (
                      <p className="text-muted">
                        Esta respuesta no se apoyó en material recuperado de tu biblioteca: no hay
                        fuentes que citar.
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {m.citations.map(citation => {
                          const breadcrumb = citation.path && citation.path.length > 0
                            ? citation.path.join(' › ')
                            : CITATION_TYPE_LABELS[citation.sourceType];
                          const canNavigate = Boolean(citation.navigate) && Boolean(onOpenCitation);
                          return (
                            <li key={citation.key} className="flex flex-col gap-0.5">
                              {canNavigate ? (
                                <button
                                  type="button"
                                  onClick={() => onOpenCitation?.(citation)}
                                  className="text-left font-semibold text-accent hover:underline focus-visible:underline"
                                  title={`Abrir ${CITATION_TYPE_LABELS[citation.sourceType].toLowerCase()} de origen`}
                                >
                                  <SourceTitle title={citation.title} />
                                  <ArrowUpRight size={10} className="ml-0.5 inline align-baseline" aria-hidden="true" />
                                </button>
                              ) : (
                                <span className="font-semibold text-ink">
                                  <SourceTitle title={citation.title} />
                                </span>
                              )}
                              <span className="text-faint">
                                Fuente: {breadcrumb}
                                {citation.chapter ? ` › ${citation.chapter}` : ''}
                                {citation.page ? ` · pág. ${citation.page}` : ''}
                              </span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {/* Proveniencia explícita: qué modelo generó la respuesta. */}
                    {m.modelUsed && m.provider && (
                      <p className="mt-1.5 border-t border-line pt-1.5 text-faint">
                        Respuesta generada por {PROVIDER_LABELS[m.provider]} · {m.modelUsed}
                      </p>
                    )}
                  </div>
                )}
                {/* Compatibilidad: respuestas antiguas solo con títulos. */}
                {m.citations === undefined && m.sources && m.sources.length > 0 && (
                  <div className="mt-2.5 border-t border-line pt-2 text-micro">
                    <span className="mb-1 flex items-center justify-between gap-1 font-semibold">
                      <span className="flex items-center gap-1 text-muted">
                        <Database size={11} className="text-accent" aria-hidden="true" /> Fuentes locales consultadas:
                      </span>
                    </span>
                    <ul className="list-inside list-disc space-y-0.5 text-muted">
                      {m.sources.map((s, sIdx) => (
                        <li key={sIdx}>
                          <SourceTitle title={s} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {m.role === 'user' && (
                <div className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-canvas text-muted">
                  <User size={12} aria-hidden="true" />
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 p-2 text-meta text-accent">
            <RefreshCw size={14} className="animate-spin" aria-hidden="true" />
            <span>Consultando y recuperando contexto local…</span>
          </div>
        )}
      </div>

      {/* Estado de preparación automática de IA local: estados de producto, sin jerga */}
      {isLocalProvider && (preparingLocal || localUnavailable) && (
        <div className="border-t border-line bg-canvas px-4 py-2" role="status" aria-live="polite">
          <div className="flex items-center gap-2 text-meta text-accent">
            {preparingLocal && <RefreshCw size={13} className="animate-spin" aria-hidden="true" />}
            <span className="min-w-0 flex-1 truncate">{runtimeStatus.message}</span>
            {runtimeStatus.stage === 'downloading' && (
              <span className="shrink-0 font-semibold">{runtimeStatus.progress}%</span>
            )}
          </div>
          {runtimeStatus.stage === 'downloading' && (
            <ProgressBar
              className="mt-1.5"
              value={runtimeStatus.progress}
              label="Progreso de preparación de IA local"
            />
          )}
          {localUnavailable && runtimeStatus.errorAction && (
            <p className="mt-0.5 text-micro text-muted">{runtimeStatus.errorAction}</p>
          )}
        </div>
      )}

      {/* Consentimiento único de primera descarga: diálogo directo y accionable. */}
      {needsConsent && !consentDismissed && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/20 px-4 backdrop-blur-[2px]"
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="local-ai-consent-title"
            aria-describedby="local-ai-consent-description"
            className="w-full max-w-md rounded-2xl border border-line bg-surface p-5 shadow-pop"
          >
            <div className="flex items-start gap-3">
              <div className="shrink-0 rounded-xl border border-accent/25 bg-accent-soft p-2.5 text-accent">
                <Cpu size={19} aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h4 id="local-ai-consent-title" className="type-section text-ink">
                  Activar IA local
                </h4>
                <p id="local-ai-consent-description" className="mt-1.5 text-secondary leading-relaxed text-muted">
                  {runtimeStatus.downloadSize
                    ? 'La primera vez necesitamos descargar aproximadamente ' + runtimeStatus.downloadSize + '.'
                    : 'La primera vez necesitamos descargar los recursos de la IA.'}
                  {' '}Después podrás usarla sin conexión.
                </p>
                <p className="mt-2 text-micro leading-relaxed text-muted">
                  Las respuestas se generan en tu dispositivo. No se envían tus preguntas a servidores externos mediante este modo.
                </p>
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                size="sm"
                variant="quiet"
                onClick={() => setConsentDismissed(true)}
              >
                Ahora no
              </Button>
              <Button
                size="sm"
                variant="solid"
                autoFocus
                onClick={() => {
                  localAiRuntime.grantConsent();
                  void localAiRuntime.prepareForTutor('local');
                }}
              >
                Activar IA local
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tras posponer, queda una vía compacta para activar la IA sin repetir el modal. */}
      {needsConsent && consentDismissed && (
        <div className="border-t border-line bg-accent-soft/40 px-4 py-2.5" role="status" aria-live="polite">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-meta text-muted">
              La IA local necesita permiso para descargar sus recursos.
            </span>
            <Button
              size="sm"
              variant="solid"
              onClick={() => {
                localAiRuntime.grantConsent();
                void localAiRuntime.prepareForTutor('local');
              }}
            >
              Activar
            </Button>
          </div>
        </div>
      )}

      {/* Acción rápida: Explicar este recurso */}
      {activeContext && activeContext !== 'General' && activeContext !== 'dashboard' && activeContext !== 'settings' && (
        <div className="flex items-center justify-between border-t border-line bg-canvas px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={async () => {
              if (loading) return;
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
                    retrievalMode: response.retrievalMode,
                    citations: response.citations,
                    modelUsed: response.modelUsed,
                    provider: response.providerUsed
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
            className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-meta font-medium text-muted transition hover:bg-accent-soft/60 hover:text-ink disabled:pointer-events-none disabled:bg-surface disabled:border-line disabled:text-faint"
          >
            <Sparkles size={12} className="text-accent" aria-hidden="true" />
            <span>Explicar este recurso</span>
          </button>
          <span className="max-w-[160px] truncate text-micro">{activeContext}</span>
        </div>
      )}

      {/* Entrada de chat */}
      <form onSubmit={handleSend} className="flex gap-2 border-t border-line bg-raised p-3">
        <label htmlFor="ai-chat-input" className="sr-only">
          Pregunta sobre tus cursos, libros o notas
        </label>
        <input
          id="ai-chat-input"
          ref={inputRef}
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Pregunta sobre tus cursos, libros o notas…"
          className="flex-1 rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none"
        />
        <button
          type="submit"
          disabled={loading || !input.trim() || sendBlocked}
          aria-label="Enviar mensaje"
          className="rounded-lg bg-accent p-2.5 text-on-accent transition hover:opacity-90 disabled:pointer-events-none disabled:bg-line disabled:text-muted"
        >
          <Send size={15} aria-hidden="true" />
        </button>
      </form>
    </div>
  );
};
