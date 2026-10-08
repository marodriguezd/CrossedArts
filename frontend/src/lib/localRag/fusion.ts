import type { RetrievedDocument } from './types.ts';

/**
 * Fusión de resultados de recuperación.
 *
 * Este módulo contiene la ÚNICA implementación de fusión usada por la
 * recuperación de producción (`fuseRankedCandidates`). Se ofrece además
 * `fuseResults`, una API de conveniencia para llamantes que ya tienen listas de
 * documentos clasificados y solo necesitan combinarlas; no participa en el
 * pipeline de producción (ver `tests/rag_fusion_parity.test.ts`).
 */

export interface FusionOptions {
  lexicalWeight?: number;
  semanticWeight?: number;
  strategy?: 'weighted' | 'rrf';
  rrfK?: number;
}

/**
 * Reciprocal Rank Fusion (RRF) combinada con puntuación ponderada.
 * RRF(d) = sum( 1 / (k + rank_i) ) donde k = 60 estándar.
 *
 * Función pura y determinista: sin rangos nulos no hay señal.
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
 * Normaliza un valor a un rango [0, 1] dado un valor máximo.
 */
export function normalizeScore(val: number, maxVal: number): number {
  if (maxVal <= 0) return 0;
  return Math.min(Math.max(val / maxVal, 0), 1);
}

/** Coincidencia semántica aceptada: id de fragmento, similitud y su entrada de caché. */
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

/** Pesos por defecto de la fusión de producción. RRF domina; las señales de
 *  calidad solo desempatan. */
export const DEFAULT_FUSION_WEIGHTS = {
  lexical: 0.25,
  semantic: 0.25,
  rrf: 0.5
} as const;

/**
 * FUSIÓN DE PRODUCCIÓN.
 *
 * Combina los candidatos léxicos y semánticos por clave de fragmento:
 *
 *  score = 0.25 * scoreLéxicoNormalizado
 *        + 0.25 * similitudSemántica
 *        + 0.50 * RRF normalizado
 *
 * Se conserva además una señal normalizada de similitud para desempatar por
 * calidad entre candidatos con la misma posición de fusión. El RRF aporta la
 * evidencia de rango (un documento encontrado por ambos canales sube); las
 * señales crudas solo afinan. El orden de iteración y el desempate por clave son
 * deterministas.
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
          // Un acierto semántico es, por definición, una coincidencia de contenido.
          substantive: true,
          // Procedencia mínima que el chunk SÍ conserva: el artefacto de origen.
          // La ruta completa solo existe si la recuperación léxica la aportó.
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
 * Fusiona listas de documentos ya clasificados por canal mediante ponderación
 * calibrada o RRF puro. El desempate es determinista (puntuación y luego id).
 *
 * API de conveniencia: NO es el camino de producción. Existe para reutilización
 * externa; su equivalencia de RANKING con `fuseRankedCandidates` está verificada
 * en `tests/rag_fusion_parity.test.ts`.
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

  // Ponderación estándar calibrada
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
      // Documento encontrado por ambos métodos: combinar puntuación y marcar como híbrido
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