import type { RetrievedDocument } from './types.ts';

/**
 * Canonical source-diversification policy.
 *
 * This module is the ONLY diversification implementation in the RAG pipeline:
 * production retrieval consumes it directly, so no second parallel policy can
 * contradict the maximum chunks per source.
 */

/** Max chunks a single source may contribute to one result. */
export const DEFAULT_MAX_CHUNKS_PER_SOURCE = 2;

export interface DiversificationPolicy {
  maxChunksPerSource?: number;
  /**
   * Optional cap on total results. When omitted NO truncation happens: trimming
   * to `limit` belongs to retrieval, not to the diversity policy.
   */
  maxTotalResults?: number;
}

/** Part suffix produced by semantic chunking (`..._p2`, `..._p3`, ...). */
const CHUNK_PART_SUFFIX = /_p\d+$/;

/**
 * BASE source id: the real artifact the chunk belongs to.
 *
 * It is the key that enforces "at most N chunks per source". Counting by chunk
 * id would let one long lesson (`lesson_abc`, `lesson_abc_p2`, `lesson_abc_p3`)
 * monopolize the whole result, because each part is a distinct id.
 *
 * The retrieval document id IS the source artifact id (`sourceId` of the
 * semantic chunk; note/resource/flashcard id on the lexical path); the `_pN`
 * suffix only appears when semantic chunking split a long artifact.
 *
 * `lessonId` and `resourceId` are NOT used as the key: they are OWNING
 * artifacts, not the chunk's source. Using them would collapse a lesson and all
 * its notes, or every lesson of a course, into a single source — the exact
 * opposite of diversifying.
 */
export function resolveBaseSourceKey(
  doc: Pick<RetrievedDocument, 'id'> & { chunkKey?: string }
): string {
  // `id` is the source artifact id in production; `chunkKey` (semantic chunk
  // id) is only an explicit fallback.
  const raw = String(doc.id ?? doc.chunkKey ?? '');
  return raw.replace(CHUNK_PART_SUFFIX, '');
}

/**
 * Applies deterministic diversification to candidate documents: at most
 * `maxChunksPerSource` chunks per base source. Preserves input order (already
 * sorted by score with stable tiebreaks), so the operation is reproducible.
 */
export function diversifyResults(
  documents: RetrievedDocument[],
  policy: DiversificationPolicy = {}
): RetrievedDocument[] {
  const maxPerSource = Math.max(1, policy.maxChunksPerSource ?? DEFAULT_MAX_CHUNKS_PER_SOURCE);
  const maxTotal = policy.maxTotalResults ?? Number.POSITIVE_INFINITY;

  const sourceCount = new Map<string, number>();
  const diversified: RetrievedDocument[] = [];

  for (const doc of documents) {
    const baseSourceKey = resolveBaseSourceKey(doc);
    const currentCount = sourceCount.get(baseSourceKey) || 0;

    if (currentCount < maxPerSource) {
      diversified.push(doc);
      sourceCount.set(baseSourceKey, currentCount + 1);
    }

    if (diversified.length >= maxTotal) {
      break;
    }
  }

  return diversified;
}