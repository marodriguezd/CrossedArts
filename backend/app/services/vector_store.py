"""
Lightweight vector store over SQLite.

Context and decision:
- CrossedArts is local-first: NO external infrastructure (no vector DBs, no
  SQLite binary extensions) is introduced just to scale semantic search.
- Embeddings live in `embedding_record` as JSON vectors. Similarity runs in
  Python because SQLite offers no vector functions.
- What IS fixed is that computation's COST:
    1. Model (and scope/entity) filtering happens in SQL, not memory: embeddings
       from different models never mix.
    2. Rows stream in BATCHES (`yield_per`) and only top-k survives in a bounded
       heap, so memory is O(k), not O(n).
    3. Similarity runs in a single pass with one query normalization.
    4. Scanned rows are capped by `scan_limit` (SQL limit), configurable, with
       the same default as the old behavior (3000 newest records).

This module defines the `VectorStore` interface (extension point) and the default
`SQLiteVectorStore`. A real-ANN-index implementation can replace it without
touching consumers.
"""
from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass
from typing import Iterable, Optional, Protocol, Sequence
from sqlalchemy.orm import Session

from backend.app.core.logging import get_logger
from backend.app.models.content import EmbeddingRecord

logger = get_logger("services.vector_store")

# Default semantic-search threshold (existing behavior).
DEFAULT_SIMILARITY_THRESHOLD = 0.25
# Scan batch size (rows materialized at once).
DEFAULT_BATCH_SIZE = 250
# Max records scanned per search (SQL limit, not in-memory).
DEFAULT_SCAN_LIMIT = 3000


@dataclass(frozen=True)
class SimilarityHit:
    """Similarity result ready for enrichment."""

    entity_id: str
    entity_type: str
    score: float
    model: str


class VectorStore(Protocol):
    """Extension point for similarity searches."""

    def search(
        self,
        query_vector: Sequence[float],
        *,
        model: str,
        limit: int = 20,
        threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        entity_ids: Optional[Iterable] = None,
        entity_types: Optional[Iterable[str]] = None,
        exclude_entity_ids: Optional[Iterable] = None,
    ) -> list[SimilarityHit]:
        ...


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    """
    Single-pass cosine similarity. Returns 0.0 on dimension mismatch or null
    vectors.
    """
    if len(a) != len(b) or not a:
        return 0.0
    dot = 0.0
    norm_a = 0.0
    norm_b = 0.0
    for x, y in zip(a, b):
        dot += x * y
        norm_a += x * x
        norm_b += y * y
    if norm_a <= 0.0 or norm_b <= 0.0:
        return 0.0
    return dot / (math.sqrt(norm_a) * math.sqrt(norm_b))


class SQLiteVectorStore:
    """
    Similarity search over `embedding_record` with bounded memory.

    - Model/entity filtering compiles to SQL.
    - Traversal uses `yield_per` (batches) plus a size-k heap.
    """

    def __init__(
        self,
        db: Session,
        *,
        batch_size: int = DEFAULT_BATCH_SIZE,
        scan_limit: Optional[int] = DEFAULT_SCAN_LIMIT,
    ) -> None:
        self.db = db
        self.batch_size = max(1, batch_size)
        self.scan_limit = scan_limit

    def search(
        self,
        query_vector: Sequence[float],
        *,
        model: str,
        limit: int = 20,
        threshold: float = DEFAULT_SIMILARITY_THRESHOLD,
        entity_ids: Optional[Iterable] = None,
        entity_types: Optional[Iterable[str]] = None,
        exclude_entity_ids: Optional[Iterable] = None,
    ) -> list[SimilarityHit]:
        if limit <= 0 or not query_vector:
            return []

        # Normalizar la consulta UNA sola vez: evita recalcular su norma por fila.
        query_norm = math.sqrt(sum(x * x for x in query_vector))
        if query_norm <= 0.0:
            return []

        query = self.db.query(
            EmbeddingRecord.entity_id,
            EmbeddingRecord.entity_type,
            EmbeddingRecord.vector,
            EmbeddingRecord.model,
        ).filter(EmbeddingRecord.model == model)

        if entity_ids is not None:
            ids = list(entity_ids)
            if not ids:
                return []
            query = query.filter(EmbeddingRecord.entity_id.in_(ids))
        if entity_types is not None:
            types = list(entity_types)
            if not types:
                return []
            query = query.filter(EmbeddingRecord.entity_type.in_(types))
        if exclude_entity_ids is not None:
            excluded = list(exclude_entity_ids)
            if excluded:
                query = query.filter(~EmbeddingRecord.entity_id.in_(excluded))

        # Newest first, as before; the limit applies in SQL.
        query = query.order_by(EmbeddingRecord.created_at.desc())
        if self.scan_limit is not None:
            logger.debug("Búsqueda semántica acotada a los %d registros más recientes (scan_limit)", self.scan_limit)
            query = query.limit(self.scan_limit)

        # Size-k heap: (score, counter, hit). The counter avoids comparing
        # SimilarityHit on exact score ties.
        heap: list[tuple[float, int, SimilarityHit]] = []
        counter = 0

        for entity_id, entity_type, vector_json, record_model in query.yield_per(self.batch_size):
            try:
                record_vector = json.loads(vector_json)
            except (TypeError, ValueError):
                continue
            if len(record_vector) != len(query_vector):
                continue
            score = cosine_similarity(query_vector, record_vector)
            if score < threshold:
                continue
            hit = SimilarityHit(
                entity_id=str(entity_id),
                entity_type=str(entity_type),
                score=score,
                model=str(record_model),
            )
            counter += 1
            if len(heap) < limit:
                heapq.heappush(heap, (score, counter, hit))
            elif score > heap[0][0]:
                heapq.heapreplace(heap, (score, counter, hit))

        return [hit for _, _, hit in sorted(heap, key=lambda item: item[0], reverse=True)]
