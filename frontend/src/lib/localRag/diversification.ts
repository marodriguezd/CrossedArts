import type { RetrievedDocument } from './types.ts';

/**
 * Política canónica de diversificación de fuentes.
 *
 * Este módulo es la ÚNICA implementación de diversificación del pipeline RAG:
 * la recuperación de producción la consume directamente, de modo que no puede
 * existir una segunda política paralela que contradiga el número máximo de
 * fragmentos por fuente.
 */

/** Máximo de fragmentos que una misma fuente puede aportar a un resultado. */
export const DEFAULT_MAX_CHUNKS_PER_SOURCE = 2;

export interface DiversificationPolicy {
  maxChunksPerSource?: number;
  /**
   * Tope opcional de resultados totales. Si se omite NO se recorta: el recorte
   * a `limit` pertenece a la recuperación, no a la política de diversidad.
   */
  maxTotalResults?: number;
}

/** Sufijo de parte que genera el troceado semántico (`..._p2`, `..._p3`, ...). */
const CHUNK_PART_SUFFIX = /_p\d+$/;

/**
 * Identificador BASE de una fuente: el artefacto real al que pertenece el
 * fragmento.
 *
 * Es la clave que hace cumplir "máximo N fragmentos por fuente". Contar por
 * identificador de fragmento permitiría que una lección larga
 * (`lesson_abc`, `lesson_abc_p2`, `lesson_abc_p3`) monopolizara el resultado
 * completo, porque cada parte es un identificador distinto.
 *
 * El identificador del documento retrieval ES el identificador del artefacto de
 * origen (`sourceId` del chunk semántico, id de nota/recurso/ flashcards en la
 * ruta léxica); el sufijo `_pN` solo aparece cuando el chunking semántico
 * fragmentó un artefacto largo.
 *
 * `lessonId` y `resourceId` NO se usan como clave: son los artefactos
 * PROPIETARIOS, no la fuente del fragmento. Usarlos colapsaría en una sola
 * fuente la lección y todas sus notas, o todas las lecciones de un curso, que
 * es justo lo contrario de diversificar.
 */
export function resolveBaseSourceKey(
  doc: Pick<RetrievedDocument, 'id'> & { chunkKey?: string }
): string {
  // `id` es el identificador del artefacto de origen en la producción; el
  // `chunkKey` (id del chunk semántico) solo se usa como respaldo explícito.
  const raw = String(doc.id ?? doc.chunkKey ?? '');
  return raw.replace(CHUNK_PART_SUFFIX, '');
}

/**
 * Aplica diversificación determinista a los documentos candidatos: como máximo
 * `maxChunksPerSource` fragmentos por fuente base. Conserva el orden de
 * entrada (ya viene ordenado por puntuación con desempate estable), por lo que
 * la operación es reproducible.
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