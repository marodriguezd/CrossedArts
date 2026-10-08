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
 * Tipos canónicos de la recuperación local.
 *
 * Viven en `types.ts` para que recuperación, diversificación, fusión y
 * empaquetado de contexto compartan EXACTAMENTE el mismo contrato. Aquí solo se
 * re-exportan, conservando la ruta de importación histórica
 * (`localRag/retrieval.ts`) usada por los llamantes.
 */
export type {
  RetrievedSourceType,
  RetrievedDocument,
  RetrievalResult,
  RetrievalScope
} from './types.ts';

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
 * Un acierto es sustantivo cuando los tokens de la consulta aparecen en el
 * CONTENIDO del artefacto (no solo en su título). Determinista y conservador.
 */
function isSubstantiveMatch(queryTokens: string[], content: string | null | undefined): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  return scoreLexicalRelevance(queryTokens, text) > 0;
}

/**
 * Umbrales de relevancia explícitos y calibrados.
 *
 * El contrato vive en `types.ts` (única definición) y se re-exporta aquí para
 * conservar la ruta de importación histórica.
 */
export { THRESHOLDS } from './types.ts';
// La fusión vive en `fusion.ts`; se re-exporta aquí porque la recuperación y
// sus pruebas históricos la importaban desde este módulo.
export { computeRrfScore, normalizeScore } from './fusion.ts';

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
 * Diversificación canónica de candidatos.
 *
 * Es un alias estable de la política única (`diversification.ts`), que cuenta
 * por IDENTIFICADOR BASE de fuente y no por identificador de fragmento. Se
 * mantiene el nombre histórico porque varios llamantes y pruebas lo importan
 * desde este módulo; la lógica vive en un único sitio.
 */
export function deduplicateAndDiversify(
  candidates: RetrievedDocument[],
  maxChunksPerSource: number = DEFAULT_MAX_CHUNKS_PER_SOURCE
): RetrievedDocument[] {
  return diversifyResults(candidates, { maxChunksPerSource });
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
    // Todas las fuentes se resuelven en paralelo y con un número FIJO de
    // consultas. `getLessonIndex()` sustituye al patrón N+1
    // (`getCourseById()` por curso, que además re-escanaba todos los recursos).
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
        score: score * 1.2,
        substantive: isSubstantiveMatch(tokens, course.description),
        path: [course.title],
        resourceId: course.id
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
        score: lScore,
        substantive: isSubstantiveMatch(tokens, entry.lessonContent),
        path: [entry.courseTitle, entry.moduleTitle, entry.lessonTitle],
        resourceId: entry.courseId,
        lessonId: entry.lessonId
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
        score,
        substantive: isSubstantiveMatch(tokens, book.description),
        path: [book.title],
        resourceId: book.id
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
        // El anverso y el reverso SON el contenido de la tarjeta.
        substantive: true,
        resourceId: fc.resource_id || undefined,
        lessonId: fc.lesson_id || undefined
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
        score,
        substantive: isSubstantiveMatch(tokens, node.description)
      });
    }
  }

  // 5b. Trabajo práctico: evidencia PRODUCIDA por el estudiante. Se recupera por
  // su título, descripción, contenido y notas, y conserva la procedencia hacia
  // su recurso/lección para que el ámbito pueda acotarlo.
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

  // 6. Búsqueda semántica usando el caché de vectores (si el motor o caché están disponibles)
  let semanticMatches: { chunkId: string; score: number; entry: any }[] = [];
  let isSemanticReady = localEmbeddingEngine.getStatus() === 'ready';

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
          // Se reutilizan los datos que esta misma recuperación ya cargó: antes se
          // reconstruía toda la biblioteca con getAllLearningResources(), que
          // volvía a consultar cursos/módulos y podía introducir trabajo N+1.
          //
          // La identidad de contenido se resuelve por la frontera canónica
          // (entidades de dominio -> KnowledgeDocument -> fragmentos) y a través
          // del manifiesto local: los documentos sin cambios reutilizan su
          // SHA-256, así que una consulta semántica no recalcula el hash de
          // toda la biblioteca. La corrección NO depende del manifiesto: el
          // hash devuelto siempre corresponde al texto actual.
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
          /* Si no se pueden recalcular los hashes, no se usan vectores potencialmente obsoletos. */
        }

        for (const entry of allCached) {
          const expectedHash = currentHashes.get(entry.chunkId);
          // Sin hash actual conocido (material eliminado o no recalculable) el
          // vector se considera obsoleto y se excluye: nunca se trata como vigente.
          // La versión esperada es la del runtime, nunca la de la propia
          // entrada: una entrada con una versión distinta debe caducar aunque
          // se autoconsidere vigente.
          if (!isCachedVectorFresh(entry, expectedHash, EMBEDDING_PIPELINE_VERSION)) {
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

  // FUSIÓN (implementación canónica en `fusion.ts`): RRF como señal principal y
  // similitud normalizada como desempate de calidad.
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
    filtered = filtered.filter(c => isWithinScope({ sourceId: c.id, resourceId: c.resourceId, lessonId: c.lessonId }, scopeIds!));
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
  const diversified = diversifyResults(filtered, { maxChunksPerSource: DEFAULT_MAX_CHUNKS_PER_SOURCE });

  const selected = diversified.slice(0, Math.min(limit, 5));

  const finalMode: 'lexical' | 'hybrid' | 'semantic' =
    semanticRankKeys.size === 0 ? 'lexical' :
    lexicalRankKeys.size === 0 ? 'semantic' :
    'hybrid';

  // `totalCandidates` describe el conjunto de candidatos ACEPTADOS antes de
  // diversificar; `diversifiedCandidates` los que quedan tras diversificar. Así
  // el número es fiel a lo que representa en cada fase.
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
