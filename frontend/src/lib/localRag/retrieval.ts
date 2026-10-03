import { dao } from '../../db/dao.ts';
import { localEmbeddingEngine, cosineSimilarity } from '../localEmbeddings/engine.ts';
import { embeddingCache } from '../localEmbeddings/cache.ts';
import { createSemanticChunksFromResourcesAsync } from '../localEmbeddings/chunking.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../localEmbeddings/registry.ts';

export interface RetrievedDocument {
  id: string;
  sourceType: 'course' | 'lesson' | 'book' | 'note' | 'flashcard' | 'concept';
  title: string;
  snippet: string;
  score: number;
  retrievalMode?: 'lexical' | 'semantic' | 'hybrid';
  page?: number;
  chapter?: string;
}

export interface RetrievalResult {
  documents: RetrievedDocument[];
  hasContext: boolean;
  totalCandidates: number;
  modeUsed: 'lexical' | 'hybrid';
  retrievalMode: 'lexical' | 'hybrid';
}

/**
 * Normaliza y tokeniza una cadena de texto para comparación léxica sin acentos ni mayúsculas.
 */
export function tokenizeLexical(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(token => token.length > 2); // Palabras significativas de > 2 letras
}

/**
 * Calcula una puntuación de similitud léxica determinista entre una consulta y un texto objetivo.
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
 * Normaliza un valor a un rango [0, 1] dado un valor máximo.
 */
export function normalizeScore(val: number, maxVal: number): number {
  if (maxVal <= 0) return 0;
  return Math.min(Math.max(val / maxVal, 0), 1);
}

// Umbrales de relevancia explícitos y calibrados
export const THRESHOLDS = {
  MIN_LEXICAL_CANDIDATE: 0.5,
  MIN_SEMANTIC_SIMILARITY: 0.40,
  MIN_FINAL_ACCEPTANCE: 0.20,
  // Impulso determinista (no arbitrario) aplicado SOLO a candidatos que ya
  // superaron el umbral de aceptación, cuando el usuario está estudiando dentro
  // de un recurso o lección concretos.
  SCOPE_BOOST: 0.15
};

/** Ámbito determinista de recuperación: recurso o lección seleccionados. */
export interface RetrievalScope {
  resourceId?: string;
  lessonId?: string;
}

/**
 * Reciprocal Rank Fusion (RRF) combinada con puntuación ponderada.
 * RRF(d) = sum( 1 / (k + rank_i) ) donde k = 60 estándar.
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
 * Contrato de vigencia de un vector cacheado: solo es utilizable si su
 * `contentHash` coincide con el hash actual del material. Un cambio de contenido
 * (por ejemplo editar una lección) invalida el vector antiguo de forma perezosa,
 * sin reconstruir todo el índice ni afectar a fragmentos sin cambios.
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
 * Deduplica candidatos inteligentemente:
 * 1. Mismo chunkId -> eliminar duplicados exactos conservando la mayor puntuación.
 * 2. Mismo recurso (sourceId) -> topar a un máximo de 2 fragmentos por recurso para diversidad de fuentes.
 */
export function deduplicateAndDiversify(
  candidates: (RetrievedDocument & { chunkKey: string })[],
  maxChunksPerSource: number = 2
): RetrievedDocument[] {
  const sourceCount = new Map<string, number>();
  const result: RetrievedDocument[] = [];

  for (const item of candidates) {
    const currentCount = sourceCount.get(item.id) || 0;
    if (currentCount < maxChunksPerSource) {
      sourceCount.set(item.id, currentCount + 1);
      result.push(item);
    }
  }

  return result;
}

/**
 * Recupera documentos relevantes de la base de datos local SQLite de CrossedArts
 * basándose en una estrategia HÍBRIDA (léxica + semántica con embeddings on-device).
 */
