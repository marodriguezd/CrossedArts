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
import { Button, Chip, cn } from '../components/ui/index.tsx';

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

type ThemeMode = 'light' | 'dark';

/**
 * Paletas suaves por tema: los nodos usan tonos desaturados y las aristas se
 * mantienen discretas. El mapa nunca es más ruido que la información que porta.
 */
const NODE_PALETTES: Record<ThemeMode, Record<GraphNodeType, { background: string; border: string }>> = {
  light: {
    course: { background: '#E8E4F1', border: '#8B7FB5' },
    book: { background: '#E3EAF1', border: '#7B93AD' },
    module: { background: '#EDE7F3', border: '#9B87BE' },
    lesson: { background: '#E0EEF0', border: '#6FA3A8' },
    note: { background: '#E6EFE8', border: '#7BA085' },
    concept: { background: '#F1E9F2', border: '#A98BB0' },
    resource: { background: '#F2EADA', border: '#B49A66' }
  },
  dark: {
    course: { background: '#34304A', border: '#7D74A8' },
    book: { background: '#2C3644', border: '#6E8CAD' },
    module: { background: '#3A3350', border: '#8E7FB8' },
    lesson: { background: '#26383C', border: '#5E9298' },
    note: { background: '#2A3A31', border: '#6F9B7E' },
    concept: { background: '#3E3145', border: '#9C7FA6' },
    resource: { background: '#3E3626', border: '#A8905C' }
  }
};

