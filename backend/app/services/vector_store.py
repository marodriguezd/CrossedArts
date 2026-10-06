"""
Almacén vectorial ligero sobre SQLite (hallazgo A-4).

Contexto y decisión:
- CrossedArts es local-first: NO se introduce ninguna infraestructura externa
  (ni bases vectoriales, ni extensiones binarias de SQLite) solo para resolver
  la escalabilidad de la búsqueda semántica.
- Los embeddings viven en la tabla `embedding_record` como vectores JSON. La
  similitud se calcula en Python porque SQLite no ofrece funciones vectoriales.
- Lo que sí se corrige es el COSTE de ese cálculo:
    1. El filtro por modelo (y por ámbito/entidad) se aplica en SQL, no en
       memoria: nunca se mezclan embeddings de modelos distintos.
    2. Las filas se recorren en LOTES (`yield_per`) y solo se conserva el
       top-k en un heap acotado, así la memoria es O(k) y no O(n).
    3. La similitud se calcula en una sola pasada y con una única
       normalización de la consulta.
    4. El número de filas exploradas está acotado por `scan_limit` (límite
       SQL), configurable, con el mismo valor por defecto que el
       comportamiento anterior (3000 registros más recientes).

Este módulo define la interfaz `VectorStore` (punto de extensión) y la
implementación `SQLiteVectorStore` usada por defecto. Una implementación con
índice ANN real puede sustituirla sin cambiar a los consumidores.
"""
from __future__ import annotations

import heapq
import json
import math
from dataclasses import dataclass
from typing import Iterable, Optional, Protocol, Sequence

from sqlalchemy.orm import Session

from backend.app.models.content import EmbeddingRecord

# Umbral por defecto de la búsqueda semántica (comportamiento existente).
DEFAULT_SIMILARITY_THRESHOLD = 0.25
# Tamaño de lote del recorrido (filas materializadas a la vez).
DEFAULT_BATCH_SIZE = 250
# Máximo de registros explorados por búsqueda (límite SQL, no en memoria).
DEFAULT_SCAN_LIMIT = 3000


@dataclass(frozen=True)
class SimilarityHit:
    """Resultado de similitud listo para enriquecer."""

    entity_id: str
    entity_type: str
    score: float
    model: str


class VectorStore(Protocol):
    """Punto de extensión para búsquedas por similitud."""

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
    Similitud coseno en una sola pasada.

    Devuelve 0.0 si las dimensiones no coinciden o algún vector es nulo.
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
    Búsqueda por similitud sobre `embedding_record` con memoria acotada.

    - El filtro por modelo/entidad se traduce a SQL.
    - El recorrido usa `yield_per` (lotes) y un heap de tamaño k.
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

        # Los más recientes primero, como antes; el límite se aplica en SQL.
        query = query.order_by(EmbeddingRecord.created_at.desc())
        if self.scan_limit is not None:
            query = query.limit(self.scan_limit)

        # Heap de tamaño k: (score, contador, hit). El contador evita comparar
        # SimilarityHit cuando dos puntuaciones coinciden exactamente.
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
