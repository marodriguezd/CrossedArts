"""
Semantic Search Service using LangChain.
Provides vector similarity search across all indexed content.
"""
import json
import uuid
from typing import List, Optional
from sqlalchemy.orm import Session
from backend.app.services.embedding import EmbeddingService
from backend.app.models.content import EmbeddingRecord, TranscriptSegment, ContentIndex
from backend.app.models.activity import Note
from backend.app.models.resource import MediaAsset


class SemanticSearchService:
    """Service for semantic similarity search."""

    @classmethod
    def search(cls, db: Session, query: str, limit: int = 20,
               resource_type: Optional[str] = None,
               resource_id: Optional[str] = None) -> List[dict]:
        """Search for similar content using cosine similarity."""
        if not query or not query.strip():
            return []

        try:
            query_vector = EmbeddingService.get_embedding(query.strip())
        except Exception as e:
            print(f"[CrossedArts] Embedding error for search: {e}")
            return []

        # Nunca mezclar embeddings generados por modelos distintos.
        current_model = EmbeddingService.get_model_name()
        query_filter = db.query(EmbeddingRecord).filter(
            EmbeddingRecord.model == current_model
        ).order_by(EmbeddingRecord.created_at.desc())
        
        if resource_id:
            # Find entity IDs that belong to this resource
            from backend.app.models.resource import Course, Book
            
            # ContentIndex entities via MediaAsset
            ci_ids = [ci.id for ci in db.query(ContentIndex.id).join(
                MediaAsset, ContentIndex.media_asset_id == MediaAsset.id
            ).filter(MediaAsset.resource_id == resource_id).all()]
            
            # Note entities directly linked to resource
            note_ids = [n.id for n in db.query(Note.id).filter(
                Note.resource_id == resource_id
            ).all()]
            
            # TranscriptSegment entities via Transcript -> MediaAsset
            from backend.app.models.content import Transcript
            ts_ids = [ts.id for ts in db.query(TranscriptSegment.id).join(
                Transcript, TranscriptSegment.transcript_id == Transcript.id
            ).join(
                MediaAsset, Transcript.media_asset_id == MediaAsset.id
            ).filter(MediaAsset.resource_id == resource_id).all()]
            
            all_entity_ids = ci_ids + note_ids + ts_ids
            if not all_entity_ids:
                return []
            
            query_filter = query_filter.filter(EmbeddingRecord.entity_id.in_(all_entity_ids))
        
        records = query_filter.limit(3000).all()
        
        if not records:
            return []

        # Compute cosine similarity
        results = []
        for record in records:
            try:
                record_vector = json.loads(record.vector)
                score = cls._cosine_similarity(query_vector, record_vector)
                if score >= 0.25:
                    results.append({
                        "entity_id": str(record.entity_id),
                        "entity_type": record.entity_type,
                        "score": score,
                        "model": record.model,
                    })
            except Exception:
                continue

        # Sort by score descending
        results.sort(key=lambda x: x["score"], reverse=True)
        results = results[:limit]

        # Batch load full entities
        entity_map = {}
        note_ids = [r["entity_id"] for r in results if r["entity_type"] == "note"]
        transcript_ids = [r["entity_id"] for r in results if r["entity_type"] == "transcript_segment"]
        content_ids = [r["entity_id"] for r in results if r["entity_type"] == "content_index"]

        if note_ids:
            notes = db.query(Note).filter(Note.id.in_(note_ids)).all()
            entity_map.update({str(n.id): n for n in notes})
        if transcript_ids:
            segments = db.query(TranscriptSegment).filter(TranscriptSegment.id.in_(transcript_ids)).all()
            entity_map.update({str(s.id): s for s in segments})
        if content_ids:
            contents = db.query(ContentIndex).filter(ContentIndex.id.in_(content_ids)).all()
            entity_map.update({str(c.id): c for c in contents})

        # Collect resource_ids from the entities themselves
        rid_set = set()
        for eid, entity in entity_map.items():
            if hasattr(entity, 'resource_id') and entity.resource_id:
                rid_set.add(entity.resource_id)
        resource_map = {}
        if rid_set:
            from backend.app.models.resource import Course, Book
            courses = db.query(Course).filter(Course.id.in_(rid_set)).all()
            resource_map.update({c.id: (c.title, "course") for c in courses})
            books = db.query(Book).filter(Book.id.in_(rid_set)).all()
            resource_map.update({b.id: (b.title, "book") for b in books})

        # Build results with snippets
        enriched = []
        for r in results:
            eid = r["entity_id"]
            etype = r["entity_type"]
            entity = entity_map.get(eid)
            if not entity:
                continue

            snippet = ""
            title = ""
            if etype == "note":
                snippet = entity.content[:200] if entity.content else ""
                title = "Nota de Estudio"
            elif etype == "transcript_segment":
                snippet = entity.text[:200] if entity.text else ""
                title = f"Transcripción ({entity.start_time:.1f}s)"
            elif etype == "content_index":
                snippet = entity.content[:200] if entity.content else ""
                title = entity.section_name if hasattr(entity, 'section_name') and entity.section_name else "Contenido"

            rid = getattr(entity, 'resource_id', None)
            res_info = resource_map.get(rid) if rid else None

            enriched.append({
                "entity_id": eid,
                "entity_type": etype,
                "score": round(r["score"], 4),
                "title": title,
                "snippet": snippet,
                "model": r["model"],
                "resource_id": rid,
                "resource_title": res_info[0] if res_info else "",
                "resource_type": res_info[1] if res_info else "",
                # Backward compatibility keys
                "match_type": etype,
                "match_reason": title,
            })

        return enriched

    @classmethod
    def get_related_resources(cls, db: Session, resource_id, limit: int = 5) -> List[dict]:
        """Find resources conceptually related to the given resource."""
        from backend.app.models.resource import Course, Book
        from backend.app.models.content import Transcript

        # Collect all entity IDs belonging to this resource
        ci_ids = [ci.id for ci in db.query(ContentIndex.id).join(
            MediaAsset, ContentIndex.media_asset_id == MediaAsset.id
        ).filter(MediaAsset.resource_id == resource_id).all()]

        note_ids = [n.id for n in db.query(Note.id).filter(
            Note.resource_id == resource_id
        ).all()]

        ts_ids = [ts.id for ts in db.query(TranscriptSegment.id).join(
            Transcript, TranscriptSegment.transcript_id == Transcript.id
        ).join(
            MediaAsset, Transcript.media_asset_id == MediaAsset.id
        ).filter(MediaAsset.resource_id == resource_id).all()]

        all_entity_ids = ci_ids + note_ids + ts_ids
        if not all_entity_ids:
            return []

        # Load embeddings for these entities
        current_model = EmbeddingService.get_model_name()
        resource_embeddings = db.query(EmbeddingRecord).filter(
            EmbeddingRecord.entity_id.in_(all_entity_ids),
            EmbeddingRecord.model == current_model
        ).limit(30).all()

        if not resource_embeddings:
            return []

        # Compute resource fingerprint (average of all embeddings)
        all_vectors = []
        for r in resource_embeddings:
            try:
                all_vectors.append(json.loads(r.vector))
            except Exception:
                continue

        if not all_vectors:
            return []

        fingerprint = [sum(v[i] for v in all_vectors) / len(all_vectors) for i in range(len(all_vectors[0]))]

        # Compare against all other embeddings
        other_records = db.query(EmbeddingRecord).filter(
            ~EmbeddingRecord.entity_id.in_(all_entity_ids),
            EmbeddingRecord.model == current_model
        ).order_by(EmbeddingRecord.created_at.desc()).limit(3000).all()

        scores = {}
        for record in other_records:
            try:
                record_vector = json.loads(record.vector)
                score = cls._cosine_similarity(fingerprint, record_vector)
                eid = str(record.entity_id)
                if eid not in scores or score > scores[eid]:
                    scores[eid] = score
            except Exception:
                continue

        # Sort and return top results
        sorted_results = sorted(scores.items(), key=lambda x: x[1], reverse=True)[:limit]

        # Enrich with resource_id from the matched entities
        result = []
        for eid_str, score in sorted_results:
            eid = uuid.UUID(eid_str) if len(eid_str) == 36 else eid_str
            rid = None
            note = db.query(Note).filter(Note.id == eid).first()
            if note:
                rid = note.resource_id
            else:
                ci = db.query(ContentIndex).filter(ContentIndex.id == eid).first()
                if ci and ci.media_asset:
                    rid = ci.media_asset.resource_id
            result.append({"id": rid, "type": "course", "similarity": round(score, 4)})

        return result

    @classmethod
    def get_related_notes(cls, db: Session, note_id, limit: int = 5) -> List[dict]:
        """Find notes conceptually similar to the given note."""
        # Similar to get_related_resources but scoped to notes
        current_model = EmbeddingService.get_model_name()
        note_record = db.query(EmbeddingRecord).filter(
            EmbeddingRecord.entity_id == note_id,
            EmbeddingRecord.entity_type == "note",
            EmbeddingRecord.model == current_model
        ).first()

        if not note_record:
            return []

        try:
            note_vector = json.loads(note_record.vector)
        except Exception:
            return []

        other_notes = db.query(EmbeddingRecord).filter(
            EmbeddingRecord.entity_type == "note",
            EmbeddingRecord.entity_id != note_id,
            EmbeddingRecord.model == current_model
        ).all()

        results = []
        for record in other_notes:
            try:
                record_vector = json.loads(record.vector)
                score = cls._cosine_similarity(note_vector, record_vector)
                if score >= 0.10:
                    results.append({
                        "note_id": str(record.entity_id),
                        "similarity": round(score, 4),
                    })
            except Exception:
                continue

        results.sort(key=lambda x: x["similarity"], reverse=True)
        return results[:limit]

    @staticmethod
    def _cosine_similarity(a: list, b: list) -> float:
        """Compute cosine similarity between two vectors."""
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
