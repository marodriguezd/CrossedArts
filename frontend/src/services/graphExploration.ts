/**
 * Knowledge-graph exploration: filter by node and relation type, focus on one
 * node's neighborhood, plus connectivity stats. Pure logic (no React or
 * vis-network) for node:test coverage, keeping the page component presentational.
 */
import type { ConceptEdge, ConceptNode, GraphNodeType } from '../types/models.ts';
import { translateKey } from '../i18n/dictionaries.ts';
import type { LanguageCode } from '../i18n/languages.ts';

export interface GraphFilterOptions {
  /** Visible node types. */
  activeTypes: ReadonlySet<GraphNodeType>;
  /**
   * Visible relation types. `null` means "all"; an EMPTY set shows no edges
   * (the user hid them all).
   */
  activeRelations: ReadonlySet<string> | null;
  /** Neighborhood-focus root node; `null` disables focus. */
  focusNodeId: string | null;
  /** Max neighborhood depth (>= 1). Ignored without `focusNodeId`. */
  focusDepth: number;
}

/** One node's type, with the graph's historic default. */
export function nodeTypeOf(node: ConceptNode): GraphNodeType {
  return node.node_type || 'resource';
}

/**
 * Ids reachable from `rootId` within `depth` hops. `depth = 0` returns only
 * the root. When the root is absent from the graph the set is empty (nodes are
 * never invented).
 */
export function collectNeighborhood(
  edges: readonly ConceptEdge[],
  rootId: string,
  depth: number,
  nodeIds?: ReadonlySet<string>
): Set<string> {
  const reached = new Set<string>();
  if (!rootId) return reached;
  if (nodeIds && !nodeIds.has(rootId)) return reached;

  const maxDepth = Math.max(0, Math.floor(depth));
  reached.add(rootId);
  let frontier = new Set<string>([rootId]);

  for (let hop = 0; hop < maxDepth && frontier.size > 0; hop += 1) {
    const next = new Set<string>();
    for (const edge of edges) {
      let neighbor: string | null = null;
      if (frontier.has(edge.source_id)) neighbor = edge.target_id;
      else if (frontier.has(edge.target_id)) neighbor = edge.source_id;
      if (!neighbor) continue;
      if (nodeIds && !nodeIds.has(neighbor)) continue;
      if (reached.has(neighbor)) continue;
      reached.add(neighbor);
      next.add(neighbor);
    }
    frontier = next;
  }

  return reached;
}

/** Relation types actually present on edges, sorted. */
export function availableRelationTypes(edges: readonly ConceptEdge[]): string[] {
  const set = new Set<string>();
  for (const edge of edges) {
    if (edge.connection_type) set.add(edge.connection_type);
  }
  return Array.from(set).sort();
}

/**
 * Applies in order: node-type filter, relation-type filter, neighborhood
 * focus. The result only keeps edges with both ends visible.
 */
export function applyGraphFilters(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[],
  options: GraphFilterOptions
): { nodes: ConceptNode[]; edges: ConceptEdge[] } {
  const typeFiltered = nodes.filter((node) => options.activeTypes.has(nodeTypeOf(node)));
  const visibleIds = new Set(typeFiltered.map((node) => node.id));

  const relationsActive = options.activeRelations !== null;
  const relationFiltered = edges.filter(
    (edge) =>
      visibleIds.has(edge.source_id) &&
      visibleIds.has(edge.target_id) &&
      (!relationsActive || options.activeRelations!.has(edge.connection_type))
  );

  if (!options.focusNodeId || options.focusDepth <= 0) {
    return { nodes: typeFiltered, edges: relationFiltered };
  }

  const neighborhood = collectNeighborhood(
    relationFiltered,
    options.focusNodeId,
    options.focusDepth,
    visibleIds
  );
  const focusedNodes = typeFiltered.filter((node) => neighborhood.has(node.id));
  const focusedEdges = relationFiltered.filter(
    (edge) => neighborhood.has(edge.source_id) && neighborhood.has(edge.target_id)
  );

  return { nodes: focusedNodes, edges: focusedEdges };
}

/** Per-node degree (incident edge count), counting each end once. */
export function computeDegrees(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[]
): Map<string, number> {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    if (degree.has(edge.source_id)) degree.set(edge.source_id, degree.get(edge.source_id)! + 1);
    if (degree.has(edge.target_id)) degree.set(edge.target_id, degree.get(edge.target_id)! + 1);
  }
  return degree;
}

export interface ConnectivityStats {
  total: number;
  connected: number;
  isolated: number;
  /** Ids of connectionless nodes (organize candidates). */
  isolatedIds: string[];
}

