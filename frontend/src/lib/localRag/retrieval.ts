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
 * Closed-class Spanish function words (articles, prepositions, conjunctions,
 * pronouns/quantifiers and auxiliaries), already normalized like
 * `tokenizeLexical` output: lowercase and accent-free.
 *
 * They are a LEXICAL resource, not a heuristic: a corpus cannot reveal that
 * «sin» is grammatical when it appears in one of 45 documents. Measured on the
 * demo library with pure IDF weights, «sin bloquear a los escritores» made the
 * SQLite WAL card rank 3rd for «¿…horas sin perder el hilo?», and the
 * «como»+«una» React lesson 2nd. The list decides WHAT is a candidate; IDF
 * decides how much each surviving content term weighs.
 */
const SPANISH_FUNCTION_WORDS = new Set<string>([
  // Articles and contractions (the 1–2 letter ones already fail the length filter).
  'una', 'unas', 'unos', 'los', 'las', 'del',
  // Prepositions.
  'ante', 'bajo', 'con', 'contra', 'desde', 'durante', 'entre', 'hacia', 'hasta',
  'mediante', 'para', 'por', 'segun', 'sin', 'sobre', 'tras', 'via',
  // Conjunctions and relatives.
  'que', 'como', 'cuando', 'donde', 'mientras', 'aunque', 'porque', 'pues', 'pero',
  'sino', 'tanto', 'cuanto', 'cual', 'cuales', 'quien', 'quienes', 'cuyo', 'cuya',
  // Pronouns, determiners and quantifiers.
  'este', 'esta', 'estos', 'estas', 'ese', 'esa', 'esos', 'esas', 'aquel', 'aquella',
  'ellos', 'ellas', 'nosotros', 'vosotros', 'usted', 'ustedes', 'todo', 'toda',
  'todos', 'todas', 'otro', 'otra', 'otros', 'otras', 'mismo', 'misma', 'cada',
  'algun', 'alguna', 'algunos', 'algunas', 'ningun', 'ninguna', 'nada', 'algo',
  'muy', 'mas', 'menos', 'tan', 'tambien', 'aqui', 'alli', 'ahora',
  // Auxiliaries: ser / estar / haber / tener / poder / deber / hacer.
  'ser', 'son', 'era', 'eran', 'fue', 'fueron', 'sea', 'sean', 'sido', 'siendo',
  // «estado» queda fuera a propósito: como sustantivo («estado de la materia»)
  // es contenido, y perderlo cuesta más recuerdo que el ruido que añade.
  'estoy', 'estas', 'estamos', 'estan', 'estaba', 'estaban', 'estuvo',
  'he', 'has', 'hemos', 'han', 'hay', 'habia', 'habian', 'hubo', 'haber',
  'tiene', 'tienen', 'tengo', 'tienes', 'tenemos', 'tenia', 'tenian', 'tener',
  'puedo', 'puedes', 'puede', 'pueden', 'podemos', 'podia', 'podian', 'poder',
  'debo', 'debe', 'deben', 'deberia', 'deberian', 'hace', 'hacen', 'hacer', 'hizo'
]);

/**
 * Query tokenization for retrieval: content words only.
 *
 * `tokenizeLexical` stays untouched because `checkGrounding` calibrates its
 * threshold on that raw tokenization; only candidate selection filters here.
 *
 * When the query is made EXCLUSIVELY of function words (e.g. «¿cómo es?»)
 * there is no content signal, so the raw tokens are returned rather than an
 * empty list: the caller then scores them with IDF exactly as before instead
 * of losing the query.
 */
export function tokenizeQuery(text: string): string[] {
  const tokens = tokenizeLexical(text);
  const contentTokens = tokens.filter(token => !SPANISH_FUNCTION_WORDS.has(token));
  return contentTokens.length > 0 ? contentTokens : tokens;
}

/**
 * Accent- and case-insensitive form of a text, shared by scoring and document
 * frequency so both compare EXACTLY the same characters.
 */
function normalizeForMatch(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Whole-word regexes for query tokens, compiled ONCE per token.
 *
 * They used to be built inside the double loop (token x document), so one query
 * over 5k documents compiled tens of thousands of identical `RegExp` objects.
 * The cache is bounded because query tokens are user input.
 */
const WORD_REGEX_CACHE = new Map<string, RegExp>();
const WORD_REGEX_CACHE_MAX = 512;

function wordBoundaryRegex(token: string): RegExp {
  const cached = WORD_REGEX_CACHE.get(token);
  if (cached) return cached;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`\\b${escaped}\\b`, 'i');
  if (WORD_REGEX_CACHE.size >= WORD_REGEX_CACHE_MAX) {
    const oldest = WORD_REGEX_CACHE.keys().next();
    if (!oldest.done) WORD_REGEX_CACHE.delete(oldest.value);
  }
  WORD_REGEX_CACHE.set(token, regex);
  return regex;
}

