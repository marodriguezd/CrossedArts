import { dao } from '../../db/dao.ts';
import { localEmbeddingEngine, cosineSimilarity } from '../localEmbeddings/engine.ts';
import { embeddingCache, EMBEDDING_PIPELINE_VERSION } from '../localEmbeddings/cache.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../localEmbeddings/registry.ts';
import { buildCurrentChunkHashes } from '../localEmbeddings/corpus.ts';
import { localAiRuntime } from '../../services/localAiRuntime.ts';
import { isWithinScope, resolveScopeIds } from './scope.ts';
import { diversifyResults, DEFAULT_MAX_CHUNKS_PER_SOURCE } from './diversification.ts';
import { fuseRankedCandidates, type RankedSemanticMatch } from './fusion.ts';
import { THRESHOLDS } from './types.ts';
import type { RetrievedDocument, RetrievalResult, RetrievalScope } from './types.ts';

/**
 * Canonical local-retrieval types.
 *
 * They live in `types.ts` so retrieval, diversification, fusion, and context
 * packing share EXACTLY the same contract. They are only re-exported here,
 * keeping the historic import path (`localRag/retrieval.ts`) callers use.
 */
export type {
  RetrievedSourceType,
  RetrievedDocument,
  RetrievalResult,
  RetrievalScope
} from './types.ts';

/**
 * Normalize and tokenize a string for accent/case-insensitive lexical matching.
 */
export function tokenizeLexical(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2); // Significant words only (> 2 letters).
}

/**
 * Deterministic lexical-similarity score between a query and a target text.
 */
export function scoreLexicalRelevance(queryTokens: string[], targetText: string): number {
  if (!queryTokens.length || !targetText) return 0;
  const targetNormalized = targetText
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  let score = 0;
  for (const token of queryTokens) {
    if (targetNormalized.includes(token)) {
      score += 1.0;
      const regex = new RegExp(`\\b${token}\\b`, 'i');
      if (regex.test(targetNormalized)) {
        score += 1.5;
      }
    }
  }
  return score;
}

/**
 * A hit is substantive when query tokens appear in the artifact's CONTENT (not
 * just its title). Deterministic and conservative.
 */
function isSubstantiveMatch(queryTokens: string[], content: string | null | undefined): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  return scoreLexicalRelevance(queryTokens, text) > 0;
}

/**
 * Explicit, calibrated relevance thresholds.
 *
 * The contract lives in `types.ts` (single definition) and is re-exported here
 * to keep the historic import path.
 */
export { THRESHOLDS } from './types.ts';
// Fusion lives in `fusion.ts`; re-exported here because retrieval and its
// historic tests imported it from this module.
export { computeRrfScore, normalizeScore } from './fusion.ts';

/**
 * Cached-vector freshness contract: usable only when its `contentHash` matches
 * the material's current hash. A content change (e.g. editing a lesson) lazily
 * invalidates the old vector, without rebuilding the whole index or touching
 * unchanged chunks.
 */
export function isCachedVectorFresh(
  entry: { contentHash: string; pipelineVersion?: string },
  currentHash: string | undefined,
  pipelineVersion: string
): boolean {
  if (!currentHash) return false;
  if (entry.contentHash !== currentHash) return false;
  if (entry.pipelineVersion !== undefined && entry.pipelineVersion !== pipelineVersion) return false;
  return true;
}

/**
 * Canonical candidate diversification.
 *
 * A stable alias of the single policy (`diversification.ts`), which counts by
 * source BASE ID, not chunk id. The historic name stays because several callers
 * and tests import it from this module; the logic lives in one place.
 */
export function deduplicateAndDiversify(
  candidates: RetrievedDocument[],
  maxChunksPerSource: number = DEFAULT_MAX_CHUNKS_PER_SOURCE
): RetrievedDocument[] {
  return diversifyResults(candidates, { maxChunksPerSource });
}

/**
 * Retrieve relevant documents from the local CrossedArts SQLite database with a
 * HYBRID strategy (lexical + on-device-embedding semantic).
 */
export interface RetrievalOptions {
  /**
   * Request semantic retrieval when it adds value. Embedding warm-up and
   * missing-content indexing happen automatically; when impossible, lexical
   * retrieval stays intact.
   */
  semantic?: boolean;
}

