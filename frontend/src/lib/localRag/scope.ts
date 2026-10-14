import { dao } from '../../db/dao.ts';
import type { RetrievalScope } from './types.ts';

/**
 * Resolves the set of ids that belong to the requested scope.
 *
 * Lesson -> the lesson itself, its course, and its connected nodes.
 * Resource -> the resource and its connected nodes (modules, lessons, notes).
 * Graph edges allow related context WITHIN the user-declared perimeter; never
 * arbitrary external material.
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

  try {
    for (const relatedId of await dao.getRelatedNodeIds(anchor)) {
      scopeIds.add(relatedId);
    }
  } catch {
    /* If the graph is unavailable, the scope shrinks to the anchors. */
  }

  return scopeIds;
}

/**
 * Checks whether a fragment or document belongs to the scope's id set.
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
