import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ConceptNode, ConceptEdge, GraphNodeType } from '../types/models.ts';
import { Network, type Node, type Edge, type Options } from 'vis-network';
import { DataSet } from 'vis-data';
import {
  Share2,
  Info,
  Loader2,
  X,
  Plus,
  Trash2,
  ArrowUpRight,
  BookOpen,
  GraduationCap,
  FileText,
  Layers,
  Lightbulb,
  Link2,
  AlertCircle
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { GRAPH_NODE_LABELS, GRAPH_RELATION_LABELS, GRAPH_RELATION_TYPES, resolveGraphNodeDestination, describeDestructiveAction } from '../services/domainLogic.ts';
import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';

interface KnowledgeGraphProps {
  version?: number;
  onOpenResource: (resourceId: string) => void;
  onOpenLesson: (lessonId: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenConcept: (conceptId: string) => void;
  onStudyResource: (resourceId: string) => void;
  onNavigate: (tab: string) => void;
  onGraphMutated?: () => void;
}

const NODE_COLORS: Record<GraphNodeType, { background: string; border: string }> = {
  course: { background: '#312e81', border: '#818cf8' },
  book: { background: '#1e3a8a', border: '#60a5fa' },
  module: { background: '#4c1d95', border: '#a78bfa' },
  lesson: { background: '#164e63', border: '#22d3ee' },
  note: { background: '#134e4a', border: '#2dd4bf' },
  concept: { background: '#2e1065', border: '#c084fc' },
  resource: { background: '#3f2d16', border: '#fbbf24' }
};

const NODE_ICONS: Record<GraphNodeType, React.ComponentType<{ size?: number; className?: string }>> = {
  course: GraduationCap,
  book: BookOpen,
  module: Layers,
  lesson: FileText,
  note: FileText,
  concept: Lightbulb,
  resource: BookOpen
};

const FILTER_ORDER: GraphNodeType[] = ['course', 'book', 'module', 'lesson', 'note', 'concept', 'resource'];

const NETWORK_OPTIONS: Options = {
  nodes: {
    shape: 'box',
    margin: { top: 10, right: 12, bottom: 10, left: 12 },
    font: { color: '#f8fafc', face: 'Plus Jakarta Sans', size: 12 }
  },
  edges: {
    arrows: 'to',
    font: { color: '#94a3b8', size: 9, align: 'middle' },
    smooth: { enabled: true, type: 'dynamic', roundness: 0.4 }
  },
  physics: {
    barnesHut: { gravitationalConstant: -3000, springLength: 130, springConstant: 0.04 },
    stabilization: { enabled: true, iterations: 150, updateInterval: 25 }
  },
  interaction: { hover: true, zoomView: true, dragView: true, tooltipDelay: 200 }
};

export const KnowledgeGraph: React.FC<KnowledgeGraphProps> = ({
  version = 0,
  onOpenResource,
  onOpenLesson,
  onOpenNote,
  onOpenConcept,
  onStudyResource,
  onNavigate,
  onGraphMutated
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<Network | null>(null);
  const nodesDsRef = useRef<DataSet<Node> | null>(null);
  const edgesDsRef = useRef<DataSet<Edge> | null>(null);

  const [graphData, setGraphData] = useState<{ nodes: ConceptNode[]; edges: ConceptEdge[] }>({ nodes: [], edges: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<GraphNodeType>>(new Set(FILTER_ORDER));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [connectionForm, setConnectionForm] = useState({ sourceId: '', relationType: 'related_to', targetId: '' });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [pendingDeleteEdge, setPendingDeleteEdge] = useState<{ id: string; label: string } | null>(null);

  const loadGraph = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const data = await dao.getKnowledgeGraph();
      // Sanea conexiones huérfanas de forma tolerante (no bloquea la vista).
      await dao.pruneDanglingConnections();
      setGraphData(data);
    } catch (err: any) {
      setLoadError(err?.message || 'No se pudo cargar el grafo de conocimiento local.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph();
  }, [loadGraph, version]);

  const nodesById = useMemo(() => {
    const map = new Map<string, ConceptNode>();
    for (const n of graphData.nodes) map.set(n.id, n);
    return map;
  }, [graphData.nodes]);

  const visibleGraph = useMemo(() => {
    const nodes = graphData.nodes.filter(n => activeTypes.has(n.node_type || 'resource'));
    const visibleIds = new Set(nodes.map(n => n.id));
    const edges = graphData.edges.filter(e => visibleIds.has(e.source_id) && visibleIds.has(e.target_id));
    return { nodes, edges };
  }, [graphData, activeTypes]);

  // Construye/actualiza la red vis-network sin re-inicializarla al filtrar.
  useEffect(() => {
    if (!containerRef.current) return;
    if (visibleGraph.nodes.length === 0) {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
        nodesDsRef.current = null;
        edgesDsRef.current = null;
      }
      return;
    }

    const visNodes: Node[] = visibleGraph.nodes.map(n => {
      const type = n.node_type || 'resource';
      const colors = NODE_COLORS[type];
      return {
        id: n.id,
        label: n.name,
        title: n.description || GRAPH_NODE_LABELS[type],
        color: { background: colors.background, border: colors.border, highlight: { background: '#4338ca', border: '#e9d5ff' } }
      };
    });
    const visEdges: Edge[] = visibleGraph.edges.map(e => ({
      id: e.id,
      from: e.source_id,
      to: e.target_id,
      label: (GRAPH_RELATION_LABELS as Record<string, string>)[e.connection_type] || e.connection_type,
      dashes: !!e.derived,
      arrows: 'to',
      color: { color: e.derived ? '#475569' : '#6366f1' }
    }));

    if (!networkRef.current) {
      const nodesDs = new DataSet<Node>(visNodes);
      const edgesDs = new DataSet<Edge>(visEdges);
      nodesDsRef.current = nodesDs;
      edgesDsRef.current = edgesDs;
      const network = new Network(containerRef.current, { nodes: nodesDs, edges: edgesDs }, NETWORK_OPTIONS);
      networkRef.current = network;
      network.on('selectNode', params => setSelectedNodeId(params.nodes[0] ? String(params.nodes[0]) : null));
      network.on('deselectNode', () => setSelectedNodeId(null));
      network.once('stabilized', () => {
        try { network.setOptions({ physics: { enabled: false } }); } catch { /* noop */ }
      });
    } else {
      nodesDsRef.current!.clear();
      edgesDsRef.current!.clear();
      nodesDsRef.current!.add(visNodes);
      edgesDsRef.current!.add(visEdges);
    }
  }, [visibleGraph]);

  useEffect(() => {
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, []);

  // Escape cierra el diálogo de conexión
  useEffect(() => {
    if (!isConnectionDialogOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsConnectionDialogOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isConnectionDialogOpen]);

  const toggleType = (type: GraphNodeType) => {
    setActiveTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const selectedNode = selectedNodeId ? nodesById.get(selectedNodeId) || null : null;

  const relatedEdges = useMemo(() => {
    if (!selectedNodeId) return [];
    return graphData.edges.filter(e => e.source_id === selectedNodeId || e.target_id === selectedNodeId);
  }, [graphData.edges, selectedNodeId]);

  const handleSelectNodeClick = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    if (networkRef.current) {
      networkRef.current.selectNodes([nodeId]);
      networkRef.current.focus(nodeId, { scale: 1.1, animation: true });
    }
  };

  const handleSelectedNodeNavigation = () => {
    if (!selectedNode) return;
    const dest = resolveGraphNodeDestination(selectedNode);
    switch (dest.tab) {
      case 'course':
        onOpenResource(dest.resourceId);
        break;
      case 'note':
        onOpenNote(dest.noteId);
        break;
      case 'concept':
        onOpenConcept(dest.conceptId);
        break;
      case 'resource':
        onOpenResource(dest.resourceId);
        break;
      default:
        onNavigate('library');
    }
  };

  const navigationLabel = selectedNode
    ? GRAPH_NODE_LABELS[(selectedNode.node_type || 'resource')]
    : 'nodo';

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectionError(null);
    setIsSavingConnection(true);
    try {
      const res = await dao.createKnowledgeConnection(connectionForm);
      if (!res.success) {
        setConnectionError(res.error || 'No se pudo crear la conexión.');
        return;
      }
      setIsConnectionDialogOpen(false);
      setConnectionForm({ sourceId: '', relationType: 'related_to', targetId: '' });
      onGraphMutated?.();
    } catch (err: any) {
      setConnectionError(err?.message || 'Error al guardar la conexión.');
    } finally {
      setIsSavingConnection(false);
    }
  };

  const handleDeleteConnection = async (edgeId: string) => {
    await dao.deleteKnowledgeConnection(edgeId);
    onGraphMutated?.();
  };

  const sortedNodes = useMemo(
    () => [...graphData.nodes].sort((a, b) => (a.node_type || '').localeCompare(b.node_type || '') || a.name.localeCompare(b.name)),
    [graphData.nodes]
  );

  const relatedList = relatedEdges.map(edge => {
    const isOutgoing = edge.source_id === selectedNodeId;
    const counterpartId = isOutgoing ? edge.target_id : edge.source_id;
    const counterpart = nodesById.get(counterpartId);
    return {
      edge,
      isOutgoing,
      counterpartId,
      counterpartName: counterpart?.name || counterpartId,
      counterpartType: (counterpart?.node_type || 'resource') as GraphNodeType,
      relationLabel: (GRAPH_RELATION_LABELS as Record<string, string>)[edge.connection_type] || edge.connection_type
    };
  });

  const SelectedIcon = selectedNode ? NODE_ICONS[(selectedNode.node_type || 'resource')] : Share2;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <Share2 size={24} className="text-purple-400" /> Grafo de Conocimiento
          </h1>
          <p className="text-xs text-slate-400">
            Estructura local de cursos, libros, módulos, lecciones, notas, conceptos y recursos. Relaciones explícitas guardadas en SQLite.
          </p>
        </div>
        <button
          onClick={() => { setConnectionError(null); setIsConnectionDialogOpen(true); }}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white shadow-md shadow-purple-600/25 transition self-start"
        >
          <Plus size={15} /> Añadir conexión
        </button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros de nodos del grafo">
        <button
          onClick={() => setActiveTypes(new Set(FILTER_ORDER))}
          aria-pressed={activeTypes.size === FILTER_ORDER.length}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
            activeTypes.size === FILTER_ORDER.length ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
          }`}
        >
          Todos
        </button>
        {FILTER_ORDER.map(type => {
          const Icon = NODE_ICONS[type];
          const active = activeTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                active ? 'bg-slate-800 text-slate-100 border border-slate-600' : 'text-slate-500 hover:text-slate-300 hover:bg-slate-900 border border-transparent'
              }`}
            >
              <Icon size={13} /> {GRAPH_NODE_LABELS[type]}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Lienzo del grafo */}
        <div className="lg:col-span-2 relative w-full h-[560px] rounded-2xl bg-slate-950 border border-slate-800 overflow-hidden shadow-2xl">
          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 gap-2">
              <Loader2 className="animate-spin text-purple-500" size={28} />
              <p className="text-xs">Construyendo el grafo local desde SQLite...</p>
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-rose-300 gap-2 p-6 text-center">
              <AlertCircle size={28} />
              <p className="text-xs">{loadError}</p>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2 p-6 text-center">
              <Share2 size={32} className="opacity-60" />
              <p className="text-sm font-semibold text-slate-300">Aún no hay nodos en el grafo</p>
              <p className="text-xs">Crea cursos, libros, notas o conceptos para empezar a organizar tu conocimiento.</p>
            </div>
          ) : visibleGraph.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-500 gap-2 p-6 text-center">
              <Info size={26} className="opacity-70" />
              <p className="text-xs">Los filtros actuales ocultan todos los nodos.</p>
            </div>
          ) : (
            <div ref={containerRef} className="w-full h-full" />
          )}
          <div className="absolute bottom-4 left-4 p-3 rounded-xl bg-slate-900/80 backdrop-blur-md border border-slate-800 text-[11px] text-slate-300 flex items-center gap-2 pointer-events-none">
            <Info size={14} className="text-purple-400" />
            <span>Arrastra y haz zoom. Las aristas discontinuas son estructurales; las sólidas son conexiones tuyas.</span>
          </div>
        </div>

        {/* Panel de detalle accesible */}
        <div className="rounded-2xl bg-slate-900/60 border border-slate-800 p-4 space-y-3 max-h-[560px] overflow-y-auto" aria-live="polite">
          {selectedNode ? (
            <>
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-300 border border-purple-500/20">
                  <SelectedIcon size={16} />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-bold text-white break-words">{selectedNode.name}</h2>
                  <p className="text-[11px] text-slate-400">{GRAPH_NODE_LABELS[(selectedNode.node_type || 'resource')]}</p>
                </div>
              </div>

              {selectedNode.description && (
                <p className="text-xs text-slate-300 leading-relaxed">{selectedNode.description}</p>
              )}

              {/* Metadatos legibles (sin internals crudos) */}
              <dl className="grid grid-cols-2 gap-2 text-[11px]">
                {selectedNode.meta?.category && (<><dt className="text-slate-500">Categoría</dt><dd className="text-slate-300">{selectedNode.meta.category}</dd></>)}
                {selectedNode.meta?.status && (<><dt className="text-slate-500">Estado</dt><dd className="text-slate-300">{selectedNode.meta.status}</dd></>)}
                {selectedNode.meta?.author && (<><dt className="text-slate-500">Autor</dt><dd className="text-slate-300">{selectedNode.meta.author}</dd></>)}
                {selectedNode.meta?.instructor && (<><dt className="text-slate-500">Instructor</dt><dd className="text-slate-300">{selectedNode.meta.instructor}</dd></>)}
                {typeof selectedNode.meta?.page_count === 'number' && (
                  <><dt className="text-slate-500">Páginas</dt><dd className="text-slate-300">{selectedNode.meta.current_page ?? 0} / {selectedNode.meta.page_count}</dd></>
                )}
                {typeof selectedNode.meta?.duration_minutes === 'number' && !selectedNode.meta?.page_count && (
                  <><dt className="text-slate-500">Duración</dt><dd className="text-slate-300">{selectedNode.meta.duration_minutes} min</dd></>
                )}
                {selectedNode.meta?.tags && (<><dt className="text-slate-500">Etiquetas</dt><dd className="text-slate-300 col-span-1">{selectedNode.meta.tags}</dd></>)}
              </dl>

              <div>
                <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Relaciones ({relatedList.length})
                </h3>
                {relatedList.length === 0 ? (
                  <p className="text-[11px] text-slate-500">Sin relaciones registradas.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedList.map(({ edge, isOutgoing, counterpartId, counterpartName, counterpartType, relationLabel }) => (
                      <li key={edge.id} className="flex items-start justify-between gap-2 p-2 rounded-lg bg-slate-950/60 border border-slate-800">
                        <div className="min-w-0">
                          <span className="text-[10px] text-slate-500">
                            {isOutgoing ? '→' : '←'} {relationLabel} · {GRAPH_NODE_LABELS[counterpartType]}
                          </span>
                          <button
                            onClick={() => handleSelectNodeClick(counterpartId)}
                            className="block text-left text-[11px] text-indigo-300 hover:text-indigo-200 truncate w-full"
                          >
                            {counterpartName}
                          </button>
                        </div>
                        {!edge.derived && (
                          <button
                            onClick={() => setPendingDeleteEdge({ id: edge.id, label: `${relationLabel} con ${counterpartName}` })}
                            title="Eliminar conexión"
                            aria-label={`Eliminar conexión ${relationLabel} con ${counterpartName}`}
                            className="p-1 text-slate-500 hover:text-rose-400 rounded transition shrink-0"
                          >
                            <Trash2 size={12} />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={handleSelectedNodeNavigation}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-800 hover:bg-slate-700 text-white transition"
                >
                  <ArrowUpRight size={13} /> Abrir {navigationLabel}
                </button>
                {(selectedNode.node_type === 'course' || selectedNode.node_type === 'book' || selectedNode.node_type === 'resource') && (
                  <button
                    onClick={() => onStudyResource(selectedNode.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-purple-600 hover:bg-purple-500 text-white transition"
                  >
                    <Lightbulb size={13} /> Estudiar
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-slate-500 gap-2 py-16">
              <Link2 size={26} className="opacity-60" />
              <p className="text-xs">Selecciona un nodo para ver su tipo, metadatos y relaciones.</p>
              <p className="text-[10px] text-slate-600">La lista textual de relaciones está disponible aquí para lectores de pantalla.</p>
            </div>
          )}
        </div>
      </div>

      {/* Confirmación accesible para eliminar relaciones (acción destructiva) */}
      <ConfirmDialog
        isOpen={!!pendingDeleteEdge}
        title={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '').title}
        consequence={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '').consequence}
        confirmLabel={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '').confirmLabel}
        onCancel={() => setPendingDeleteEdge(null)}
        onConfirm={async () => {
          const target = pendingDeleteEdge;
          setPendingDeleteEdge(null);
          if (target) await handleDeleteConnection(target.id);
        }}
      />

      {/* Diálogo de conexión manual */}
      {isConnectionDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <form onSubmit={handleSaveConnection} className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Link2 size={16} className="text-purple-400" /> Añadir conexión
              </h3>
              <button type="button" onClick={() => setIsConnectionDialogOpen(false)} className="p-1 text-slate-400 hover:text-white rounded">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300" htmlFor="conn-source">Desde</label>
              <select
                id="conn-source"
                value={connectionForm.sourceId}
                onChange={e => setConnectionForm(f => ({ ...f, sourceId: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500"
                required
              >
                <option value="">-- Elige un nodo --</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{GRAPH_NODE_LABELS[(n.node_type || 'resource')]} · {n.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300" htmlFor="conn-relation">Relación</label>
              <select
                id="conn-relation"
                value={connectionForm.relationType}
                onChange={e => setConnectionForm(f => ({ ...f, relationType: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500"
              >
                {GRAPH_RELATION_TYPES.map(r => (
                  <option key={r} value={r}>{GRAPH_RELATION_LABELS[r]}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300" htmlFor="conn-target">Hacia</label>
              <select
                id="conn-target"
                value={connectionForm.targetId}
                onChange={e => setConnectionForm(f => ({ ...f, targetId: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-purple-500"
                required
              >
                <option value="">-- Elige un nodo --</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{GRAPH_NODE_LABELS[(n.node_type || 'resource')]} · {n.name}</option>
                ))}
              </select>
            </div>

            {connectionError && (
              <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2" role="alert">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{connectionError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setIsConnectionDialogOpen(false)} className="px-3 py-1.5 rounded-lg text-xs text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSavingConnection || !connectionForm.sourceId || !connectionForm.targetId || connectionForm.sourceId === connectionForm.targetId}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white transition"
              >
                {isSavingConnection ? 'Guardando...' : 'Guardar conexión'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