export async function retrieveLocalContext(
  query: string,
  limit: number = 4,
  scope?: RetrievalScope,
  options?: RetrievalOptions
): Promise<RetrievalResult> {
  const emptyResult = (): RetrievalResult => ({
    documents: [],
    hasContext: false,
    totalCandidates: 0,
    diversifiedCandidates: 0,
    hasSubstantiveContext: false,
    modeUsed: 'lexical',
    retrievalMode: 'lexical'
  });

  const tokens = tokenizeLexical(query);
  if (!tokens.length) return emptyResult();

  let courses: any[] = [];
  let books: any[] = [];
  let notes: any[] = [];
  let flashcards: any[] = [];
  let graph: any = { nodes: [] };
  let practiceWork: any[] = [];
  let lessonIndex: Awaited<ReturnType<typeof dao.getLessonIndex>> = [];

  try {
    // Every source resolves in parallel with a FIXED query count. `getLessonIndex()`
    // replaces the N+1 pattern (`getCourseById()` per course, which also
    // re-scanned every resource).
    const results = await Promise.all([
      dao.getCourses(),
      dao.getBooks(),
      dao.getNotes(),
      dao.getFlashcards(),
      dao.getKnowledgeGraph(),
      dao.getLessonIndex(),
      dao.getAllPracticeWork()
    ]);
    courses = results[0];
    books = results[1];
    notes = results[2];
    flashcards = results[3];
    graph = results[4];
    lessonIndex = results[5];
    practiceWork = results[6];
  } catch {
    return emptyResult();
  }

  const lexicalCandidates: Map<string, RetrievedDocument> = new Map();

  // 1a. Courses (resource metadata, no hierarchy rebuild).
  for (const course of courses) {
    const courseText = `${course.title} ${course.description || ''} ${course.category}`;
    const score = scoreLexicalRelevance(tokens, courseText);
    if (score > 0) {
      lexicalCandidates.set(`course_${course.id}`, {
        id: course.id,
        sourceType: 'course',
        title: course.title,
        snippet: course.description ? `${course.description} (${course.category})` : `Curso: ${course.title} [${course.category}]`,
        score: score * 1.2,
        substantive: isSubstantiveMatch(tokens, course.description),
        path: [course.title],
        resourceId: course.id
      });
    }
  }

  // 1b. Lessons from the flat index (previously rebuilt course by course).
  // Scored text and snippet stay byte-identical to preserve the deterministic
  // ranking and per-source dedup.
  for (const entry of lessonIndex) {
    const lesText = `${entry.lessonTitle} ${entry.moduleTitle} ${entry.lessonContent || ''}`;
    const lScore = scoreLexicalRelevance(tokens, lesText);
    if (lScore > 0) {
      const snippetBase = `Módulo: ${entry.moduleTitle}. Lección: ${entry.lessonTitle}. Duración: ${entry.durationMinutes}m.`;
      const contentSnippet = (entry.lessonContent || '').trim();
      lexicalCandidates.set(`lesson_${entry.lessonId}`, {
        id: entry.lessonId,
        sourceType: 'lesson',
        title: `${entry.courseTitle} › ${entry.lessonTitle}`,
        snippet: contentSnippet ? `${snippetBase} Contenido: ${contentSnippet.slice(0, 240)}` : snippetBase,
        score: lScore,
        substantive: isSubstantiveMatch(tokens, entry.lessonContent),
        path: [entry.courseTitle, entry.moduleTitle, entry.lessonTitle],
        resourceId: entry.courseId,
        lessonId: entry.lessonId
      });
    }
  }

  // 2. Books
  for (const book of books) {
    const bookText = `${book.title} ${book.author || ''} ${book.description || ''} ${book.category}`;
    const score = scoreLexicalRelevance(tokens, bookText);
    if (score > 0) {
      lexicalCandidates.set(`book_${book.id}`, {
        id: book.id,
        sourceType: 'book',
        title: book.title,
        snippet: `Libro de ${book.author || 'Autor desconocido'}: ${book.title}. Progreso: ${book.reading_percentage}%.`,
        score,
        substantive: isSubstantiveMatch(tokens, book.description),
        path: [book.title],
        resourceId: book.id
      });
    }
  }

  // 3. Notes
  for (const note of notes) {
    const noteText = `${note.title} ${note.content}`;
    const score = scoreLexicalRelevance(tokens, noteText);
    if (score > 0) {
      let pageNum: number | undefined = undefined;
      if (note.tags) {
        const pageMatch = note.tags.match(/pág:(\d+)/i);
        if (pageMatch) pageNum = parseInt(pageMatch[1], 10);
      }

      lexicalCandidates.set(`note_${note.id}`, {
        id: note.id,
        sourceType: 'note',
        title: note.title,
        snippet: note.content.slice(0, 200) + (note.content.length > 200 ? '...' : ''),
        score: score * 1.3,
        substantive: isSubstantiveMatch(tokens, note.content),
        page: pageNum,
        resourceId: note.resource_id || undefined,
        lessonId: note.lesson_id || undefined
      });
    }
  }

  // 4. Flashcards SM-2
  for (const fc of flashcards) {
    const fcText = `${fc.front} ${fc.back}`;
    const score = scoreLexicalRelevance(tokens, fcText);
    if (score > 0) {
      lexicalCandidates.set(`flashcard_${fc.id}`, {
        id: fc.id,
        sourceType: 'flashcard',
        title: `Tarjeta: ${fc.front}`,
        snippet: `Anverso: ${fc.front} | Reverso: ${fc.back}`,
        score,
        // Front and back ARE the card content.
        substantive: true,
        resourceId: fc.resource_id || undefined,
        lessonId: fc.lesson_id || undefined
      });
    }
  }

  // 5. Graph concepts
  for (const node of graph.nodes) {
    const conceptText = `${node.name} ${node.description || ''}`;
    const score = scoreLexicalRelevance(tokens, conceptText);
    if (score > 0) {
      lexicalCandidates.set(`concept_${node.id}`, {
        id: node.id,
        sourceType: 'concept',
        title: `Concepto: ${node.name}`,
        snippet: node.description || `Concepto en el grafo: ${node.name}`,
        score,
        substantive: isSubstantiveMatch(tokens, node.description)
      });
    }
  }

  // 5b. Practice work: student-PRODUCED evidence. Retrieved by title,
  // description, content, and notes, keeping provenance to its resource/lesson
  // so scope can narrow it.
  for (const work of practiceWork) {
    const bodySource = [work.description, work.content, work.notes]
      .map((value: string | null | undefined) => (value || '').trim())
      .filter(Boolean)
      .join(' ');
    const workText = `${work.title} ${bodySource}`;
    const score = scoreLexicalRelevance(tokens, workText);
    if (score > 0) {
      lexicalCandidates.set(`practice_${work.id}`, {
        id: work.id,
        sourceType: 'practice',
        title: `Práctica: ${work.title}`,
        snippet: (bodySource || `Trabajo práctico: ${work.title}`).slice(0, 200),
        score: score * 1.1,
        substantive: isSubstantiveMatch(tokens, bodySource),
        resourceId: work.resource_id || undefined,
        lessonId: work.lesson_id || undefined
      });
    }
  }

  // 6. Semantic search over the vector cache (when engine/cache available).
  let semanticMatches: { chunkId: string; score: number; entry: any }[] = [];
  let isSemanticReady = localEmbeddingEngine.getStatus() === 'ready';

  // Auto-warm embeddings when semantic retrieval pays off. On slowness or
  // failure, degrade immediately to lexical SQLite retrieval.
  if (!isSemanticReady && options?.semantic) {
    try {
      const semanticPromise = localAiRuntime.ensureSemanticIndexReady();
      const timeoutPromise = new Promise<{ stage: string }>((r) =>
        setTimeout(() => r({ stage: 'timeout' }), 4000)
      );
      const semantic = await Promise.race([semanticPromise, timeoutPromise]);
      isSemanticReady = semantic.stage === 'ready' && localEmbeddingEngine.getStatus() === 'ready';
    } catch {
      isSemanticReady = false;
    }
  }

  if (isSemanticReady) {
    try {
      const modelId = localEmbeddingEngine.getLoadedModelId() || DEFAULT_EMBEDDING_MODEL_ID;
      // Query with the explicit query: prefix.
      const queryVector = await localEmbeddingEngine.embedText(query, true);
      const allCached = await embeddingCache.getAllEntriesForModel(modelId);

      if (allCached.length > 0) {
        // Semantic mode is only advertised once acceptable semantic hits exist.

        // Content-hash freshness (staleness) check: a cached vector is usable
        // only when its `contentHash` matches the material's CURRENT hash.
        // Editing lesson A thus invalidates its old vector (excluded from
        // retrieval) without rebuilding the whole index or touching lesson B
        // and other unchanged resources.
        const currentHashes = new Map<string, string>();
        try {
          // Reuse what this same retrieval already loaded: it used to rebuild
          // the whole library via getAllLearningResources(), re-querying
          // courses/modules and risking N+1 work.
          //
          // Content identity resolves through the canonical boundary (domain
          // entities -> KnowledgeDocument -> chunks) and the local manifest:
          // unchanged documents reuse their SHA-256, so a semantic query never
          // rehashes the whole library. Correctness does NOT depend on the
          // manifest: the returned hash always matches the current text.
          const lessonGroups = new Map<string, Map<string, any[]>>();
          for (const entry of lessonIndex) {
            if (!lessonGroups.has(entry.courseId)) lessonGroups.set(entry.courseId, new Map());
            const groups = lessonGroups.get(entry.courseId)!;
            if (!groups.has(entry.moduleTitle)) groups.set(entry.moduleTitle, []);
            groups.get(entry.moduleTitle)!.push({
              id: entry.lessonId,
              title: entry.lessonTitle,
              content: entry.lessonContent,
              duration_minutes: entry.durationMinutes
            });
          }

          const coursesForChunks = courses.map(course => ({
            ...course,
            modules: Array.from(lessonGroups.get(course.id)?.entries() || [])
              .sort((a, b) => a[0].localeCompare(b[0]))
              .map(([moduleTitle, lessons]) => ({
                id: `${course.id}::${moduleTitle}`,
                title: moduleTitle,
                lessons: lessons.sort((a, b) => a.id.localeCompare(b.id))
              }))
          }));

          const hashes = await buildCurrentChunkHashes({
            courses: coursesForChunks,
            books,
            notes,
            flashcards,
            concepts: graph.nodes,
            practiceWork
          }, modelId);
          for (const [chunkId, contentHash] of hashes) currentHashes.set(chunkId, contentHash);
        } catch {
          /* When hashes cannot be recomputed, potentially stale vectors go unused. */
        }

        for (const entry of allCached) {
          const expectedHash = currentHashes.get(entry.chunkId);
          // No known current hash (deleted or unhashable material): the vector
          // counts as stale and is excluded, never treated as fresh. The
          // expected version is the runtime's, never the entry's own: a
          // version-mismatched entry must expire even when it deems itself
          // fresh.
          if (!isCachedVectorFresh(entry, expectedHash, EMBEDDING_PIPELINE_VERSION)) {
            continue;
          }
          const sim = cosineSimilarity(queryVector, entry.vector);
          // Calibrated minimum semantic threshold.
          if (sim >= THRESHOLDS.MIN_SEMANTIC_SIMILARITY) {
            semanticMatches.push({ chunkId: entry.chunkId, score: sim, entry });
          }
        }
      }
    } catch (err) {
      console.warn('Fallback a recuperación léxica pura:', err);
    }
  }

  // FUSION (canonical implementation in `fusion.ts`): RRF as the primary signal,
  // normalized similarity as the quality tiebreak.
  const lexicalEligible = Array.from(lexicalCandidates.entries())
    .filter(([, cand]) => cand.score >= THRESHOLDS.MIN_LEXICAL_CANDIDATE)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const semanticRanked: RankedSemanticMatch[] = [...semanticMatches]
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));

  const fused = fuseRankedCandidates({
    lexicalCandidates,
    lexicalRanked: lexicalEligible.map(([key, doc]) => ({ key, doc })),
    semanticRanked
  });

  const allMerged = fused.candidates;
  const lexicalRankKeys = fused.lexicalRanks;
  const semanticRankKeys = fused.semanticRanks;

  // SCOPE CONTRACT (hard boundary): under a requested scope, only material
  // inside the resolved perimeter (anchors + connected graph nodes) may become
  // context. A high-scoring foreign document NEVER enters on score alone;
  // scopeless search stays global and intact.
  let scopeIds: Set<string> | null = null;
  if (scope && (scope.resourceId || scope.lessonId)) {
    scopeIds = await resolveScopeIds(scope);
  }

  // Final acceptance threshold.
  let filtered = allMerged.filter(c => c.score >= THRESHOLDS.MIN_FINAL_ACCEPTANCE);

  if (scopeIds) {
    filtered = filtered.filter(c => isWithinScope({ sourceId: c.id, resourceId: c.resourceId, lessonId: c.lessonId }, scopeIds!));
    for (const cand of filtered) {
      // Deterministic scope boost, only for candidates already inside the perimeter.
      cand.score = Math.min(1, cand.score + THRESHOLDS.SCOPE_BOOST);
    }
  }

  // Sort deterministically.
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  // Smart dedup (max 2 chunks per resource for diversity).
  const diversified = diversifyResults(filtered, { maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE });

  const selected = diversified.slice(0, Math.min(limit, 5));

  const finalMode: 'lexical' | 'hybrid' | 'semantic' =
    semanticRankKeys.size === 0 ? 'lexical' :
    lexicalRankKeys.size === 0 ? 'semantic' :
    'hybrid';

  // `totalCandidates` is the ACCEPTED candidate set before diversification;
  // `diversifiedCandidates` is what survives it. Each count stays faithful to
  // its phase.
  return {
    documents: selected,
    hasContext: selected.length > 0,
    totalCandidates: filtered.length,
    diversifiedCandidates: diversified.length,
    hasSubstantiveContext: selected.some((doc) => doc.substantive === true),
    modeUsed: finalMode,
    retrievalMode: finalMode
  };
}
