import { domainEntitiesToKnowledgeDocuments } from '../../ai/knowledge/adapters.ts';
import type { DomainKnowledgeEntities } from '../../ai/knowledge/types.ts';
import {
  createSemanticChunksFromKnowledgeDocumentsAsync,
  type SemanticChunk
} from './chunking.ts';
import { semanticContentManifest } from './contentManifest.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from './registry.ts';
import { dbBridge } from '../../db/sqliteBridge.ts';

/**
 * Semantic-corpus construction.
 *
 * Canonical indexing boundary:
 *
 *   domain entities (DAO/SQLite)
 *     -> `KnowledgeDocument` (ai/knowledge/adapters.ts)
 *       -> bounded semantic chunking
 *         -> vectors (embeddings)
 *           -> retrieval
 *
 * Everything entering the semantic pipeline goes through `KnowledgeDocument`:
 * the only abstraction that knows provenance, hierarchy, and canonical text.
 * This module just orchestrates the two later steps (chunking + content
 * identity) without duplicating business rules.
 *
 * The text and fragment ids produced here are IDENTICAL to those the direct
 * chunking over domain entities produced: the adapters build exactly the same
 * headers and bodies. Changing the boundary therefore alters no retrieval
 * result and invalidates no already-cached vectors.
 */

export interface SemanticCorpusResult {
  /** Fragments with their content identity already resolved. */
  chunks: SemanticChunk[];
  /** Fragments whose SHA-256 was recomputed in this pass. */
  recomputedHashes: number;
  /** Fragments whose SHA-256 was reused from the manifest. */
  reusedHashes: number;
  /** Entries purged because the material left the corpus. */
  purgedHashes: number;
}

/**
 * Builds the full semantic corpus from domain entities.
 *
 * Content identity resolves through the local manifest: unchanged documents
 * reuse their SHA-256 and only modified ones recompute theirs, invalidating
 * just their own fragments.
 */
export async function buildSemanticCorpus(
  entities: DomainKnowledgeEntities,
  modelId: string = DEFAULT_EMBEDDING_MODEL_ID
): Promise<SemanticCorpusResult> {
  const documents = domainEntitiesToKnowledgeDocuments(entities);
  const chunks = await createSemanticChunksFromKnowledgeDocumentsAsync(documents);
  const resolved = await semanticContentManifest.resolveChunkHashes(chunks, modelId);
  return {
    chunks: resolved.chunks,
    recomputedHashes: resolved.recomputed,
    reusedHashes: resolved.reused,
    purgedHashes: resolved.purged
  };
}

/**
 * Memoized `chunkId -> contentHash` map, keyed by data revision + model.
 *
 * Rebuilding the whole corpus on EVERY semantic query (documents, chunking and
 * manifest resolution) was the dominant cost of retrieval. The map is derived
 * data, so it is invalidated whenever the database changes: `getDataRevision()`
 * advances on every persist, reload and import.
 */
let chunkHashMapCache: { key: string; map: Map<string, string> } | null = null;

/** Drops the memoized map (explicit invalidation for tests and callers). */
export function invalidateCurrentChunkHashes(): void {
  chunkHashMapCache = null;
}

/**
 * CURRENT `chunkId -> contentHash` map of the corpus, used to validate cached
 * vectors. A fragment missing from the map counts as stale.
 */
export async function buildCurrentChunkHashes(
  entities: DomainKnowledgeEntities,
  modelId: string = DEFAULT_EMBEDDING_MODEL_ID
): Promise<Map<string, string>> {
  const key = `${dbBridge.getDataRevision()}::${modelId}`;
  if (chunkHashMapCache && chunkHashMapCache.key === key) return chunkHashMapCache.map;

  const corpus = await buildSemanticCorpus(entities, modelId);
  const map = new Map(corpus.chunks.map(chunk => [chunk.chunkId, chunk.contentHash]));
  chunkHashMapCache = { key, map };
  return map;
}