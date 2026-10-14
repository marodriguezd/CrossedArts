import type { RetrievedDocument } from './types.ts';

/**
 * Retrieval-result fusion.
 *
 * This module holds the ONLY fusion implementation used by production support
 * (`fuseRankedCandidates`). It also offers `fuseResults`, a convenience API for
 * callers that already have ranked document lists and only need to combine
 * them; it takes no part in the production pipeline (see
 * `tests/rag_fusion_parity.test.ts`).
 */

export interface FusionOptions {
  lexicalWeight?: number;
  semanticWeight?: number;
  strategy?: 'weighted' | 'rrf';
  rrfK?: number;
}

/**
 * Reciprocal Rank Fusion (RRF) combined with weighted scoring.
 * RRF(d) = sum( 1 / (k + rank_i) ) where k = 60 by standard.
 *
 * Pure, deterministic function: with null ranks there is no signal.
 */
export function computeRrfScore(rankLexical: number | null, rankSemantic: number | null, k: number = 60): number {
  let score = 0;
  if (rankLexical !== null && rankLexical >= 0) {
    score += 1.0 / (k + rankLexical + 1);
  }
  if (rankSemantic !== null && rankSemantic >= 0) {
    score += 1.0 / (k + rankSemantic + 1);
  }
  return score;
}

/**
 * Normalizes a value to the [0, 1] range given a maximum value.
 */
export function normalizeScore(val: number, maxVal: number): number {
  if (maxVal <= 0) return 0;
  return Math.min(Math.max(val / maxVal, 0), 1);
}

/** Accepted semantic match: chunk id, similarity, and its cache entry. */
export interface RankedSemanticMatch {
  chunkId: string;
  score: number;
  entry: {
    sourceId: string;
    sourceType: string;
    title: string;
    text: string;
    page?: number;
    chapter?: string;
  };
}

export interface FusedCandidate extends RetrievedDocument {
  chunkKey: string;
}

/** Default production-fusion weights. RRF dominates; quality signals only
 *  break ties. */
export const DEFAULT_FUSION_WEIGHTS = {
  lexical: 0.25,
  semantic: 0.25,
  rrf: 0.5
} as const;

/**
 * PRODUCTION FUSION.
 *
 * Combines lexical and semantic candidates by chunk key:
 *
 *  score = 0.25 * normalizedLexicalScore
 *        + 0.25 * semanticSimilarity
 *        + 0.50 * normalized RRF
 *
 * A normalized similarity signal is also kept to break quality ties between
 * candidates sharing a fusion position. RRF supplies the rank evidence (a
 * document found by both channels rises); raw signals only refine. Iteration
 * order and key tiebreaks are deterministic.
 */
export function fuseRankedCandidates(input: {
  lexicalCandidates: Map<string, RetrievedDocument>;
  lexicalRanked: Array<{ key: string; doc: RetrievedDocument }>;
  semanticRanked: RankedSemanticMatch[];
  weights?: { lexical?: number; semantic?: number; rrf?: number };
}): { candidates: FusedCandidate[]; semanticRanks: Set<string>; lexicalRanks: Set<string> } {
  const weights = { ...DEFAULT_FUSION_WEIGHTS, ...(input.weights || {}) };
  const { lexicalCandidates, lexicalRanked, semanticRanked } = input;

  const mergedMap = new Map<string, FusedCandidate>();
  const maxLexical = Math.max(...Array.from(lexicalCandidates.values()).map(c => c.score), 1);
  const semanticById = new Map(semanticRanked.map(item => [item.chunkId, item]));

  const lexicalRanks = new Map<string, number>();
  for (let i = 0; i < lexicalRanked.length; i++) lexicalRanks.set(lexicalRanked[i].key, i);

  const semanticRanks = new Map<string, number>();
  for (let i = 0; i < semanticRanked.length; i++) semanticRanks.set(semanticRanked[i].chunkId, i);

  const maxRrf = computeRrfScore(0, 0);

  for (const key of new Set([...lexicalRanks.keys(), ...semanticRanks.keys()])) {
    const lexical = lexicalCandidates.get(key);
    const semantic = semanticById.get(key);
    const lexScore = lexical ? normalizeScore(lexical.score, maxLexical) : 0;
    const semScore = semantic ? Math.min(Math.max(semantic.score, 0), 1) : 0;
    const rrf = computeRrfScore(lexicalRanks.get(key) ?? null, semanticRanks.get(key) ?? null);
    const rrfNormalized = maxRrf > 0 ? rrf / maxRrf : 0;

    const base: RetrievedDocument = lexical
      ? { ...lexical }
      : {
          id: semantic!.entry.sourceId,
          sourceType: semantic!.entry.sourceType as RetrievedDocument['sourceType'],
          title: semantic!.entry.title,
          snippet: semantic!.entry.text.slice(0, 200),
          score: semScore,
          retrievalMode: 'semantic',
          // A semantic hit is, by definition, a content match.
          substantive: true,
          // Minimal provenance the chunk DOES keep: the origin artifact. The
          // full path only exists when lexical retrieval supplied it.
          ...(semantic!.entry.sourceType === 'lesson' ? { lessonId: semantic!.entry.sourceId } : {}),
          ...(semantic!.entry.sourceType === 'course' || semantic!.entry.sourceType === 'book'
            ? { resourceId: semantic!.entry.sourceId, path: [semantic!.entry.title] }
            : {}),
          ...(typeof semantic!.entry.page === 'number' ? { page: semantic!.entry.page } : {}),
          ...(typeof semantic!.entry.chapter === 'string' ? { chapter: semantic!.entry.chapter } : {})
        };

    const hasLexical = lexicalRanks.has(key);
    const hasSemantic = semanticRanks.has(key);
    base.score =
      (lexScore * weights.lexical) +
      (semScore * weights.semantic) +
      (rrfNormalized * weights.rrf);
    base.retrievalMode = hasLexical && hasSemantic
      ? 'hybrid'
      : hasSemantic
        ? 'semantic'
        : 'lexical';

    mergedMap.set(key, { ...base, chunkKey: key });
  }

  return {
    candidates: Array.from(mergedMap.values()),
    lexicalRanks: new Set(lexicalRanks.keys()),
    semanticRanks: new Set(semanticRanks.keys())
  };
}