/**
 * IDF weight per query token, computed over the documents of THIS retrieval.
 *
 * Raw hit counting made a single article decisive: `scoreLexicalRelevance`
 * awards 2.5 points for a whole-word hit, so «como» + «una» scored 5.0 against a
 * React lesson and pushed it above the genuinely relevant material in fusion.
 * A frequency-based weight fixes that without a hard-coded word list: a term
 * present in most documents (a function word) weighs close to zero, a rare term
 * (the content word the question is about) weighs the most.
 *
 * BM25 IDF: `ln(1 + (N - df + 0.5) / (df + 0.5))`, always positive, so the
 * weight never erases a hit — it only ranks it. Deterministic: `df` comes from
 * the caller's fixed document order and `N` from the document count.
 */
export function computeLexicalIdf(
  queryTokens: string[],
  documents: Array<{ text: string }>
): Map<string, number> {
  const weights = new Map<string, number>();
  if (!queryTokens.length || documents.length === 0) return weights;

  const normalizedDocs = documents.map(doc => normalizeForMatch(doc.text || ''));
  const total = normalizedDocs.length;

  for (const token of queryTokens) {
    let frequency = 0;
    for (const doc of normalizedDocs) {
      if (doc.includes(token)) frequency++;
    }
    weights.set(token, Math.log(1 + (total - frequency + 0.5) / (frequency + 0.5)));
  }
  return weights;
}

/**
 * Deterministic lexical-similarity score between a query and a target text.
 *
 * With `weights` (from `computeLexicalIdf`) each hit counts by term rarity;
 * without them every hit counts 1.0 (+1.5 for a whole word), the historic
 * unweighted scale callers and tests still rely on.
 */
export function scoreLexicalRelevance(
  queryTokens: string[],
  targetText: string,
  weights?: ReadonlyMap<string, number>
): number {
  if (!queryTokens.length || !targetText) return 0;
  const targetNormalized = normalizeForMatch(targetText);

  let score = 0;
  for (const token of queryTokens) {
    const weight = weights?.get(token) ?? 1;
    if (targetNormalized.includes(token)) {
      score += 1.0 * weight;
      if (wordBoundaryRegex(token).test(targetNormalized)) {
        score += 1.5 * weight;
      }
    }
  }
  return score;
}

/**
 * A hit is substantive when query tokens appear in the artifact's CONTENT (not
 * just its title). Deterministic and conservative.
 */
function isSubstantiveMatch(
  queryTokens: string[],
  content: string | null | undefined,
  weights?: ReadonlyMap<string, number>
): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  return scoreLexicalRelevance(queryTokens, text, weights) > 0;
}

/**
 * Meaningful body of a practice-work item: description, content and notes.
 * Shared by the scored text and the IDF document collection so both weigh the
 * same words.
 */
