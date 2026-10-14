import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { ConceptNode, ConceptEdge, GraphNodeType, GraphRelationType } from '../types/models.ts';
// The `esnext` builds of vis-network/vis-data are used on purpose: the `peer`
// builds bundle a core-js `Set` whose internal `Symbol.iterator` is missing,
// breaking vis-network's transpiled private fields (`[...this.#selection]`) and
// leaving the graph blank. The `esnext` build uses native private fields and
// pulls in no polyfills.
import { Network, type Node, type Edge, type Options } from 'vis-network/esnext';
import { DataSet } from 'vis-data/esnext';
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
  AlertCircle,
  Download,
  Search,
  ClipboardList,
  BarChart3,
  ArrowDownRight
} from 'lucide-react';
import { dao } from '../db/dao.ts';
import { dbBridge, type DbInitFailure } from '../db/sqliteBridge.ts';
import {
  GRAPH_RELATION_LABELS,
  GRAPH_RELATION_TYPES,
  graphNodeLabel,
  graphRelationLabel,
  resolveGraphNodeDestination,
  describeDestructiveAction,
  searchGraphNodes,
  exportCanvasAsImage
} from '../services/domainLogic.ts';
import {
  applyGraphFilters,
  availableRelationTypes,
  computeConnectivityStats,
  explainIsolation,
  computeGraphAnalytics,
  buildGraphInsights
} from '../services/graphExploration.ts';
import { practiceWorkKindLabel } from '../services/practiceWork.ts';
import { useLanguage } from '../hooks/useLanguage.ts';



import { ConfirmDialog } from '../components/common/ConfirmDialog.tsx';
import { Button, Chip } from '../components/ui/index.tsx';

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