const THEME_TOKENS: Record<ThemeMode, { ink: string; faint: string; surface: string; accent: string; accentSoft: string; line: string }> = {
  light: { ink: '#252220', faint: '#6C6559', surface: '#FAF7EF', accent: '#5E4B8B', accentSoft: '#ECE6F4', line: '#E3DCCC' },
  dark: { ink: '#E7E2D9', faint: '#A29B91', surface: '#22211F', accent: '#A794CE', accentSoft: '#322C42', line: '#393735' }
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

function buildNetworkOptions(theme: ThemeMode): Options {
  const t = THEME_TOKENS[theme];
  return {
    nodes: {
      shape: 'box',
      margin: { top: 10, right: 12, bottom: 10, left: 12 },
      font: { color: t.ink, face: 'system-ui, sans-serif', size: 12 },
      borderWidth: 1.5,
      shapeProperties: { borderRadius: 8 }
    },
    edges: {
      arrows: 'to',
      font: { color: t.faint, size: 9, align: 'middle' },
      smooth: { enabled: true, type: 'dynamic', roundness: 0.4 }
    },
    physics: {
      barnesHut: { gravitationalConstant: -3000, springLength: 130, springConstant: 0.04 },
      stabilization: { enabled: true, iterations: 150, updateInterval: 25 }
    },
    interaction: { hover: true, zoomView: true, dragView: true, tooltipDelay: 200 }
  };
}

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
  const themeRef = useRef<ThemeMode>('light');

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
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  );

  // El lienzo vis-network no lee variables CSS: se reconstruye al cambiar el tema.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

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

    // Cambio de tema: la red anterior usa colores del tema previo.
    if (networkRef.current && themeRef.current !== theme) {
      networkRef.current.destroy();
      networkRef.current = null;
      nodesDsRef.current = null;
      edgesDsRef.current = null;
    }
    themeRef.current = theme;

    if (visibleGraph.nodes.length === 0) {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
        nodesDsRef.current = null;
        edgesDsRef.current = null;
      }
      return;
    }

    const palette = NODE_PALETTES[theme];
    const t = THEME_TOKENS[theme];

    const visNodes: Node[] = visibleGraph.nodes.map(n => {
      const type = n.node_type || 'resource';
      const colors = palette[type];
      return {
        id: n.id,
        label: n.name,
        title: n.description || GRAPH_NODE_LABELS[type],
        color: {
          background: colors.background,
          border: colors.border,
          highlight: { background: t.accent, border: t.accentSoft }
        },
        font: { color: t.ink }
      };
    });
    const visEdges: Edge[] = visibleGraph.edges.map(e => ({
      id: e.id,
      from: e.source_id,
      to: e.target_id,
      label: (GRAPH_RELATION_LABELS as Record<string, string>)[e.connection_type] || e.connection_type,
      dashes: !!e.derived,
      arrows: 'to',
      color: { color: e.derived ? (theme === 'dark' ? '#57544E' : '#9C968A') : t.accent },
      font: { color: t.faint }
    }));

    if (!networkRef.current) {
      const nodesDs = new DataSet<Node>(visNodes);
      const edgesDs = new DataSet<Edge>(visEdges);
      nodesDsRef.current = nodesDs;
      edgesDsRef.current = edgesDs;
      const network = new Network(containerRef.current, { nodes: nodesDs, edges: edgesDs }, buildNetworkOptions(theme));
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
      try { networkRef.current.setOptions(buildNetworkOptions(theme)); } catch { /* noop */ }
    }
  }, [visibleGraph, theme]);

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
  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink focus:border-accent/50 focus:outline-none';

  return (
    <div className="animate-fade-in space-y-5">
      {/* Cabecera */}
      <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">Grafo de conocimiento</h1>
          <p className="type-secondary mt-1 max-w-2xl">
            Explora y organiza tus conocimientos y conexiones. Cursos, libros, módulos, lecciones,
            notas, conceptos y recursos con relaciones explícitas guardadas en SQLite.
          </p>
        </div>
        <Button
          variant="outline"
          className="self-start"
          onClick={() => { setConnectionError(null); setIsConnectionDialogOpen(true); }}
        >
          <Plus size={15} aria-hidden="true" /> Añadir conexión
        </Button>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtros de nodos del grafo">
        <Chip
          active={activeTypes.size === FILTER_ORDER.length}
          onClick={() => setActiveTypes(new Set(FILTER_ORDER))}
        >
          Todos
        </Chip>
        {FILTER_ORDER.map(type => {
          const Icon = NODE_ICONS[type];
          const active = activeTypes.has(type);
          return (
            <Chip key={type} active={active} onClick={() => toggleType(type)}>
              <Icon size={13} aria-hidden="true" /> {GRAPH_NODE_LABELS[type]}
            </Chip>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Lienzo del grafo */}
        <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:col-span-2">
          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
              <Loader2 className="animate-spin text-accent" size={28} aria-hidden="true" />
              <p className="text-meta">Construyendo el grafo local desde SQLite…</p>
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-error">
              <AlertCircle size={28} aria-hidden="true" />
              <p className="text-meta">{loadError}</p>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <Share2 size={32} className="text-faint" aria-hidden="true" />
              <p className="type-section text-ink">Aún no hay nodos en el grafo</p>
              <p className="type-meta max-w-xs">
                Crea cursos, libros, notas o conceptos para empezar a organizar tu conocimiento.
              </p>
            </div>
          ) : visibleGraph.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <Info size={26} className="text-faint" aria-hidden="true" />
              <p className="text-meta">Los filtros actuales ocultan todos los nodos.</p>
            </div>
          ) : (
            <div ref={containerRef} className="h-full w-full" />
          )}
          {/* Leyenda de relaciones (accesible y discreta) */}
          <div className="pointer-events-none absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-line bg-raised/90 px-3 py-2 text-meta text-muted backdrop-blur-sm">
            <Info size={14} className="text-accent" aria-hidden="true" />
            <span>
              Arrastra y haz zoom. Las aristas discontinuas son estructurales; las sólidas son
              conexiones tuyas.
            </span>
          </div>
        </div>

        {/* Panel de detalle accesible */}
        <div className="max-h-[560px] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-card" aria-live="polite">
          {selectedNode ? (
            <>
              <div className="flex items-start gap-2.5">
                <div className="rounded-lg border border-accent/25 bg-accent-soft p-2 text-accent">
                  <SelectedIcon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="type-item break-words text-ink">{selectedNode.name}</h2>
                  <p className="type-meta">{GRAPH_NODE_LABELS[(selectedNode.node_type || 'resource')]}</p>
                </div>
              </div>

              {selectedNode.description && (
                <p className="text-body leading-relaxed text-muted">{selectedNode.description}</p>
              )}

              {/* Metadatos legibles (sin internals crudos) */}
              <dl className="grid grid-cols-2 gap-2 text-meta">
                {selectedNode.meta?.category && (<><dt className="text-faint">Categoría</dt><dd className="text-ink">{selectedNode.meta.category}</dd></>)}
                {selectedNode.meta?.status && (<><dt className="text-faint">Estado</dt><dd className="text-ink">{selectedNode.meta.status}</dd></>)}
                {selectedNode.meta?.author && (<><dt className="text-faint">Autor</dt><dd className="text-ink">{selectedNode.meta.author}</dd></>)}
                {selectedNode.meta?.instructor && (<><dt className="text-faint">Instructor</dt><dd className="text-ink">{selectedNode.meta.instructor}</dd></>)}
                {typeof selectedNode.meta?.page_count === 'number' && (
                  <><dt className="text-faint">Páginas</dt><dd className="text-ink">{selectedNode.meta.current_page ?? 0} / {selectedNode.meta.page_count}</dd></>
                )}
                {typeof selectedNode.meta?.duration_minutes === 'number' && !selectedNode.meta?.page_count && (
                  <><dt className="text-faint">Duración</dt><dd className="text-ink">{selectedNode.meta.duration_minutes} min</dd></>
                )}
                {selectedNode.meta?.tags && (<><dt className="text-faint">Etiquetas</dt><dd className="col-span-1 text-ink">{selectedNode.meta.tags}</dd></>)}
              </dl>

              <div>
                <h3 className="type-micro mb-1.5">Relaciones ({relatedList.length})</h3>
                {relatedList.length === 0 ? (
                  <p className="type-meta">Sin relaciones registradas.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedList.map(({ edge, isOutgoing, counterpartId, counterpartName, counterpartType, relationLabel }) => (
                      <li key={edge.id} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-canvas p-2">
                        <div className="min-w-0">
                          <span className="text-micro">
                            {isOutgoing ? '→' : '←'} {relationLabel} · {GRAPH_NODE_LABELS[counterpartType]}
                          </span>
                          <button
                            onClick={() => handleSelectNodeClick(counterpartId)}
                            className="block w-full truncate text-left text-meta text-accent hover:underline"
                          >
                            {counterpartName}
                          </button>
                        </div>
                        {!edge.derived && (
                          <button
                            onClick={() => setPendingDeleteEdge({ id: edge.id, label: `${relationLabel} con ${counterpartName}` })}
                            title="Eliminar conexión"
                            aria-label={`Eliminar conexión ${relationLabel} con ${counterpartName}`}
                            className="shrink-0 rounded p-1 text-faint transition hover:text-error"
                          >
                            <Trash2 size={12} aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={handleSelectedNodeNavigation}>
                  <ArrowUpRight size={13} aria-hidden="true" /> Abrir {navigationLabel}
                </Button>
                {(selectedNode.node_type === 'course' || selectedNode.node_type === 'book' || selectedNode.node_type === 'resource') && (
                  <Button size="sm" variant="solid" onClick={() => onStudyResource(selectedNode.id)}>
                    <Lightbulb size={13} aria-hidden="true" /> Estudiar
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted">
              <Link2 size={26} className="text-faint" aria-hidden="true" />
              <p className="text-meta">Selecciona un nodo para ver su tipo, metadatos y relaciones.</p>
              <p className="text-micro max-w-[16rem]">
                La lista textual de relaciones está disponible aquí para lectores de pantalla.
              </p>
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
        <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <form
            onSubmit={handleSaveConnection}
            role="dialog"
            aria-modal="true"
            aria-labelledby="conn-title"
            className="w-full max-w-md space-y-4 rounded-xl border border-line bg-raised p-5 shadow-pop"
          >
            <div className="flex items-center justify-between border-b border-line pb-3">
              <h3 id="conn-title" className="type-section flex items-center gap-2 text-ink">
                <Link2 size={16} className="text-accent" aria-hidden="true" /> Añadir conexión
              </h3>
              <button type="button" onClick={() => setIsConnectionDialogOpen(false)} aria-label="Cerrar diálogo" className="rounded p-1 text-faint hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-source">Desde</label>
              <select
                id="conn-source"
                value={connectionForm.sourceId}
                onChange={e => setConnectionForm(f => ({ ...f, sourceId: e.target.value }))}
                className={INPUT_CLS}
                required
              >
                <option value="">-- Elige un nodo --</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{GRAPH_NODE_LABELS[(n.node_type || 'resource')]} · {n.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-relation">Relación</label>
              <select
                id="conn-relation"
                value={connectionForm.relationType}
                onChange={e => setConnectionForm(f => ({ ...f, relationType: e.target.value }))}
                className={INPUT_CLS}
              >
                {GRAPH_RELATION_TYPES.map(r => (
                  <option key={r} value={r}>{GRAPH_RELATION_LABELS[r]}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-target">Hacia</label>
              <select
                id="conn-target"
                value={connectionForm.targetId}
                onChange={e => setConnectionForm(f => ({ ...f, targetId: e.target.value }))}
                className={INPUT_CLS}
                required
              >
                <option value="">-- Elige un nodo --</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{GRAPH_NODE_LABELS[(n.node_type || 'resource')]} · {n.name}</option>
                ))}
              </select>
            </div>

            {connectionError && (
              <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-error-soft px-3 py-2 text-meta text-error" role="alert">
                <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{connectionError}</span>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-line pt-3">
              <Button variant="quiet" onClick={() => setIsConnectionDialogOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="solid"
                type="submit"
                disabled={isSavingConnection || !connectionForm.sourceId || !connectionForm.targetId || connectionForm.sourceId === connectionForm.targetId}
              >
                {isSavingConnection ? 'Guardando…' : 'Guardar conexión'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
