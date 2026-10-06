/**
 * Exploración del grafo de conocimiento: filtrado por tipo de nodo y de
 * relación, enfoque en el vecindario de un nodo y estadísticas de conectividad.
 *
 * Es lógica pura (sin React ni vis-network) para poder probarla con node:test y
 * mantener el componente de la página dedicado solo a la presentación.
 */
import type { ConceptEdge, ConceptNode, GraphNodeType } from '../types/models.ts';

export interface GraphFilterOptions {
  /** Tipos de nodo visibles. */
  activeTypes: ReadonlySet<GraphNodeType>;
  /**
   * Tipos de relación visibles. `null` significa "todas"; un conjunto VACÍO no
   * muestra ninguna arista (el usuario ha ocultado todas).
   */
  activeRelations: ReadonlySet<string> | null;
  /** Nodo raíz del enfoque de vecindario; `null` desactiva el enfoque. */
  focusNodeId: string | null;
  /** Profundidad máxima de vecindad (≥ 1). Se ignora sin `focusNodeId`. */
  focusDepth: number;
}

/** Tipo de un nodo, con el valor por defecto histórico del grafo. */
export function nodeTypeOf(node: ConceptNode): GraphNodeType {
  return node.node_type || 'resource';
}

/**
 * IDs de los nodos alcanzables desde `rootId` en `depth` saltos o menos.
 *
 * `depth = 0` devuelve solo el nodo raíz. Si el raíz no existe en el grafo, el
 * conjunto es vacío (nunca se inventa un nodo).
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

/** Tipos de relación realmente presentes en las aristas, ordenados. */
export function availableRelationTypes(edges: readonly ConceptEdge[]): string[] {
  const set = new Set<string>();
  for (const edge of edges) {
    if (edge.connection_type) set.add(edge.connection_type);
  }
  return Array.from(set).sort();
}

/**
 * Aplica en orden: filtro por tipo de nodo, filtro por tipo de relación y
 * enfoque de vecindario. El resultado siempre deja aristas cuyos dos extremos
 * están visibles.
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

export interface ConnectivityStats {
  total: number;
  connected: number;
  isolated: number;
  /** IDs de nodos sin ninguna conexión (candidatos a organizar). */
  isolatedIds: string[];
}

