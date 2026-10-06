"""
Semantic Search Service.

Proporciona búsqueda por similitud sobre todo el contenido indexado.

Escalabilidad (A-4): el cálculo de similitud se delega en
`SQLiteVectorStore`, que filtra por modelo/entidad en SQL, recorre los
registros en lotes y mantiene solo el top-k en memoria. La semántica existente
para bibliotecas pequeñas se conserva (umbral 0.25, orden por puntuación,
límite de registros explorados configurable).

Tipos de recurso relacionados (A-7): `get_related_resources` devuelve el tipo
de dominio REAL de cada recurso (course/book/...), resuelto con consultas en
lote en lugar de asumir "course" para todo.
"""
import uuid
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from backend.app.core.logging import get_logger
from backend.app.core.settings import settings
from backend.app.models.activity import Note
from backend.app.models.content import ContentIndex, EmbeddingRecord, Transcript, TranscriptSegment
from backend.app.models.resource import Book, Course, MediaAsset
from backend.app.services.embedding import EmbeddingService
from backend.app.services.vector_store import (
    DEFAULT_SIMILARITY_THRESHOLD,
    SQLiteVectorStore,
    SimilarityHit,
)

logger = get_logger("services.semantic_search")


class SemanticSearchService:
    """Service for semantic similarity search."""

    #: Umbral de similitud para la búsqueda semántica general.
    SEARCH_THRESHOLD = DEFAULT_SIMILARITY_THRESHOLD
    #: Umbral (más permisivo) para notas relacionadas.
    RELATED_NOTES_THRESHOLD = 0.10

    # ------------------------------------------------------------------ #
    # Utilidades internas                                                 #
    # ------------------------------------------------------------------ #

    @staticmethod
    def _build_store(db: Session) -> SQLiteVectorStore:
        return SQLiteVectorStore(db, scan_limit=settings.semantic_scan_limit)

    @staticmethod
    def _collect_entity_ids(db: Session, resource_id) -> List:
        """IDs de todas las entidades indexadas que pertenecen a un recurso."""
        ci_ids = [
            ci.id
            for ci in db.query(ContentIndex.id)
            .join(MediaAsset, ContentIndex.media_asset_id == MediaAsset.id)
            .filter(MediaAsset.resource_id == resource_id)
            .all()
        ]
        note_ids = [n.id for n in db.query(Note.id).filter(Note.resource_id == resource_id).all()]
        ts_ids = [
            ts.id
            for ts in db.query(TranscriptSegment.id)
            .join(Transcript, TranscriptSegment.transcript_id == Transcript.id)
            .join(MediaAsset, Transcript.media_asset_id == MediaAsset.id)
            .filter(MediaAsset.resource_id == resource_id)
            .all()
        ]
        return ci_ids + note_ids + ts_ids

    @staticmethod
    def _resolve_resource_ids(db: Session, entity_ids: List[str]) -> Dict[str, object]:
        """
        Mapa entity_id -> resource_id resuelto en LOTE (sin N+1).

        Cubre las tres familias indexadas: notas (resource_id directo),
        contenido de documentos (vía MediaAsset) y segmentos de transcripción
        (vía Transcript -> MediaAsset).
        """
        result: Dict[str, object] = {}
        if not entity_ids:
            return result

        parsed = []
        for eid in entity_ids:
            try:
                parsed.append(uuid.UUID(eid) if len(eid) == 36 else eid)
            except ValueError:
                parsed.append(eid)

        notes = db.query(Note.id, Note.resource_id).filter(Note.id.in_(parsed)).all()
        for note_id, resource_id in notes:
            if resource_id is not None:
                result[str(note_id)] = resource_id

        contents = (
            db.query(ContentIndex.id, MediaAsset.resource_id)
            .join(MediaAsset, ContentIndex.media_asset_id == MediaAsset.id)
            .filter(ContentIndex.id.in_(parsed))
            .all()
        )
        for content_id, resource_id in contents:
            if resource_id is not None:
                result[str(content_id)] = resource_id

        segments = (
            db.query(TranscriptSegment.id, MediaAsset.resource_id)
            .join(Transcript, TranscriptSegment.transcript_id == Transcript.id)
            .join(MediaAsset, Transcript.media_asset_id == MediaAsset.id)
            .filter(TranscriptSegment.id.in_(parsed))
            .all()
        )
        for segment_id, resource_id in segments:
            if resource_id is not None:
                result[str(segment_id)] = resource_id

        return result

    @staticmethod
    def _resolve_resource_types(db: Session, resource_ids) -> Dict[object, Tuple[str, str]]:
        """
        Mapa resource_id -> (título, tipo de dominio real).

        Consulta en lote sobre las tablas concretas (Course, Book) para
        devolver el tipo REAL y no una etiqueta genérica.
        """
        info: Dict[object, Tuple[str, str]] = {}
        ids = [rid for rid in resource_ids if rid is not None]
        if not ids:
            return info
        courses = db.query(Course.id, Course.title).filter(Course.id.in_(ids)).all()
        for course_id, title in courses:
            info[course_id] = (title, "course")
        books = db.query(Book.id, Book.title).filter(Book.id.in_(ids)).all()
        for book_id, title in books:
            info[book_id] = (title, "book")
        return info

    # ------------------------------------------------------------------ #
    # API pública                                                         #
    # ------------------------------------------------------------------ #

    @classmethod
    def search(
        cls,
        db: Session,
        query: str,
        limit: int = 20,
        offset: int = 0,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
    ) -> List[dict]:
        """Busca contenido similar usando similitud coseno (paginado)."""
        if not query or not query.strip():
            return []

        try:
            query_vector = EmbeddingService.get_embedding(query.strip())
        except Exception as e:
            logger.error("Error generando embedding para la búsqueda: %s", e)
            return []

        # Nunca mezclar embeddings generados por modelos distintos.
        current_model = EmbeddingService.get_model_name()

        entity_ids: Optional[List] = None
        if resource_id:
            entity_ids = cls._collect_entity_ids(db, resource_id)
            if not entity_ids:
                return []

        store = cls._build_store(db)
        # Se piden limit+offset resultados: el offset se aplica sobre el ranking
        # global y el top-k se mantiene acotado en memoria.
        hits: List[SimilarityHit] = store.search(
            query_vector,
            model=current_model,
            limit=max(0, limit) + max(0, offset),
            threshold=cls.SEARCH_THRESHOLD,
            entity_ids=entity_ids,
        )
        if offset > 0:
            hits = hits[offset:]
        hits = hits[:limit]

        if not hits:
            return []

        # Carga en lote de entidades completas (una consulta por tipo).
        entity_map = {}
        note_ids = [h.entity_id for h in hits if h.entity_type == "note"]
        transcript_ids = [h.entity_id for h in hits if h.entity_type == "transcript_segment"]
        content_ids = [h.entity_id for h in hits if h.entity_type == "content_index"]

        if note_ids:
            notes = db.query(Note).filter(Note.id.in_(note_ids)).all()
            entity_map.update({str(n.id): n for n in notes})
        if transcript_ids:
            segments = db.query(TranscriptSegment).filter(TranscriptSegment.id.in_(transcript_ids)).all()
            entity_map.update({str(s.id): s for s in segments})
        if content_ids:
            contents = db.query(ContentIndex).filter(ContentIndex.id.in_(content_ids)).all()
            entity_map.update({str(c.id): c for c in contents})

        # Resource IDs de las entidades encontradas.
        rid_set = set()
        for entity in entity_map.values():
            rid = getattr(entity, "resource_id", None)
            if rid:
                rid_set.add(rid)
        resource_map = cls._resolve_resource_types(db, rid_set)

        # Resultados enriquecidos con fragmento y metadatos.
        enriched = []
        for hit in hits:
            entity = entity_map.get(hit.entity_id)
            if not entity:
                continue

            snippet = ""
            title = ""
            if hit.entity_type == "note":
                snippet = entity.content[:200] if entity.content else ""
                title = "Nota de Estudio"
            elif hit.entity_type == "transcript_segment":
                snippet = entity.text[:200] if entity.text else ""
                title = f"Transcripción ({entity.start_time:.1f}s)"
            elif hit.entity_type == "content_index":
                snippet = entity.content[:200] if entity.content else ""
                title = (
                    entity.section_name
                    if hasattr(entity, "section_name") and entity.section_name
                    else "Contenido"
                )

            rid = getattr(entity, "resource_id", None)
            res_info = resource_map.get(rid) if rid else None

            enriched.append({
                "entity_id": hit.entity_id,
                "entity_type": hit.entity_type,
                "score": round(hit.score, 4),
                "title": title,
                "snippet": snippet,
                "model": hit.model,
                "resource_id": rid,
                "resource_title": res_info[0] if res_info else "",
                "resource_type": res_info[1] if res_info else "",
                # Claves de compatibilidad hacia atrás.
                "match_type": hit.entity_type,
                "match_reason": title,
            })

        return enriched

    @classmethod
    def get_related_resources(cls, db: Session, resource_id, limit: int = 5) -> List[dict]:
        """Encuentra recursos conceptualmente relacionados con el dado."""
        all_entity_ids = cls._collect_entity_ids(db, resource_id)
        if not all_entity_ids:
            return []

        current_model = EmbeddingService.get_model_name()

        # Huella del recurso: media de sus embeddings (máximo 30, como antes).
        resource_embeddings = (
            db.query(EmbeddingRecord)
            .filter(
                EmbeddingRecord.entity_id.in_(all_entity_ids),
                EmbeddingRecord.model == current_model,
            )
            .limit(30)
            .all()
        )
        if not resource_embeddings:
            return []

        import json

        all_vectors = []
        for record in resource_embeddings:
            try:
                all_vectors.append(json.loads(record.vector))
            except (TypeError, ValueError):
                continue
        if not all_vectors:
            return []

        fingerprint = [
            sum(vector[i] for vector in all_vectors) / len(all_vectors)
            for i in range(len(all_vectors[0]))
        ]

        # Se piden varios candidatos por recurso destino para poder deduplicar
        # por recurso sin perder resultados útiles.
        store = cls._build_store(db)
        hits = store.search(
            fingerprint,
            model=current_model,
            limit=max(limit * 5, limit),
            threshold=0.0,
            exclude_entity_ids=all_entity_ids,
        )

        # Resolución en lote: entidad -> recurso -> tipo real (A-7, sin N+1).
        entity_to_resource = cls._resolve_resource_ids(db, [h.entity_id for h in hits])
        ordered_resource_ids = []
        best_score_by_resource: Dict[object, float] = {}
        for hit in hits:
            rid = entity_to_resource.get(hit.entity_id)
            if rid is None or rid == resource_id:
                continue
            if rid not in best_score_by_resource:
                ordered_resource_ids.append(rid)
                best_score_by_resource[rid] = hit.score
            elif hit.score > best_score_by_resource[rid]:
                best_score_by_resource[rid] = hit.score
            if len(ordered_resource_ids) >= limit:
                break

        resource_info = cls._resolve_resource_types(db, ordered_resource_ids)

        result = []
        for rid in ordered_resource_ids:
            title, real_type = resource_info.get(rid, ("", "resource"))
            result.append({
                "id": rid,
                "title": title,
                "type": real_type,
                "similarity": round(best_score_by_resource[rid], 4),
            })

        return result

    @classmethod
    def get_related_notes(cls, db: Session, note_id, limit: int = 5) -> List[dict]:
        """Encuentra notas conceptualmente similares a la dada."""
        current_model = EmbeddingService.get_model_name()
        note_record = (
            db.query(EmbeddingRecord)
            .filter(
                EmbeddingRecord.entity_id == note_id,
                EmbeddingRecord.entity_type == "note",
                EmbeddingRecord.model == current_model,
            )
            .first()
        )
        if not note_record:
            return []

        import json

        try:
            note_vector = json.loads(note_record.vector)
        except (TypeError, ValueError):
            return []

        store = cls._build_store(db)
        hits = store.search(
            note_vector,
            model=current_model,
            limit=limit,
            threshold=cls.RELATED_NOTES_THRESHOLD,
            entity_types=["note"],
            exclude_entity_ids=[note_id],
        )

        return [
            {"note_id": hit.entity_id, "similarity": round(hit.score, 4)}
            for hit in hits
        ]
