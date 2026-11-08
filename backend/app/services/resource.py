import uuid
import shutil
from typing import List, Optional
from sqlalchemy.orm import Session
from sqlalchemy import select, desc, or_

from backend.app.core.settings import settings
from backend.app.core.logging import get_logger
from backend.app.models.resource import LearningResource, MediaAsset
from backend.app.models.content import EmbeddingRecord, ContentIndex, TranscriptSegment, Transcript
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.knowledge import KnowledgeConnection
from backend.app.models.base import ResourceStatus, CourseDifficulty
from backend.app.schemas.resource import UpdateResourceRequest

logger = get_logger("services.resource")


class ResourceService:
    @staticmethod
    def list_resources(
        db: Session,
        type: Optional[str] = None,
        status: Optional[ResourceStatus] = None
    ) -> List[LearningResource]:
        """List all learning resources with dynamic filters."""
        stmt = select(LearningResource)
        if type:
            stmt = stmt.where(LearningResource.type == type)
        if status:
            stmt = stmt.where(LearningResource.status == status)
        stmt = stmt.order_by(desc(LearningResource.updated_at))
        return list(db.scalars(stmt).all())

    @staticmethod
    def list_in_progress(db: Session) -> List[LearningResource]:
        """Return currently in-progress learning resources."""
        stmt = (
            select(LearningResource)
            .where(LearningResource.status == ResourceStatus.IN_PROGRESS)
            .order_by(desc(LearningResource.updated_at))
        )
        return list(db.scalars(stmt).all())

    @staticmethod
    def list_recent(db: Session, limit: int = 5) -> List[LearningResource]:
        """Return recently accessed resources bounded by limit."""
        stmt = select(LearningResource).order_by(desc(LearningResource.updated_at)).limit(limit)
        return list(db.scalars(stmt).all())

    @staticmethod
    def get_resource(db: Session, resource_id: uuid.UUID) -> Optional[LearningResource]:
        """Fetch a learning resource by ID."""
        return db.get(LearningResource, resource_id)

    @staticmethod
    def update_resource(
        db: Session,
        resource_id: uuid.UUID,
        payload: UpdateResourceRequest
    ) -> Optional[LearningResource]:
        """
        Update a learning resource's metadata: title, category, description,
        cover, status, and type-specific fields.
        """
        resource = db.get(LearningResource, resource_id)
        if not resource:
            return None

        if payload.title is not None:
            resource.title = payload.title
        if payload.category is not None:
            resource.category = payload.category or "General"
        if payload.description is not None:
            resource.description = payload.description
        if "cover_path" in payload.model_fields_set:
            resource.cover_path = payload.cover_path
        if payload.status is not None:
            resource.status = payload.status

        if resource.type == "course" and payload.difficulty is not None:
            diff_str = payload.difficulty.upper()
            if diff_str in CourseDifficulty.__members__:
                resource.difficulty = CourseDifficulty[diff_str]

        if resource.type == "book" and payload.author is not None:
            resource.author = payload.author

        db.add(resource)
        db.commit()
        db.refresh(resource)
        return resource

    @staticmethod
    def delete_resource(db: Session, resource_id: uuid.UUID) -> bool:
        """
        Delete a learning resource and the data it owns (modules, lessons, media
        assets and their derived content). User work is NOT destroyed: notes and
        study sessions survive, unlinked by the database (`ON DELETE SET NULL`), as
        the domain contract requires; a session's effective scope is re-derived on
        read.

        The rows are committed BEFORE the linked files are removed: the opposite
        order loses the files of a delete whose commit failed, leaving live rows
        pointing at a folder that no longer exists.
        """
        resource = db.get(LearningResource, resource_id)
        if not resource:
            return False

        media_asset_ids = db.scalars(
            select(MediaAsset.id).where(MediaAsset.resource_id == resource_id)
        ).all()

        content_index_ids: List[uuid.UUID] = []
        transcript_segment_ids: List[uuid.UUID] = []
        if media_asset_ids:
            content_index_ids = list(db.scalars(
                select(ContentIndex.id).where(ContentIndex.media_asset_id.in_(media_asset_ids))
            ).all())
            transcript_segment_ids = list(db.scalars(
                select(TranscriptSegment.id)
                .join(Transcript)
                .where(Transcript.media_asset_id.in_(media_asset_ids))
            ).all())

        lesson_ids = list(db.scalars(
            select(Lesson.id)
            .join(Module)
            .where(Module.course_id == resource_id)
        ).all())

        target_ids = (
            list(media_asset_ids)
            + content_index_ids
            + transcript_segment_ids
            + lesson_ids
            + [resource_id]
        )

        if target_ids:
            # Chunk in 500s to stay under SQLite's variable limit (999).
            chunk_size = 500
            for i in range(0, len(target_ids), chunk_size):
                chunk = target_ids[i:i + chunk_size]
                db.query(EmbeddingRecord).filter(
                    EmbeddingRecord.entity_id.in_(chunk)
                ).delete(synchronize_session=False)
                db.query(KnowledgeConnection).filter(
                    or_(
                        KnowledgeConnection.source_id.in_(chunk),
                        KnowledgeConnection.target_id.in_(chunk)
                    )
                ).delete(synchronize_session=False)

        db.delete(resource)
        db.commit()

        # Purge physical files only once the rows are gone.
        storage_dir = settings.media_dir / str(resource_id)
        if storage_dir.exists() and storage_dir.is_dir():
            try:
                shutil.rmtree(storage_dir)
            except Exception as e:
                logger.warning("No se pudo eliminar la carpeta física %s: %s", storage_dir, e)

        return True
