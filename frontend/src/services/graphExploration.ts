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
