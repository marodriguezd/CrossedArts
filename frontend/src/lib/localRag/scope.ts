import { dao } from '../../db/dao.ts';
import type { RetrievalScope } from './types.ts';

/**
 * Resuelve el conjunto de IDs que pertenecen al ámbito solicitado.
 *
 * Lección -> la propia lección, su curso y sus nodos conectados.
 * Recurso -> el recurso y sus nodos conectados (módulos, lecciones, notas).
 * La conexión explícita del grafo permite contexto relacionado DENTRO del
 * perímetro declarado por el usuario; nunca material arbitrario externo.
 */
export async function resolveScopeIds(scope: RetrievalScope): Promise<Set<string>> {
  const anchor = scope.lessonId || scope.resourceId;
  if (!anchor) return new Set();
  const scopeIds = new Set<string>([anchor]);

  if (scope.resourceId) {
    scopeIds.add(scope.resourceId);
  }
  if (scope.lessonId) {
    scopeIds.add(scope.lessonId);
  }

  // Resolver conexiones en el grafo de conocimiento
  try {
    for (const relatedId of await dao.getRelatedNodeIds(anchor)) {
      scopeIds.add(relatedId);
    }
  } catch {
    /* Si el grafo no está disponible, el ámbito se reduce a los anclas. */
  }

  return scopeIds;
}

/**
 * Evalúa si un fragmento o documento pertenece al conjunto de IDs del ámbito.
 */
export function isWithinScope(
  candidate: { sourceId: string; resourceId?: string; lessonId?: string },
  scopeIds: Set<string>
): boolean {
  if (scopeIds.size === 0) return true;
  if (scopeIds.has(candidate.sourceId)) return true;
  if (candidate.resourceId && scopeIds.has(candidate.resourceId)) return true;
  if (candidate.lessonId && scopeIds.has(candidate.lessonId)) return true;
  return false;
}