/** How many nodes have at least one edge vs. stand isolated. */
export function computeConnectivityStats(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[]
): ConnectivityStats {
  const degree = computeDegrees(nodes, edges);

  const isolatedIds: string[] = [];
  for (const [id, count] of degree.entries()) {
    if (count === 0) isolatedIds.push(id);
  }

  return {
    total: nodes.length,
    connected: nodes.length - isolatedIds.length,
    isolated: isolatedIds.length,
    isolatedIds
  };
}

/**
 * Tells apart two things the UI must NEVER conflate:
 *
 *  - `isolatedGlobally`: nodes with no relation in the full graph.
 *  - `apparentlyIsolated`: nodes that look relationless ONLY in the current
 *    view because a filter or neighborhood focus hides their edges.
 *
 * Without this split, type filtering made linked nodes look disconnected and
 * connectivity stats lied. Global connectivity stays honest: measured on the
 * full graph, not the view.
 */
export interface IsolationExplanation {
  isolatedGlobally: number;
  apparentlyIsolated: number;
  apparentlyIsolatedIds: string[];
}

export function explainIsolation(
  allNodes: readonly ConceptNode[],
  allEdges: readonly ConceptEdge[],
  visibleNodes: readonly ConceptNode[],
  visibleEdges: readonly ConceptEdge[]
): IsolationExplanation {
  const globalDegree = computeDegrees(allNodes, allEdges);
  const viewDegree = computeDegrees(visibleNodes, visibleEdges);

  let isolatedGlobally = 0;
  for (const node of allNodes) {
    if ((globalDegree.get(node.id) ?? 0) === 0) isolatedGlobally += 1;
  }

  const apparentlyIsolatedIds: string[] = [];
  for (const node of visibleNodes) {
    if ((viewDegree.get(node.id) ?? 0) === 0 && (globalDegree.get(node.id) ?? 0) > 0) {
      apparentlyIsolatedIds.push(node.id);
    }
  }

  return {
    isolatedGlobally,
    apparentlyIsolated: apparentlyIsolatedIds.length,
    apparentlyIsolatedIds
  };
}

/** Ranking entry by connection count. */
export interface GraphDegreeEntry {
  id: string;
  name: string;
  type: GraphNodeType;
  degree: number;
}

export interface GraphComponentStats {
  /** Count of mutually disconnected groups (an isolated node is its own group). */
  count: number;
  largestSize: number;
  /** Sizes largest-first, for sizing without guessing. */
  sizes: number[];
}

export interface GraphRecentEntry {
  id: string;
  name: string;
  type: GraphNodeType;
  /** Known creation or update date (YYYY-MM-DD or ISO). */
  date: string;
}

export interface GraphAnalytics {
  totalNodes: number;
  totalEdges: number;
  connectedNodes: number;
  isolatedNodes: number;
  isolatedIds: string[];
  /** Per-type node counts (present types only). */
  typeCounts: Partial<Record<GraphNodeType, number>>;
  /** Highest-DEGREE nodes (literal label; never "most important"). */
  topConnected: GraphDegreeEntry[];
  /** Threshold for "unusually high degree". */
  highDegreeThreshold: number;
  /** Nodes above the statistical degree threshold. */
  highDegree: GraphDegreeEntry[];
  /** Resources, courses, and books with 0-1 connections: weakly linked material. */
  weakResources: GraphDegreeEntry[];
  components: GraphComponentStats;
  /** Dated items, newest first. */
  recent: GraphRecentEntry[];
  /** False when no node exposes dates: no recent activity is invented. */
  hasDateInfo: boolean;
}

const DEGREE_ENTRY_LIMIT = 5;
const WEAK_RESOURCE_LIMIT = 8;
const RECENT_LIMIT = 6;
const RESOURCE_TYPES: ReadonlySet<GraphNodeType> = new Set<GraphNodeType>(['resource', 'course', 'book']);

function degreeEntry(node: ConceptNode, degree: number): GraphDegreeEntry {
  return { id: node.id, name: node.name, type: nodeTypeOf(node), degree };
}

/** Connected-group sizes (undirected union) over the given nodes. */
export function computeComponentSizes(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[]
): number[] {
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.source_id) || !adjacency.has(edge.target_id)) continue;
    adjacency.get(edge.source_id)!.push(edge.target_id);
    adjacency.get(edge.target_id)!.push(edge.source_id);
  }

  const visited = new Set<string>();
  const sizes: number[] = [];
  for (const node of nodes) {
    if (visited.has(node.id)) continue;
    let size = 0;
    const stack = [node.id];
    visited.add(node.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      size += 1;
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          stack.push(neighbor);
        }
      }
    }
    sizes.push(size);
  }
  return sizes.sort((a, b) => b - a);
}