export async function retrieveLocalContext(
  query: string,
  limit: number = 4,
  scope?: RetrievalScope
): Promise<RetrievalResult> {
  const tokens = tokenizeLexical(query);
  if (!tokens.length) {
    return { documents: [], hasContext: false, totalCandidates: 0, modeUsed: 'lexical', retrievalMode: 'lexical' };
  }

  let courses: any[] = [];
  let books: any[] = [];
  let notes: any[] = [];
  let flashcards: any[] = [];
  let graph: any = { nodes: [] };
  let lessonIndex: Awaited<ReturnType<typeof dao.getLessonIndex>> = [];

  try {
    // Todas las fuentes se resuelven en paralelo y con un número FIJO de
    // consultas. `getLessonIndex()` sustituye al patrón N+1
    // (`getCourseById()` por curso, que además re-escanaba todos los recursos).
    const results = await Promise.all([
      dao.getCourses(),
      dao.getBooks(),
      dao.getNotes(),
      dao.getFlashcards(),
      dao.getKnowledgeGraph(),
      dao.getLessonIndex()
    ]);
    courses = results[0];
    books = results[1];
    notes = results[2];
    flashcards = results[3];
    graph = results[4];
    lessonIndex = results[5];
  } catch {
    return { documents: [], hasContext: false, totalCandidates: 0, modeUsed: 'lexical', retrievalMode: 'lexical' };
  }

  // Mapa de candidatos léxicos
  const lexicalCandidates: Map<string, RetrievedDocument> = new Map();

  // 1a. Cursos (metadatos del recurso, sin reconstruir su jerarquía)
  for (const course of courses) {
    const courseText = `${course.title} ${course.description || ''} ${course.category}`;
    const score = scoreLexicalRelevance(tokens, courseText);
    if (score > 0) {
      lexicalCandidates.set(`course_${course.id}`, {
        id: course.id,
        sourceType: 'course',
        title: course.title,
        snippet: course.description ? `${course.description} (${course.category})` : `Curso: ${course.title} [${course.category}]`,
        score: score * 1.2
      });
    }
  }

  // 1b. Lecciones desde el índice plano (antes se reconstruía curso por curso).
  // El texto puntuado y el snippet se conservan idénticos para no alterar el
  // ranking determinista ni la deduplicación por fuente.
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
        score: lScore
      });
    }
  }

  // 2. Libros
  for (const book of books) {
    const bookText = `${book.title} ${book.author || ''} ${book.description || ''} ${book.category}`;
    const score = scoreLexicalRelevance(tokens, bookText);
    if (score > 0) {
      lexicalCandidates.set(`book_${book.id}`, {
        id: book.id,
        sourceType: 'book',
        title: book.title,
        snippet: `Libro de ${book.author || 'Autor desconocido'}: ${book.title}. Progreso: ${book.reading_percentage}%.`,
        score
      });
    }
  }

  // 3. Notas
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
        page: pageNum
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
        score
      });
    }
  }

  // 5. Conceptos del Grafo
  for (const node of graph.nodes) {
    const conceptText = `${node.name} ${node.description || ''}`;
    const score = scoreLexicalRelevance(tokens, conceptText);
    if (score > 0) {
      lexicalCandidates.set(`concept_${node.id}`, {
        id: node.id,
        sourceType: 'concept',
        title: `Concepto: ${node.name}`,
        snippet: node.description || `Concepto en el grafo: ${node.name}`,
        score
      });
    }
  }

  // 6. Búsqueda semántica usando el caché de vectores (si el motor o caché están disponibles)
  let semanticMatches: { chunkId: string; score: number; entry: any }[] = [];
  const isSemanticReady = localEmbeddingEngine.getStatus() === 'ready';
  let modeUsed: 'lexical' | 'hybrid' = 'lexical';

  if (isSemanticReady) {
    try {
      const modelId = localEmbeddingEngine.getLoadedModelId() || DEFAULT_EMBEDDING_MODEL_ID;
      // Consulta con prefijo explícito query:
      const queryVector = await localEmbeddingEngine.embedText(query, true);
      const allCached = await embeddingCache.getAllEntriesForModel(modelId);

      if (allCached.length > 0) {
        modeUsed = 'hybrid';

        // Validación de vigencia (staleness) por hash de contenido: un vector
        // cacheado solo es utilizable si su `contentHash` coincide con el hash
        // ACTUAL del material. Así, editar la lección A invalida su vector
        // antiguo (se excluye de la recuperación) sin reconstruir todo el índice
        // y sin afectar a la lección B ni a otros recursos sin cambios.
        const currentHashes = new Map<string, string>();
        try {
          // Usar la MISMA fuente que el indexador (getAllLearningResources) para que
          // los chunks de lección incluyan su contenido y el hash coincida.
          const currentResources = await dao.getAllLearningResources();
          const currentChunks = await createSemanticChunksFromResourcesAsync(currentResources as any);
          for (const c of currentChunks) currentHashes.set(c.chunkId, c.contentHash);
        } catch {
          /* Si no se pueden recalcular los hashes, no se usan vectores potencialmente obsoletos. */
        }

        for (const entry of allCached) {
          const expectedHash = currentHashes.get(entry.chunkId);
          // Sin hash actual conocido (material eliminado o no recalculable) el
          // vector se considera obsoleto y se excluye: nunca se trata como vigente.
          if (!isCachedVectorFresh(entry, expectedHash, entry.pipelineVersion || '')) {
            continue;
          }
          const sim = cosineSimilarity(queryVector, entry.vector);
          // Umbral semántico mínimo calibrado
          if (sim >= THRESHOLDS.MIN_SEMANTIC_SIMILARITY) {
            semanticMatches.push({ chunkId: entry.chunkId, score: sim, entry });
          }
        }
      }
    } catch (err) {
      console.warn('Fallback a recuperación léxica pura:', err);
    }
  }

  // Fusionar candidatos
  const mergedMap: Map<string, RetrievedDocument & { chunkKey: string }> = new Map();
  const maxLexical = Math.max(...Array.from(lexicalCandidates.values()).map(c => c.score), 1);

  // Añadir candidatos léxicos
  for (const [key, cand] of lexicalCandidates.entries()) {
    if (cand.score < THRESHOLDS.MIN_LEXICAL_CANDIDATE) continue;
    const normLex = normalizeScore(cand.score, maxLexical);
    mergedMap.set(key, {
      ...cand,
      chunkKey: key,
      score: normLex * 0.5, // 50% peso léxico base
      retrievalMode: 'lexical'
    });
  }

  // Incorporar y combinar coincidencias semánticas
  for (const sem of semanticMatches) {
    const normSem = Math.min(Math.max(sem.score, 0), 1);
    if (mergedMap.has(sem.chunkId)) {
      const existing = mergedMap.get(sem.chunkId)!;
      // Puntuación combinada híbrida
      existing.score = existing.score + (normSem * 0.5);
      existing.retrievalMode = 'hybrid';
    } else {
      mergedMap.set(sem.chunkId, {
        id: sem.entry.sourceId,
        sourceType: sem.entry.sourceType as any,
        title: sem.entry.title,
        snippet: sem.entry.text.slice(0, 200),
        score: normSem * 0.5,
        chunkKey: sem.chunkId,
        retrievalMode: 'semantic'
      });
    }
  }

  const allMerged = Array.from(mergedMap.values());

  // Umbral de aceptación final
  const filtered = allMerged.filter(c => c.score >= THRESHOLDS.MIN_FINAL_ACCEPTANCE);

  // Impulso determinista de ámbito: recurso seleccionado -> recursos relacionados.
  // Solo se aplica a candidatos relevantes ya aceptados, nunca sobre ruido.
  if (scope && (scope.resourceId || scope.lessonId)) {
    const anchor = scope.lessonId || scope.resourceId!;
    const scopeIds = new Set<string>([anchor]);
    if (scope.resourceId) scopeIds.add(scope.resourceId);
    if (scope.lessonId) scopeIds.add(scope.lessonId);
    try {
      for (const relatedId of await dao.getRelatedNodeIds(anchor)) {
        scopeIds.add(relatedId);
      }
    } catch {
      /* Si el grafo no está disponible, se conserva la recuperación base. */
    }
    for (const cand of filtered) {
      if (scopeIds.has(cand.id)) {
        cand.score = Math.min(1, cand.score + THRESHOLDS.SCOPE_BOOST);
      }
    }
  }

  // Ordenar deterministamente
  filtered.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  // Deduplicar inteligentemente (máximo 2 fragmentos por recurso para diversidad)
  const diversified = deduplicateAndDiversify(filtered, 2);

  const selected = diversified.slice(0, Math.min(limit, 5));

  return {
    documents: selected,
    hasContext: selected.length > 0,
    totalCandidates: diversified.length,
    modeUsed,
    retrievalMode: modeUsed
  };
}