function buildPracticeBody(work: {
  description?: string | null;
  content?: string | null;
  notes?: string | null;
}): string {
  return [work.description, work.content, work.notes]
    .map((value: string | null | undefined) => (value || '').trim())
    .filter(Boolean)
    .join(' ');
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

/**
 * Retrieval mode of a RESULT, derived from the documents actually returned.
 *
 * It used to be derived from the candidate channels: a semantic channel whose
 * candidates were all filtered out by scope or by the acceptance threshold made
 * a purely lexical answer advertise itself as "hybrid". The drawer renders this
 * value as a badge next to the citations, so it must describe the sources the
 * user actually sees.
 */
export function describeRetrievalMode(
  documents: Array<Pick<RetrievedDocument, 'retrievalMode'>>
): RetrievalResult['retrievalMode'] {
  let hasLexical = false;
  let hasSemantic = false;
  for (const doc of documents) {
    const mode = doc.retrievalMode ?? 'lexical';
    if (mode === 'hybrid') return 'hybrid';
    if (mode === 'semantic') hasSemantic = true;
    else hasLexical = true;
  }
  if (hasSemantic) return hasLexical ? 'hybrid' : 'semantic';
  return 'lexical';
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

  const tokens = tokenizeQuery(query);
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

  /**
   * Document collection of THIS retrieval, used only to weight terms by rarity.
   * Same texts the loops below score, in the same fixed order, so `df` is
   * deterministic and needs no persisted statistics.
   */
  const lexicalWeights = computeLexicalIdf(tokens, [
    ...courses.map(course => ({ text: `${course.title} ${course.description || ''} ${course.category}` })),
    ...lessonIndex.map(entry => ({ text: `${entry.lessonTitle} ${entry.moduleTitle} ${entry.lessonContent || ''}` })),
    ...books.map(book => ({ text: `${book.title} ${book.author || ''} ${book.description || ''} ${book.category}` })),
    ...notes.map(note => ({ text: `${note.title} ${note.content || ''}` })),
    ...flashcards.map(fc => ({ text: `${fc.front} ${fc.back}` })),
    ...graph.nodes.map((node: any) => ({ text: `${node.name} ${node.description || ''}` })),
    ...practiceWork.map((work: any) => ({ text: `${work.title} ${buildPracticeBody(work)}` }))
  ]);

  const lexicalCandidates: Map<string, RetrievedDocument> = new Map();

  // 1a. Courses (resource metadata, no hierarchy rebuild).
  for (const course of courses) {
    const courseText = `${course.title} ${course.description || ''} ${course.category}`;
    const score = scoreLexicalRelevance(tokens, courseText, lexicalWeights);
    if (score > 0) {
      lexicalCandidates.set(`course_${course.id}`, {
        id: course.id,
        sourceType: 'course',
        title: course.title,
        snippet: course.description ? `${course.description} (${course.category})` : `Curso: ${course.title} [${course.category}]`,
        score: score * 1.2,
        substantive: isSubstantiveMatch(tokens, course.description, lexicalWeights),
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
    const lScore = scoreLexicalRelevance(tokens, lesText, lexicalWeights);
    if (lScore > 0) {
      const snippetBase = `Módulo: ${entry.moduleTitle}. Lección: ${entry.lessonTitle}. Duración: ${entry.durationMinutes}m.`;
      const contentSnippet = (entry.lessonContent || '').trim();
      lexicalCandidates.set(`lesson_${entry.lessonId}`, {
        id: entry.lessonId,
        sourceType: 'lesson',
        title: `${entry.courseTitle} › ${entry.lessonTitle}`,
        snippet: contentSnippet ? `${snippetBase} Contenido: ${contentSnippet.slice(0, 240)}` : snippetBase,
        score: lScore,
        substantive: isSubstantiveMatch(tokens, entry.lessonContent, lexicalWeights),
        path: [entry.courseTitle, entry.moduleTitle, entry.lessonTitle],
        resourceId: entry.courseId,
        lessonId: entry.lessonId
      });
    }
  }

  // 2. Books
  for (const book of books) {
    const bookText = `${book.title} ${book.author || ''} ${book.description || ''} ${book.category}`;
    const score = scoreLexicalRelevance(tokens, bookText, lexicalWeights);
    if (score > 0) {
      lexicalCandidates.set(`book_${book.id}`, {
        id: book.id,
        sourceType: 'book',
        title: book.title,
        snippet: `Libro de ${book.author || 'Autor desconocido'}: ${book.title}. Progreso: ${book.reading_percentage}%.`,
        score,
        substantive: isSubstantiveMatch(tokens, book.description, lexicalWeights),
        path: [book.title],
        resourceId: book.id
      });
    }
  }

  // 3. Notes — `content` is nullable in the schema (a note may only have tags).
  for (const note of notes) {
    const noteContent = note.content || '';
    const noteText = `${note.title} ${noteContent}`;
    const score = scoreLexicalRelevance(tokens, noteText, lexicalWeights);
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
        snippet: noteContent.slice(0, 200) + (noteContent.length > 200 ? '...' : ''),
        score: score * 1.3,
        substantive: isSubstantiveMatch(tokens, noteContent, lexicalWeights),
        page: pageNum,
        resourceId: note.resource_id || undefined,
        lessonId: note.lesson_id || undefined
      });
    }
  }

  // 4. Flashcards SM-2
  for (const fc of flashcards) {
    const fcText = `${fc.front} ${fc.back}`;
    const score = scoreLexicalRelevance(tokens, fcText, lexicalWeights);
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
    const score = scoreLexicalRelevance(tokens, conceptText, lexicalWeights);
    if (score > 0) {
      lexicalCandidates.set(`concept_${node.id}`, {
        id: node.id,
        sourceType: 'concept',
        title: `Concepto: ${node.name}`,
        snippet: node.description || `Concepto en el grafo: ${node.name}`,
        score,
        substantive: isSubstantiveMatch(tokens, node.description, lexicalWeights)
      });
    }
  }

  // 5b. Practice work: student-PRODUCED evidence. Retrieved by title,
  // description, content, and notes, keeping provenance to its resource/lesson
  // so scope can narrow it.
  for (const work of practiceWork) {
    const bodySource = buildPracticeBody(work);
    const workText = `${work.title} ${bodySource}`;
    const score = scoreLexicalRelevance(tokens, workText, lexicalWeights);
    if (score > 0) {
      lexicalCandidates.set(`practice_${work.id}`, {
        id: work.id,
        sourceType: 'practice',
        title: `Práctica: ${work.title}`,
        snippet: (bodySource || `Trabajo práctico: ${work.title}`).slice(0, 200),
        score: score * 1.1,
        substantive: isSubstantiveMatch(tokens, bodySource, lexicalWeights),
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

  const finalMode = describeRetrievalMode(selected);

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
