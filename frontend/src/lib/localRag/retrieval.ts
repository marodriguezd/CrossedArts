import { dao } from '../../db/dao.ts';
import { localEmbeddingEngine, cosineSimilarity } from '../localEmbeddings/engine.ts';
import { embeddingCache } from '../localEmbeddings/cache.ts';
import { createSemanticChunksFromResourcesAsync } from '../localEmbeddings/chunking.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from '../localEmbeddings/registry.ts';
import { localAiRuntime } from '../../services/localAiRuntime.ts';

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
  modeUsed: 'lexical' | 'hybrid' | 'semantic';
  retrievalMode: 'lexical' | 'hybrid' | 'semantic';
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

/**
 * Ámbito determinista de recuperación: recurso o lección seleccionados.
 *
 * Contrato de ámbito: cuando el llamante pide una explicación o generación
 * acotada, el material FUERA del ámbito no puede convertirse en contexto
 * autoritativo por puntuación. El ámbito filtra (hard boundary) y, además,
 * impulsa a los candidatos del ámbito; sin ámbito, la búsqueda es global y
 * no se debilita.
 */
export interface RetrievalScope {
  resourceId?: string;
  lessonId?: string;
}

/**
 * Resuelve el conjunto de IDs que pertenecen al ámbito solicitado.
 *
 * Lección -> la propia lección, su curso y sus nodos conectados.
 * Recurso -> el recurso y sus nodos conectados (módulos, lecciones, notas).
 * La conexión explícita del grafo permite contexto relacionado DENTRO del
 * perímetro declarado por el usuario; nunca material arbitrario externo.
 */
async function resolveScopeIds(scope: RetrievalScope): Promise<Set<string>> {
  const anchor = scope.lessonId || scope.resourceId;
  if (!anchor) return new Set();
  const scopeIds = new Set<string>([anchor]);
  if (scope.resourceId) scopeIds.add(scope.resourceId);
  if (scope.lessonId) scopeIds.add(scope.lessonId);
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
export interface RetrievalOptions {
  /**
   * Solicita recuperación semántica cuando aporte valor. La preparación de
   * embeddings y la indexación de contenido faltante ocurren automáticamente;
   * si no es posible, la recuperación léxica permanece intacta.
   */
  semantic?: boolean;
}

export async function retrieveLocalContext(
  query: string,
  limit: number = 4,
  scope?: RetrievalScope,
  options?: RetrievalOptions
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
  let isSemanticReady = localEmbeddingEngine.getStatus() === 'ready';
  let modeUsed: 'lexical' | 'hybrid' = 'lexical';

  // Preparación automática de embeddings cuando la recuperación semántica es
  // útil. Si tarda o falla, se degrada inmediatamente a recuperación léxica en SQLite.
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
      // Consulta con prefijo explícito query:
      const queryVector = await localEmbeddingEngine.embedText(query, true);
      const allCached = await embeddingCache.getAllEntriesForModel(modelId);

      if (allCached.length > 0) {
        // El modo semántico solo se anuncia cuando existen coincidencias semánticas aceptables.

        // Validación de vigencia (staleness) por hash de contenido: un vector
        // cacheado solo es utilizable si su `contentHash` coincide con el hash
        // ACTUAL del material. Así, editar la lección A invalida su vector
        // antiguo (se excluye de la recuperación) sin reconstruir todo el índice
        // y sin afectar a la lección B ni a otros recursos sin cambios.
        const currentHashes = new Map<string, string>();
        try {
          // Reutilizar los datos que esta misma recuperación ya cargó. Antes se
          // reconstruía toda la biblioteca mediante getAllLearningResources(), que
          // volvía a consultar cursos/módulos y podía introducir trabajo N+1.
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
              .map(([moduleTitle, lessons], index) => ({
                id: `${course.id}::${index + 1}`,
                title: moduleTitle,
                lessons: lessons.sort((a, b) => a.id.localeCompare(b.id))
              }))
          }));

          const currentChunks = await createSemanticChunksFromResourcesAsync({
            courses: coursesForChunks,
            books,
            notes,
            flashcards,
            concepts: graph.nodes
          });
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

  // Fusionar candidatos con Reciprocal Rank Fusion (RRF) y conservar
  // una señal normalizada de similitud para desempates de calidad.
  const mergedMap: Map<string, RetrievedDocument & { chunkKey: string }> = new Map();
  const maxLexical = Math.max(...Array.from(lexicalCandidates.values()).map(c => c.score), 1);
  const lexicalEligible = Array.from(lexicalCandidates.entries())
    .filter(([, cand]) => cand.score >= THRESHOLDS.MIN_LEXICAL_CANDIDATE)
    .sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0]));
  const semanticRanked = [...semanticMatches]
    .sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));

  const lexicalRanks = new Map<string, number>();
  for (let i = 0; i < lexicalEligible.length; i++) lexicalRanks.set(lexicalEligible[i][0], i);

  const semanticRanks = new Map<string, number>();
  for (let i = 0; i < semanticRanked.length; i++) semanticRanks.set(semanticRanked[i].chunkId, i);

  const maxRrf = computeRrfScore(0, 0);
  const semanticById = new Map(semanticRanked.map(item => [item.chunkId, item]));

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
          sourceType: semantic!.entry.sourceType as any,
          title: semantic!.entry.title,
          snippet: semantic!.entry.text.slice(0, 200),
          score: semScore,
          retrievalMode: 'semantic'
        };

    const hasLexical = lexicalRanks.has(key);
    const hasSemantic = semanticRanks.has(key);
    base.score = (lexScore * 0.25) + (semScore * 0.25) + (rrfNormalized * 0.5);
    base.retrievalMode = hasLexical && hasSemantic
      ? 'hybrid'
      : hasSemantic
        ? 'semantic'
        : 'lexical';

    mergedMap.set(key, { ...base, chunkKey: key });
  }

  if (semanticRanked.length > 0) modeUsed = 'hybrid';

  const allMerged = Array.from(mergedMap.values());

  // CONTRATO DE ÁMBITO (frontera dura): con ámbito solicitado, solo el material
  // dentro del perímetro resuelto (anclas + nodos conectados del grafo) puede
  // convertirse en contexto. Un documento ajeno con puntuación alta JAMÁS entra
  // por puntuación; sin ámbito la búsqueda sigue siendo global e intacta.
  let scopeIds: Set<string> | null = null;
  if (scope && (scope.resourceId || scope.lessonId)) {
    scopeIds = await resolveScopeIds(scope);
  }

  // Umbral de aceptación final
  let filtered = allMerged.filter(c => c.score >= THRESHOLDS.MIN_FINAL_ACCEPTANCE);

  if (scopeIds) {
    filtered = filtered.filter(c => scopeIds!.has(c.id));
    for (const cand of filtered) {
      // Impulso determinista de ámbito, solo a candidatos ya dentro del perímetro.
      cand.score = Math.min(1, cand.score + THRESHOLDS.SCOPE_BOOST);
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

  const finalMode: 'lexical' | 'hybrid' | 'semantic' =
    semanticRanked.length === 0 ? 'lexical' :
    lexicalRanks.size === 0 ? 'semantic' :
    'hybrid';

  return {
    documents: selected,
    hasContext: selected.length > 0,
    totalCandidates: diversified.length,
    modeUsed: finalMode,
    retrievalMode: finalMode
  };
}
