import { domainEntitiesToKnowledgeDocuments } from '../../ai/knowledge/adapters.ts';
import type { DomainKnowledgeEntities } from '../../ai/knowledge/types.ts';
import {
  createSemanticChunksFromKnowledgeDocumentsAsync,
  type SemanticChunk
} from './chunking.ts';
import { semanticContentManifest } from './contentManifest.ts';
import { DEFAULT_EMBEDDING_MODEL_ID } from './registry.ts';

/**
 * Construcción del corpus semántico.
 *
 * Frontera canónica de indexación:
 *
 *   entidades de dominio (DAO/SQLite)
 *     -> `KnowledgeDocument` (ai/knowledge/adapters.ts)
 *       -> troceado semántico acotado
 *         -> vectores (embeddings)
 *           -> recuperación
 *
 * Todo lo que entra al pipeline semántico pasa por `KnowledgeDocument`: es la
 * única abstracción que conoce procedencia, jerarquía y texto canónico. Aquí
 * solo se orquestan los dos pasos posteriores (troceado + identidad de
 * contenido) sin duplicar reglas de negocio.
 *
 * El texto y los identificadores de fragmentoproduced aquí son IDENTICOS a los
 * que producía el troceado directo sobre entidades de dominio: los adaptadores
 * construyen exactamente las mismas cabeceras y cuerpos. Por eso cambiar la
 * frontera no altera los resultados de recuperación ni invalida los vectores ya
 * cacheados.
 */

export interface SemanticCorpusResult {
  /** Fragmentos con su identidad de contenido ya resuelta. */
  chunks: SemanticChunk[];
  /** Fragmentos cuyo SHA-256 se recalculó en esta pasada. */
  recomputedHashes: number;
  /** Fragmentos cuyo SHA-256 se reutilizó del manifiesto. */
  reusedHashes: number;
  /** Entradas purgadas por material eliminado del corpus. */
  purgedHashes: number;
}

/**
 * Construye el corpus semántico completo desde entidades de dominio.
 *
 * La identidad de contenido se resuelve a través del manifiesto local: los
 * documentos sin cambios reutilizan su SHA-256 y solo los documentos
 * modificados recalculan el suyo, invalidando únicamente sus fragmentos.
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
 * Mapa `chunkId -> contentHash` ACTUAL del corpus, para validar la vigencia de
 * los vectores cacheados. Un fragmento ausente del mapa se considera obsoleto.
 */
export async function buildCurrentChunkHashes(
  entities: DomainKnowledgeEntities,
  modelId: string = DEFAULT_EMBEDDING_MODEL_ID
): Promise<Map<string, string>> {
  const corpus = await buildSemanticCorpus(entities, modelId);
  return new Map(corpus.chunks.map(chunk => [chunk.chunkId, chunk.contentHash]));
}