/**
 * Fuses already per-channel ranked document lists via calibrated weighting or
 * pure RRF. Tiebreaks are deterministic (score, then id).
 *
 * Convenience API: NOT the production path. It exists for external reuse; its
 * RANKING equivalence with `fuseRankedCandidates` is verified in
 * `tests/rag_fusion_parity.test.ts`.
 */
export function fuseResults(
  lexicalDocs: RetrievedDocument[],
  semanticDocs: RetrievedDocument[],
  options: FusionOptions = {}
): RetrievedDocument[] {
  const strategy = options.strategy || 'weighted';
  const fusedMap = new Map<string, RetrievedDocument>();

  if (strategy === 'rrf') {
    const k = options.rrfK || 60;
    const rrfScores = new Map<string, number>();

    lexicalDocs.forEach((doc, rank) => {
      const current = rrfScores.get(doc.id) || 0;
      rrfScores.set(doc.id, current + 1 / (k + rank + 1));
      fusedMap.set(doc.id, { ...doc, retrievalMode: 'hybrid' });
    });

    semanticDocs.forEach((doc, rank) => {
      const current = rrfScores.get(doc.id) || 0;
      rrfScores.set(doc.id, current + 1 / (k + rank + 1));
      if (!fusedMap.has(doc.id)) {
        fusedMap.set(doc.id, { ...doc, retrievalMode: 'hybrid' });
      }
    });

    const results = Array.from(fusedMap.values()).map(doc => ({
      ...doc,
      score: rrfScores.get(doc.id) || doc.score
    }));

    return results.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  }

  // Calibrated standard weighting
  const lexWeight = options.lexicalWeight ?? 0.45;
  const semWeight = options.semanticWeight ?? 0.55;

  for (const doc of lexicalDocs) {
    fusedMap.set(doc.id, {
      ...doc,
      score: doc.score * lexWeight,
      retrievalMode: 'lexical'
    });
  }

  for (const doc of semanticDocs) {
    const existing = fusedMap.get(doc.id);
    if (existing) {
      // Document found by both methods: combine scores and mark as hybrid
      existing.score += doc.score * semWeight;
      existing.retrievalMode = 'hybrid';
      existing.substantive = existing.substantive || doc.substantive;
      if (!existing.snippet && doc.snippet) existing.snippet = doc.snippet;
      if (!existing.path && doc.path) existing.path = doc.path;
      if (!existing.resourceId && doc.resourceId) existing.resourceId = doc.resourceId;
      if (!existing.lessonId && doc.lessonId) existing.lessonId = doc.lessonId;
    } else {
      fusedMap.set(doc.id, {
        ...doc,
        score: doc.score * semWeight,
        retrievalMode: 'semantic'
      });
    }
  }

  return Array.from(fusedMap.values()).sort(
    (a, b) => b.score - a.score || a.id.localeCompare(b.id)
  );
}