/** Cuántos nodos tienen al menos una arista y cuántos están aislados. */
export function computeConnectivityStats(
  nodes: readonly ConceptNode[],
  edges: readonly ConceptEdge[]
): ConnectivityStats {
  const degree = new Map<string, number>();
  for (const node of nodes) degree.set(node.id, 0);
  for (const edge of edges) {
    if (degree.has(edge.source_id)) degree.set(edge.source_id, degree.get(edge.source_id)! + 1);
    if (degree.has(edge.target_id)) degree.set(edge.target_id, degree.get(edge.target_id)! + 1);
  }

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

/** Grado (nº de aristas incidentes) de cada nodo, contando cada extremo una vez. */
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

/**
 * Distingue dos cosas que la interfaz NUNCA debe confundir:
 *
 *  - `isolatedGlobally`: nodos sin ninguna relación en el grafo completo.
 *  - `apparentlyIsolated`: nodos que aparecen sin relaciones SOLO en la vista
 *    actual porque un filtro o el enfoque de vecindario oculta sus aristas.
 *
 * Sin esta distinción, filtrar por tipo hacía que un nodo pareciera desconectado
 * cuando en realidad estaba enlazado, y las estadísticas de conectividad mentían.
 * El cálculo de conectividad global sigue siendo honesto: se mide sobre el grafo
 * completo, no sobre la vista.
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

/* -------------------------------------------------------------------------- */
/* Analítica estructural del grafo                                             */
/* -------------------------------------------------------------------------- */

/** Entrada de ranking por número de conexiones. */
export interface GraphDegreeEntry {
  id: string;
  name: string;
  type: GraphNodeType;
  degree: number;
}

export interface GraphComponentStats {
  /** Nº de grupos desconectados entre sí (un nodo aislado es su propio grupo). */
  count: number;
  largestSize: number;
  /** Tamaños de mayor a menor, para dimensionar sin adivinar. */
  sizes: number[];
}

export interface GraphRecentEntry {
  id: string;
  name: string;
  type: GraphNodeType;
  /** Fecha de creación o actualización conocida (YYYY-MM-DD o ISO). */
  date: string;
}

export interface GraphAnalytics {
  totalNodes: number;
  totalEdges: number;
  connectedNodes: number;
  isolatedNodes: number;
  isolatedIds: string[];
  /** Recuento de nodos por tipo (tipos presentes solamente). */
  typeCounts: Partial<Record<GraphNodeType, number>>;
  /** Los nodos con MÁS CONEXIONES (etiqueta literal; nunca "los más importantes"). */
  topConnected: GraphDegreeEntry[];
  /** Umbral usado para considerar "grado inusualmente alto". */
  highDegreeThreshold: number;
  /** Nodos cuyo grado supera el umbral estadístico. */
  highDegree: GraphDegreeEntry[];
  /** Recursos, cursos y libros con 0 o 1 conexión: material poco integrado. */
  weakResources: GraphDegreeEntry[];
  components: GraphComponentStats;
  /** Elementos con fecha conocida, ordenados del más reciente al más antiguo. */
  recent: GraphRecentEntry[];
  /** false cuando ningún nodo expone fechas: no se inventa actividad reciente. */
  hasDateInfo: boolean;
}

const DEGREE_ENTRY_LIMIT = 5;
const WEAK_RESOURCE_LIMIT = 8;
const RECENT_LIMIT = 6;
const RESOURCE_TYPES: ReadonlySet<GraphNodeType> = new Set<GraphNodeType>(['resource', 'course', 'book']);

function degreeEntry(node: ConceptNode, degree: number): GraphDegreeEntry {
  return { id: node.id, name: node.name, type: nodeTypeOf(node), degree };
}

/** Tamaño de los grupos conexos (unión no dirigida) entre los nodos dados. */
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
 * Analítica ESTRUCTURAL del grafo: propiedades topológicas reales (grado,
 * conectividad, componentes, fechas). Nunca infiere dominio, inteligencia ni
 * importancia: `topConnected` es literalmente "los que más conexiones tienen".
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

  // Umbral de grado inusual: media + 2 desviaciones típicas, con suelo en 4
  // para no etiquetar como "inusual" un grafo minúsculo.
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
 * Frases ACCIONABLES y honestas sobre la analítica estructural. Cada frase es
 * un hecho verificable del grafo; ninguna convierte conexiones en importancia.
 */
export function buildGraphInsights(analytics: GraphAnalytics): string[] {
  if (analytics.totalNodes === 0) {
    return ['El grafo está vacío: todavía no hay nodos que analizar.'];
  }

  const insights: string[] = [];

  if (analytics.isolatedNodes > 0) {
    insights.push(
      analytics.isolatedNodes === 1
        ? '1 nodo no tiene ninguna relación.'
        : `${analytics.isolatedNodes} nodos no tienen ninguna relación.`
    );
  }

  if (analytics.components.count > 1) {
    insights.push(
      `El grafo tiene ${analytics.components.count} grupos sin conexión entre sí (el mayor reúne ${analytics.components.largestSize} nodos).`
    );
  }

  if (analytics.weakResources.length > 0) {
    insights.push(
      `${analytics.weakResources.length} ${analytics.weakResources.length === 1 ? 'recurso está poco conectado' : 'recursos están poco conectados'} (una sola conexión o ninguna).`
    );
  }

  const most = analytics.topConnected[0];
  if (most) {
    insights.push(`«${most.name}» es el nodo con más conexiones (${most.degree}).`);
  }

  if (analytics.highDegree.length > 0) {
    insights.push(
      `${analytics.highDegree.length} ${analytics.highDegree.length === 1 ? 'nodo tiene' : 'nodos tienen'} un número de conexiones inusualmente alto (grado ≥ ${analytics.highDegreeThreshold}).`
    );
  }

  if (analytics.recent.length > 0) {
    insights.push(`Actividad reciente: ${analytics.recent.length} elementos con cambios el ${analytics.recent[0].date} o después.`);
  }

  return insights;
}