import {
  buildNetworkOptions,
  resolveGraphTokens,
  nodeColors,
  NODE_ICONS,
  FILTER_ORDER,
  type ThemeMode
} from '../components/graph/graphPresentation.ts';

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
  const { t: tr, effective } = useLanguage();



  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTypes, setActiveTypes] = useState<Set<GraphNodeType>>(new Set(FILTER_ORDER));
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isConnectionDialogOpen, setIsConnectionDialogOpen] = useState(false);
  const [connectionForm, setConnectionForm] = useState({ sourceId: '', relationType: 'related_to', targetId: '' });
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [isSavingConnection, setIsSavingConnection] = useState(false);
  const [pendingDeleteEdge, setPendingDeleteEdge] = useState<{ id: string; label: string } | null>(null);
  const [isStatsOpen, setIsStatsOpen] = useState(false);
  const [nodeSearchQuery, setNodeSearchQuery] = useState('');
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  // Relations hidden by the user (empty = all visible).
  const [hiddenRelations, setHiddenRelations] = useState<Set<string>>(new Set());
  // Neighborhood focus: 0 = full graph, 1/2 = hops around the node.
  const [focusDepth, setFocusDepth] = useState(0);
  const [theme, setTheme] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  );

  // The vis-network canvas does not read CSS variables: it rebuilds on theme change.
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
      // The graph is a lazy view: opening it may coincide with an in-flight
      // SQLite initialization (or an already recorded failure).
      // `ensureInitialized()` awaits the shared promise instead of assuming the
      // database exists, and reloads if another tab wrote later. This removes the
      // race that previously ended in "Database not initialized".
      await dbBridge.ensureInitialized();
      const data = await dao.getKnowledgeGraph();
      // Tolerantly prunes orphan connections (does not block the view).
      await dao.pruneDanglingConnections();
      setGraphData(data);
    } catch (err: any) {
      // Only known failure classes show, with their controlled Spanish message.
      // Raw text from an internal exception is never rendered (Rule 5).
      const failure: DbInitFailure | undefined = err?.failure;
      setLoadError(
        failure?.message ||
          tr('graph.loadFail')
      );
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

  // Relation types actually present: the filter bar only offers what exists,
  // instead of a fixed list that may end up empty.
  const relationTypes = useMemo(() => availableRelationTypes(graphData.edges), [graphData.edges]);

  const activeRelations = useMemo<Set<string> | null>(() => {
    if (hiddenRelations.size === 0) return null;
    const remaining = new Set(relationTypes);
    for (const relation of hiddenRelations) remaining.delete(relation);
    return remaining;
  }, [hiddenRelations, relationTypes]);

  const visibleGraph = useMemo(
    () =>
      applyGraphFilters(graphData.nodes, graphData.edges, {
        activeTypes,
        activeRelations,
        focusNodeId: focusDepth > 0 ? selectedNodeId : null,
        focusDepth
      }),
    [graphData, activeTypes, activeRelations, focusDepth, selectedNodeId]
  );

  // Connectivity over the COMPLETE graph (not the filtered one): an exploration
  // hint ("how many nodes remain unlinked") that does not change while filtering.
  const connectivity = useMemo(
    () => computeConnectivityStats(graphData.nodes, graphData.edges),
    [graphData]
  );

  // Separates "no relation at all" from "isolated only in this view": filtering
  // by type can hide a node's edges and make it look disconnected.
  const isolation = useMemo(
    () => explainIsolation(graphData.nodes, graphData.edges, visibleGraph.nodes, visibleGraph.edges),
    [graphData, visibleGraph]
  );

  // Structural analytics over the COMPLETE graph (real topological properties;
  // never inferences about the person).
  const analytics = useMemo(
    () => computeGraphAnalytics(graphData.nodes, graphData.edges),
    [graphData]
  );
  const insights = useMemo(() => buildGraphInsights(analytics, effective), [analytics, effective]);

  /**
   * Centers an analytics node. Analytics is computed over the complete graph, so
   * filters reset first to ensure the node exists on the canvas; the selection
   * reapplies after the next render.
   */
  const handleStatsNodeClick = (nodeId: string) => {
    setActiveTypes(new Set(FILTER_ORDER));
    setHiddenRelations(new Set());
    setFocusDepth(0);
    setSelectedNodeId(nodeId);
    window.setTimeout(() => {
      if (networkRef.current) {
        try {
          networkRef.current.selectNodes([nodeId]);
          networkRef.current.focus(nodeId, { scale: 1.1, animation: false });
        } catch {
          /* The node is not mounted yet: the state selection is already set. */
        }
      }
    }, 80);
  };

  // Builds/updates the vis-network graph without re-initializing it on filter.
  useEffect(() => {
    if (!containerRef.current) return;

    // Theme change: the previous graph uses the prior theme's colors.
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

    const t = resolveGraphTokens(theme);

    const visNodes: Node[] = visibleGraph.nodes.map(n => {
      const type = n.node_type || 'resource';
      const colors = nodeColors(type, theme);
      return {
        id: n.id,
        label: n.name,
        title: n.description || graphNodeLabel(type as GraphNodeType, effective),
        color: {
          background: colors.background,
          border: colors.border,
          highlight: { background: t.accentSoft, border: t.accent }
        },
        font: { color: t.ink }
      };
    });
    const visEdges: Edge[] = visibleGraph.edges.map(e => ({
      id: e.id,
      from: e.source_id,
      to: e.target_id,
      label: e.connection_type in GRAPH_RELATION_LABELS ? graphRelationLabel(e.connection_type as GraphRelationType, effective) : e.connection_type,
      dashes: !!e.derived,
      arrows: 'to',
      color: { color: e.derived ? t.derived : t.accent },
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
  }, [visibleGraph, theme, effective]);

  useEffect(() => {
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, []);

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

  const toggleRelation = (relation: string) => {
    setHiddenRelations(prev => {
      const next = new Set(prev);
      if (next.has(relation)) next.delete(relation);
      else next.add(relation);
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
    ? graphNodeLabel((selectedNode.node_type || 'resource') as GraphNodeType, effective)
    : tr('graph.nodeGeneric');

  const handleSaveConnection = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnectionError(null);
    setIsSavingConnection(true);
    try {
      const res = await dao.createKnowledgeConnection(connectionForm);
      if (!res.success) {
        setConnectionError(res.error || tr('graph.connFail'));
        return;
      }
      setIsConnectionDialogOpen(false);
      setConnectionForm({ sourceId: '', relationType: 'related_to', targetId: '' });
      onGraphMutated?.();
    } catch (err: any) {
      setConnectionError(err?.message || tr('graph.saveFail'));
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
      relationLabel: edge.connection_type in GRAPH_RELATION_LABELS ? graphRelationLabel(edge.connection_type as GraphRelationType, effective) : edge.connection_type
    };
  });

  const searchResults = useMemo(
    () => searchGraphNodes(graphData.nodes, nodeSearchQuery, 8),
    [graphData.nodes, nodeSearchQuery]
  );

  const handleSelectSearchResult = (node: ConceptNode) => {
    setSelectedNodeId(node.id);
    setNodeSearchQuery('');
    setIsSearchOpen(false);

    const type = (node.node_type || 'resource') as GraphNodeType;
    if (!activeTypes.has(type)) {
      setActiveTypes(prev => new Set([...prev, type]));
    }

    if (networkRef.current) {
      networkRef.current.selectNodes([node.id]);
      networkRef.current.focus(node.id, {
        scale: 1.25,
        animation: {
          duration: 700,
          easingFunction: 'easeInOutQuad'
        }
      });
    }
  };

  const handleExportPng = () => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;
    const bgColor = theme === 'dark' ? '#1C1917' : '#FAF7F2';
    exportCanvasAsImage(canvas, bgColor, `crossedarts-grafo-${new Date().toISOString().slice(0, 10)}.png`);
  };

  const SelectedIcon = selectedNode ? NODE_ICONS[(selectedNode.node_type || 'resource')] : Share2;
  const INPUT_CLS = 'w-full rounded-lg border border-line bg-canvas px-3 py-2 text-body text-ink focus:border-accent/50 focus:outline-none';

  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="type-display text-ink">{tr('graph.title')}</h1>
          <p className="type-secondary mt-1 max-w-2xl">
            {tr('graph.subtitle')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <Button
            variant="outline"
            onClick={handleExportPng}
            disabled={graphData.nodes.length === 0}
            title={tr('graph.exportTitle')}
          >
            <Download size={14} aria-hidden="true" /> {tr('graph.exportPng')}
          </Button>
          <Button
            variant="outline"
            onClick={() => { setConnectionError(null); setIsConnectionDialogOpen(true); }}
          >
            <Plus size={15} aria-hidden="true" /> {tr('graph.addConn')}
          </Button>
          <Button
            variant="outline"
            onClick={() => setIsStatsOpen(value => !value)}
            aria-expanded={isStatsOpen}
            aria-controls="graph-analytics-panel"
          >
            <BarChart3 size={14} aria-hidden="true" /> {tr('graph.stats')}
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr('graph.nodeFilters')}>
            <Chip
              active={activeTypes.size === FILTER_ORDER.length}
              onClick={() => setActiveTypes(new Set(FILTER_ORDER))}
            >
              {tr('graph.all')}
            </Chip>
            {FILTER_ORDER.map(type => {
              const Icon = NODE_ICONS[type];
              const active = activeTypes.has(type);
              return (
                <Chip key={type} active={active} onClick={() => toggleType(type)}>
                  <Icon size={13} aria-hidden="true" /> {graphNodeLabel(type, effective)}
                </Chip>
              );
            })}
          </div>

          {relationTypes.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tr('graph.relFilters')}>
              <span className="type-micro text-faint">{tr('graph.rels')}</span>
              <Chip active={hiddenRelations.size === 0} onClick={() => setHiddenRelations(new Set())}>
                {tr('graph.allF')}
              </Chip>
              {relationTypes.map(relation => (
                <Chip
                  key={relation}
                  active={!hiddenRelations.has(relation)}
                  onClick={() => toggleRelation(relation)}
                >
                  {relation in GRAPH_RELATION_LABELS ? graphRelationLabel(relation as GraphRelationType, effective) : relation}
                </Chip>
              ))}
            </div>
          )}
        </div>

        <div className="relative w-full sm:w-72 shrink-0">
          <div className="relative">
            <input
              type="search"
              value={nodeSearchQuery}
              onChange={e => {
                setNodeSearchQuery(e.target.value);
                setIsSearchOpen(true);
              }}
              onFocus={() => setIsSearchOpen(true)}
              placeholder={tr('graph.searchPh')}
              className="w-full rounded-lg border border-line bg-canvas pl-8 pr-3 py-1.5 text-meta text-ink placeholder:text-faint focus:border-accent/50 focus:outline-none"
              aria-label={tr('graph.searchPh')}
            />
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden="true" />
          </div>

          {isSearchOpen && nodeSearchQuery.trim() && (
            <div className="absolute left-0 right-0 z-30 mt-1 max-h-60 overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-pop">
              {searchResults.length === 0 ? (
                <p className="px-3 py-2 text-meta text-muted">{tr('graph.noMatch')}</p>
              ) : (
                searchResults.map(node => {
                  const type = (node.node_type || 'resource') as GraphNodeType;
                  const Icon = NODE_ICONS[type] || Lightbulb;
                  return (
                    <button
                      key={node.id}
                      type="button"
                      onClick={() => handleSelectSearchResult(node)}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-meta text-ink hover:bg-accent-soft transition-colors"
                    >
                      <Icon size={13} className="shrink-0 text-accent" aria-hidden="true" />
                      <span className="truncate flex-1 font-medium">{node.name}</span>
                      <span className="text-micro text-muted shrink-0">{graphNodeLabel(type, effective)}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="relative h-[560px] w-full overflow-hidden rounded-xl border border-line bg-surface shadow-card lg:col-span-2">
          {isLoading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
              <Loader2 className="animate-spin text-accent" size={28} aria-hidden="true" />
              <p className="text-meta">{tr('graph.building')}</p>
            </div>
          ) : loadError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-error">
              <AlertCircle size={28} aria-hidden="true" />
              <p className="text-meta">{loadError}</p>
            </div>
          ) : graphData.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <Share2 size={32} className="text-faint" aria-hidden="true" />
              <p className="type-section text-ink">{tr('graph.emptyTitle')}</p>
              <p className="type-meta max-w-xs">
                {tr('graph.emptyHint')}
              </p>
            </div>
          ) : visibleGraph.nodes.length === 0 ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center text-muted">
              <Info size={26} className="text-faint" aria-hidden="true" />
              <p className="text-meta">{tr('graph.filtersHide')}</p>
            </div>
          ) : (
            <div ref={containerRef} className="h-full w-full" />
          )}
          {/*
            Leyenda de relaciones (accesible y discreta).

            Responsive: en pantallas estrechas se ancla a AMBOS lados para envolver
            en menos líneas en vez de crecer en alto sobre el lienzo, y el padding
            se reduce. Los metadatos (conectividad y aislamiento) bajan a `text-micro`
            porque son información secundaria y semánticamente compactable; la
            indicación de interacción principal se mantiene en `text-meta`. Nada se
            oculta: toda la información sigue presente en cualquier tamaño.
          */}
          <div className="pointer-events-none absolute bottom-3 left-3 right-3 flex items-start gap-2 rounded-lg border border-line bg-raised/95 px-2.5 py-1.5 text-meta text-muted backdrop-blur-sm sm:bottom-4 sm:left-4 sm:right-auto sm:max-w-[26rem] sm:px-3 sm:py-2">
            <Info size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
            <div className="min-w-0">
              <p className="leading-snug">
                {tr('graph.legendMain')}
              </p>
              <p className="mt-0.5 text-micro leading-snug text-faint">
                {tr('graph.legendConn', { a: connectivity.connected, b: connectivity.total })}
                {connectivity.isolated > 0 ? tr('graph.legendIso', { n: connectivity.isolated }) : ''}
              </p>
              {isolation.apparentlyIsolated > 0 && (
                <p className="mt-0.5 text-micro leading-snug text-faint">
                  {isolation.apparentlyIsolated === 1 ? tr('graph.legendViewOne', { n: isolation.apparentlyIsolated }) : tr('graph.legendViewOther', { n: isolation.apparentlyIsolated })}{tr('graph.legendViewWhy')}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Accessible detail panel */}
        <div className="max-h-[560px] space-y-3 overflow-y-auto rounded-xl border border-line bg-surface p-4 shadow-card" aria-live="polite">
          {selectedNode ? (
            <>
              <div className="flex items-start gap-2.5">
                <div className="rounded-lg border border-accent/25 bg-accent-soft p-2 text-accent">
                  <SelectedIcon size={16} aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="type-item break-words text-ink">{selectedNode.name}</h2>
                  <p className="type-meta">{graphNodeLabel((selectedNode.node_type || 'resource') as GraphNodeType, effective)}</p>
                </div>
              </div>

              {/* Neighborhood focus: isolates the node and its N hops. */}
              <div
                className="flex flex-wrap items-center gap-1.5"
                role="group"
                aria-label={tr('graph.focusSr')}
              >
                <Chip active={focusDepth === 0} onClick={() => setFocusDepth(0)}>
                  {tr('graph.fullGraph')}
                </Chip>
                <Chip active={focusDepth === 1} onClick={() => setFocusDepth(1)}>
                  {tr('graph.neighbors')}
                </Chip>
                <Chip active={focusDepth === 2} onClick={() => setFocusDepth(2)}>
                  {tr('graph.hops2')}
                </Chip>
              </div>

              {selectedNode.description && (
                <p className="text-body leading-relaxed text-muted">{selectedNode.description}</p>
              )}

              {/* Readable metadata (no raw internals) */}
              <dl className="grid grid-cols-2 gap-2 text-meta">
                {selectedNode.meta?.category && (<><dt className="text-faint">{tr('graph.metaCat')}</dt><dd className="text-ink">{selectedNode.meta.category}</dd></>)}
                {selectedNode.meta?.status && (<><dt className="text-faint">{tr('graph.metaStatus')}</dt><dd className="text-ink">{selectedNode.meta.status}</dd></>)}
                {selectedNode.meta?.author && (<><dt className="text-faint">{tr('graph.metaAuthor')}</dt><dd className="text-ink">{selectedNode.meta.author}</dd></>)}
                {selectedNode.meta?.instructor && (<><dt className="text-faint">{tr('graph.metaInstructor')}</dt><dd className="text-ink">{selectedNode.meta.instructor}</dd></>)}
                {typeof selectedNode.meta?.page_count === 'number' && (
                  <><dt className="text-faint">{tr('graph.metaPages')}</dt><dd className="text-ink">{selectedNode.meta.current_page ?? 0} / {selectedNode.meta.page_count}</dd></>
                )}
                {typeof selectedNode.meta?.duration_minutes === 'number' && !selectedNode.meta?.page_count && (
                  <><dt className="text-faint">{tr('graph.metaDur')}</dt><dd className="text-ink">{tr('graph.minShort', { n: selectedNode.meta.duration_minutes })}</dd></>
                )}
                {selectedNode.meta?.practice_kind && (
                  <><dt className="text-faint">{tr('graph.metaType')}</dt><dd className="text-ink">{practiceWorkKindLabel(selectedNode.meta.practice_kind, effective)}</dd></>
                )}
                {selectedNode.meta?.tags && (<><dt className="text-faint">{tr('graph.metaTags')}</dt><dd className="col-span-1 text-ink">{selectedNode.meta.tags}</dd></>)}
              </dl>

              <div>
                <h3 className="type-micro mb-1.5">{tr('graph.relsCount', { n: relatedList.length })}</h3>
                {relatedList.length === 0 ? (
                  <p className="type-meta">{tr('graph.noRels')}</p>
                ) : (
                  <ul className="space-y-1.5">
                    {relatedList.map(({ edge, isOutgoing, counterpartId, counterpartName, counterpartType, relationLabel }) => (
                      <li key={edge.id} className="flex items-start justify-between gap-2 rounded-lg border border-line bg-canvas p-2">
                        <div className="min-w-0">
                          <span className="text-micro">
                            {isOutgoing ? '→' : '←'} {relationLabel} · {graphNodeLabel(counterpartType, effective)}
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
                            onClick={() => setPendingDeleteEdge({ id: edge.id, label: tr('graph.connWith', { rel: relationLabel, name: counterpartName }) })}
                            title={tr('graph.deleteConn')}
                            aria-label={tr('graph.deleteConnSr', { rel: relationLabel, name: counterpartName })}
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
                  <ArrowUpRight size={13} aria-hidden="true" /> {tr('graph.open', { label: navigationLabel })}
                </Button>
                {(selectedNode.node_type === 'course' || selectedNode.node_type === 'book' || selectedNode.node_type === 'resource') && (
                  <Button size="sm" variant="solid" onClick={() => onStudyResource(selectedNode.id)}>
                    <Lightbulb size={13} aria-hidden="true" /> {tr('graph.study')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center text-muted">
              <Link2 size={26} className="text-faint" aria-hidden="true" />
              <p className="text-meta">{tr('graph.selectNode')}</p>
              <p className="text-micro max-w-[16rem]">
                {tr('graph.srList')}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* --- Structural graph analytics (real topological properties) --- */}
      {isStatsOpen && (
        <section
          id="graph-analytics-panel"
          aria-label={tr('graph.statsSr')}
          className="rounded-xl border border-line bg-surface p-5 shadow-card"
        >
          <div className="mb-4 border-b border-line pb-3">
            <h2 className="type-section text-ink">{tr('graph.statsTitle')}</h2>
            <p className="type-meta mt-0.5">
              {tr('graph.statsSub')}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
              <dt className="type-micro text-muted">{tr('graph.stNodes')}</dt>
              <dd className="text-xl font-semibold text-ink">{analytics.totalNodes}</dd>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
              <dt className="type-micro text-muted">{tr('graph.stConnected')}</dt>
              <dd className="text-xl font-semibold text-ink">{analytics.connectedNodes}</dd>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
              <dt className="type-micro text-muted">{tr('graph.stIsolated')}</dt>
              <dd className="text-xl font-semibold text-ink">{analytics.isolatedNodes}</dd>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
              <dt className="type-micro text-muted">{tr('graph.stEdges')}</dt>
              <dd className="text-xl font-semibold text-ink">{analytics.totalEdges}</dd>
            </div>
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
              <dt className="type-micro text-muted">{tr('graph.stGroups')}</dt>
              <dd className="text-xl font-semibold text-ink">{analytics.components.count}</dd>
            </div>
          </dl>

          <div className="mt-4">
            <h3 className="type-micro text-muted">{tr('graph.reading')}</h3>
            <ul className="mt-1.5 space-y-1.5">
              {insights.map((insight, index) => (
                <li key={index} className="flex items-start gap-2 text-meta text-ink">
                  <ArrowDownRight size={13} className="mt-0.5 shrink-0 text-accent" aria-hidden="true" />
                  <span>{insight}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <h3 className="type-micro text-muted">{tr('graph.top')}</h3>
              {analytics.topConnected.length === 0 ? (
                <p className="mt-1.5 type-meta text-muted">{tr('graph.topEmpty')}</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {analytics.topConnected.map(entry => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => handleStatsNodeClick(entry.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition hover:border-accent/40"
                      >
                        <span className="min-w-0 truncate text-meta text-ink">{entry.name}</span>
                        <span className="shrink-0 text-micro text-muted">
                          {tr('graph.topMeta', { type: graphNodeLabel(entry.type, effective), n: entry.degree })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="type-micro text-muted">{tr('graph.weak')}</h3>
              {analytics.weakResources.length === 0 ? (
                <p className="mt-1.5 type-meta text-muted">{tr('graph.weakEmpty')}</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {analytics.weakResources.map(entry => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => handleStatsNodeClick(entry.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition hover:border-accent/40"
                      >
                        <span className="min-w-0 truncate text-meta text-ink">{entry.name}</span>
                        <span className="shrink-0 text-micro text-muted">
                          {entry.degree === 1 ? tr('graph.weakOne', { n: entry.degree }) : tr('graph.weakOther', { n: entry.degree })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Recent activity (only with real dates) */}
            <div>
              <h3 className="type-micro text-muted">{tr('graph.recentK')}</h3>
              {!analytics.hasDateInfo ? (
                <p className="mt-1.5 type-meta text-muted">
                  {tr('graph.recentNoDates')}
                </p>
              ) : analytics.recent.length === 0 ? (
                <p className="mt-1.5 type-meta text-muted">{tr('graph.recentEmpty')}</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {analytics.recent.map(entry => (
                    <li key={entry.id}>
                      <button
                        type="button"
                        onClick={() => handleStatsNodeClick(entry.id)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5 text-left transition hover:border-accent/40"
                      >
                        <span className="min-w-0 truncate text-meta text-ink">{entry.name}</span>
                        <span className="shrink-0 text-micro text-muted">
                          {tr('graph.topMeta', { type: graphNodeLabel(entry.type, effective), n: entry.date })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Accessible confirmation to delete relations (destructive action) */}
      <ConfirmDialog
        isOpen={!!pendingDeleteEdge}
        title={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '', effective).title}
        consequence={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '', effective).consequence}
        confirmLabel={describeDestructiveAction('delete-connection', pendingDeleteEdge?.label || '', effective).confirmLabel}
        onCancel={() => setPendingDeleteEdge(null)}
        onConfirm={async () => {
          const target = pendingDeleteEdge;
          setPendingDeleteEdge(null);
          if (target) await handleDeleteConnection(target.id);
        }}
      />

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
                <Link2 size={16} className="text-accent" aria-hidden="true" /> {tr('graph.connTitle')}
              </h3>
              <button type="button" onClick={() => setIsConnectionDialogOpen(false)} aria-label={tr('graph.closeDialog')} className="rounded p-1 text-faint hover:text-ink">
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-source">{tr('graph.from')}</label>
              <select
                id="conn-source"
                value={connectionForm.sourceId}
                onChange={e => setConnectionForm(f => ({ ...f, sourceId: e.target.value }))}
                className={INPUT_CLS}
                required
              >
                <option value="">{tr('graph.chooseNode')}</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{graphNodeLabel((n.node_type || 'resource') as GraphNodeType, effective)} · {n.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-relation">{tr('graph.relation')}</label>
              <select
                id="conn-relation"
                value={connectionForm.relationType}
                onChange={e => setConnectionForm(f => ({ ...f, relationType: e.target.value }))}
                className={INPUT_CLS}
              >
                {GRAPH_RELATION_TYPES.map(r => (
                  <option key={r} value={r}>{graphRelationLabel(r, effective)}</option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="mb-1 block text-meta font-medium text-muted" htmlFor="conn-target">{tr('graph.to')}</label>
              <select
                id="conn-target"
                value={connectionForm.targetId}
                onChange={e => setConnectionForm(f => ({ ...f, targetId: e.target.value }))}
                className={INPUT_CLS}
                required
              >
                <option value="">{tr('graph.chooseNode')}</option>
                {sortedNodes.map(n => (
                  <option key={n.id} value={n.id}>{graphNodeLabel((n.node_type || 'resource') as GraphNodeType, effective)} · {n.name}</option>
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
                {tr('graph.cancel')}
              </Button>
              <Button
                variant="solid"
                type="submit"
                disabled={isSavingConnection || !connectionForm.sourceId || !connectionForm.targetId || connectionForm.sourceId === connectionForm.targetId}
              >
                {isSavingConnection ? tr('graph.saving') : tr('graph.saveConn')}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
