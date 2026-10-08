import { cosineSimilarity } from './engine.ts';

export interface VectorMatch {
  id: string;
  score: number;
  metadata?: Record<string, any>;
}

export interface VectorIndexItem {
  id: string;
  vector: Float32Array | number[];
  metadata?: Record<string, any>;
}

export interface VectorSearchOptions {
  limit?: number;
  minSimilarity?: number;
  filter?: (metadata?: Record<string, any>) => boolean;
}

export interface VectorIndex {
  search(queryVector: Float32Array | number[], options?: VectorSearchOptions): VectorMatch[];
  upsert(item: VectorIndexItem): void;
  upsertBatch(items: VectorIndexItem[]): void;
  delete(id: string): void;
  clear(): void;
  size(): number;
}

/**
 * Implementación optimizada de VectorIndex en memoria usando Float32Array contiguo
 * para búsquedas rápidas con similitud de coseno, cero asignaciones intermedias
 * y soporte para filtros arbitrarios.
 */
export class MemoryVectorIndex implements VectorIndex {
  private items: Map<string, { vector: Float32Array; metadata?: Record<string, any> }> = new Map();
  private dimension: number;

  constructor(dimension: number = 256) {
    this.dimension = dimension;
  }

  public size(): number {
    return this.items.size;
  }

  public upsert(item: VectorIndexItem): void {
    const floatVec = item.vector instanceof Float32Array
      ? item.vector
      : new Float32Array(item.vector);

    if (floatVec.length !== this.dimension) {
      throw new Error(`Dimensión de vector incompatible: se esperaba ${this.dimension}, se recibió ${floatVec.length}`);
    }

    this.items.set(item.id, { vector: floatVec, metadata: item.metadata });
  }

  public upsertBatch(items: VectorIndexItem[]): void {
    for (const item of items) {
      this.upsert(item);
    }
  }

  public delete(id: string): void {
    this.items.delete(id);
  }

  public clear(): void {
    this.items.clear();
  }

  public search(
    queryVector: Float32Array | number[],
    options: VectorSearchOptions = {}
  ): VectorMatch[] {
    const limit = options.limit ?? 10;
    const minSim = options.minSimilarity ?? -1.0;
    const q = queryVector instanceof Float32Array
      ? queryVector
      : new Float32Array(queryVector);

    if (q.length !== this.dimension) {
      throw new Error(`Dimensión de vector de búsqueda incompatible: se esperaba ${this.dimension}, se recibió ${q.length}`);
    }

    const matches: VectorMatch[] = [];

    // Calcular similitud coseno directa con Float32Array
    for (const [id, entry] of this.items.entries()) {
      if (options.filter && !options.filter(entry.metadata)) {
        continue;
      }

      const v = entry.vector;
      if (v.length !== this.dimension) {
        continue;
      }

      let dot = 0;
      let normQ = 0;
      let normV = 0;

      for (let i = 0; i < this.dimension; i++) {
        dot += q[i] * v[i];
        normQ += q[i] * q[i];
        normV += v[i] * v[i];
      }

      const denom = Math.sqrt(normQ) * Math.sqrt(normV);
      const score = denom > 0 ? dot / denom : 0;

      if (score >= minSim) {
        matches.push({ id, score, metadata: entry.metadata });
      }
    }

    return matches
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, limit);
  }
}