/**
 * STRUCTURAL graph analytics: real topological properties (degree,
 * connectivity, components, dates). Never infers domain, intelligence, or
 * importance: `topConnected` literally means "highest connection counts".
 */
export function computeGraphAnalytics(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[]
): GraphAnalytics {
  const degree = computeDegrees(nodes, edges);

  let connectedNodes = 0;
  const isolatedIds: string[] = [];
  const typeCounts: Partial<Record<GraphNodeType, number>> = {};

  for (const node of nodes) {
    const type = nodeTypeOf(node);
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    const value = degree.get(node.id) ?? 0;
    if (value > 0) connectedNodes += 1;
    else isolatedIds.push(node.id);
  }
  isolatedIds.sort();

  const entries = nodes
    .map(node => degreeEntry(node, degree.get(node.id) ?? 0))
    .sort((a, b) => b.degree - a.degree || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  const topConnected = entries.filter(entry => entry.degree > 0).slice(0, DEGREE_ENTRY_LIMIT);

  // Unusual-degree threshold: mean + 2 stddevs, floored at 4 so tiny graphs
  // are never labeled "unusual".
  const degrees = nodes.map(node => degree.get(node.id) ?? 0);
  const mean = degrees.length > 0 ? degrees.reduce((sum, value) => sum + value, 0) / degrees.length : 0;
  const variance = degrees.length > 0
    ? degrees.reduce((sum, value) => sum + (value - mean) ** 2, 0) / degrees.length
    : 0;
  const highDegreeThreshold = Math.max(4, Math.ceil(mean + 2 * Math.sqrt(variance)));
  const highDegree = entries.filter(entry => entry.degree >= highDegreeThreshold);

  const weakResources = entries
    .filter(entry => RESOURCE_TYPES.has(entry.type) && entry.degree <= 1)
    .sort((a, b) => a.degree - b.degree || a.name.localeCompare(b.name))
    .slice(0, WEAK_RESOURCE_LIMIT);

  const sizes = computeComponentSizes(nodes, edges);

  const recent: GraphRecentEntry[] = [];
  let hasDateInfo = false;
  for (const node of nodes) {
    const raw = node.meta?.updated_at || node.meta?.created_at;
    if (!raw) continue;
    const date = String(raw).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    hasDateInfo = true;
    recent.push({ id: node.id, name: node.name, type: nodeTypeOf(node), date });
  }
  recent.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

  return {
    totalNodes: nodes.length,
    totalEdges: edges.length,
    connectedNodes,
    isolatedNodes: isolatedIds.length,
    isolatedIds,
    typeCounts,
    topConnected,
    highDegreeThreshold,
    highDegree,
    weakResources,
    components: {
      count: sizes.length,
      largestSize: sizes.length > 0 ? sizes[0] : 0,
      sizes
    },
    recent: recent.slice(0, RECENT_LIMIT),
    hasDateInfo
  };
}

/**
 * ACTIONABLE honest sentences about structural analytics. Each is a verifiable
 * graph fact; none turns connections into importance.
 */
export function buildGraphInsights(analytics: GraphAnalytics, lang: LanguageCode = 'es'): string[] {
  if (analytics.totalNodes === 0) {
    return [translateKey(lang, 'graph.insight.empty')];
  }

  const insights: string[] = [];

  if (analytics.isolatedNodes > 0) {
    insights.push(
      analytics.isolatedNodes === 1
        ? translateKey(lang, 'graph.insight.isolatedOne')
        : translateKey(lang, 'graph.insight.isolatedOther', { n: analytics.isolatedNodes })
    );
  }

  if (analytics.components.count > 1) {
    insights.push(
      translateKey(lang, 'graph.insight.groups', { n: analytics.components.count, m: analytics.components.largestSize })
    );
  }

  if (analytics.weakResources.length > 0) {
    insights.push(
      translateKey(lang, `graph.insight.${analytics.weakResources.length === 1 ? 'weakOne' : 'weakOther'}`, { n: analytics.weakResources.length })
    );
  }

  const most = analytics.topConnected[0];
  if (most) {
    insights.push(translateKey(lang, 'graph.insight.topMost', { name: most.name, n: most.degree }));
  }

  if (analytics.highDegree.length > 0) {
    insights.push(
      translateKey(lang, `graph.insight.${analytics.highDegree.length === 1 ? 'hubOne' : 'hubOther'}`, { n: analytics.highDegree.length, t: analytics.highDegreeThreshold })
    );
  }

  if (analytics.recent.length > 0) {
    insights.push(translateKey(lang, 'graph.insight.recentAct', { n: analytics.recent.length, date: analytics.recent[0].date }));
  }

  return insights;
}
