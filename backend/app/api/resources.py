import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import select, desc

from backend.app.core.database import get_db
from backend.app.core.settings import settings
from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.base import ResourceStatus
from backend.app.schemas.resource import ResourceResponse, CourseBaseResponse, BookBaseResponse, UpdateResourceRequest
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/resources", tags=["Resources"])

@router.get("", response_model=List[ResourceResponse])
def list_resources(
    type: Optional[str] = Query(None, description="Filtro por tipo: 'course' o 'book'"),
    status: Optional[ResourceStatus] = Query(None, description="Filtro por estado de progreso"),
    db: Session = Depends(get_db)
):
    """
    Lista todos los recursos de aprendizaje con filtros dinámicos.
    """
    stmt = select(LearningResource)
    
    if type:
        stmt = stmt.where(LearningResource.type == type)
    if status:
        stmt = stmt.where(LearningResource.status == status)
        
    stmt = stmt.order_by(desc(LearningResource.updated_at))
    return list(db.scalars(stmt).all())


@router.get("/in-progress", response_model=List[ResourceResponse])
def list_in_progress_resources(db: Session = Depends(get_db)):
    """
    Retorna la lista de recursos de aprendizaje actualmente en curso.
    """
    stmt = (
        select(LearningResource)
        .where(LearningResource.status == ResourceStatus.IN_PROGRESS)
        .order_by(desc(LearningResource.updated_at))
    )
    return list(db.scalars(stmt).all())


@router.get("/recent", response_model=List[ResourceResponse])
def list_recent_resources(
    limit: int = Query(5, description="Número máximo de recursos a retornar"),
    db: Session = Depends(get_db)
):
    """
    Retorna los recursos accedidos recientemente.
    """
    stmt = select(LearningResource).order_by(desc(LearningResource.updated_at)).limit(limit)
    return list(db.scalars(stmt).all())


@router.get("/{resource_id}", response_model=ResourceResponse)
def get_resource(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Obtiene el detalle base de un recurso de aprendizaje por su ID.
    """
    resource = db.get(LearningResource, resource_id)
    if not resource:
        raise get_http_exception("RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe.")
    return resource


@router.get("/{resource_id}/related")
def get_related_resources(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Retorna recursos recomendados relacionados conceptualmente.
    """
    from backend.app.services.semantic_search import SemanticSearchService
    return SemanticSearchService.get_related_resources(db, resource_id)


@router.patch("/{resource_id}", response_model=ResourceResponse)
def update_resource(
    resource_id: uuid.UUID,
    payload: UpdateResourceRequest,
    db: Session = Depends(get_db)
):
    """
    Actualiza los metadatos de un recurso de aprendizaje: título, categoría, descripción,
    portada, estado y campos específicos de tipo (dificultad para cursos, autor para libros).
    """
    resource = db.get(LearningResource, resource_id)
    if not resource:
        raise get_http_exception("RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe.")

    # Campos genéricos editables
    if payload.title is not None:
        resource.title = payload.title
    if payload.category is not None:
        resource.category = payload.category or "General"
    if payload.description is not None:
        resource.description = payload.description
    if "cover_path" in payload.model_fields_set:
        resource.cover_path = payload.cover_path

    # Status validado por Pydantic (ya es ResourceStatus o None)
    if payload.status is not None:
        resource.status = payload.status

    # Campos específicos de Course
    if resource.type == "course" and payload.difficulty is not None:
        from backend.app.models.base import CourseDifficulty
        diff_str = payload.difficulty.upper()
        if diff_str in CourseDifficulty.__members__:
            resource.difficulty = CourseDifficulty[diff_str]

    # Campos específicos de Book
    if resource.type == "book" and payload.author is not None:
        resource.author = payload.author

    db.add(resource)
    db.commit()
    db.refresh(resource)
    return resource


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Elimina un recurso de aprendizaje y todos sus datos asociados (módulos, lecciones, assets, notas, sesiones).
    La eliminación es en cascada por las relaciones configuradas en los modelos.
    """
    resource = db.get(LearningResource, resource_id)
    if not resource:
        raise get_http_exception("RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe.")

    # Fetch IDs of Note, MediaAsset, ContentIndex, TranscriptSegment, and Lesson related to this resource
    from backend.app.models.activity import Note
    from backend.app.models.resource import MediaAsset
    from backend.app.models.content import EmbeddingRecord, ContentIndex, TranscriptSegment, Transcript
    from backend.app.models.course_structure import Lesson, Module
    from backend.app.models.knowledge import KnowledgeConnection
    from sqlalchemy import or_, and_, select

    note_ids = db.scalars(select(Note.id).where(Note.resource_id == resource_id)).all()
    media_asset_ids = db.scalars(select(MediaAsset.id).where(MediaAsset.resource_id == resource_id)).all()

    content_index_ids = []
    transcript_segment_ids = []
    if media_asset_ids:
        content_index_ids = db.scalars(
            select(ContentIndex.id).where(ContentIndex.media_asset_id.in_(media_asset_ids))
        ).all()
        transcript_segment_ids = db.scalars(
            select(TranscriptSegment.id)
            .join(Transcript)
            .where(Transcript.media_asset_id.in_(media_asset_ids))
        ).all()

    lesson_ids = db.scalars(
        select(Lesson.id)
        .join(Module)
        .where(Module.course_id == resource_id)
    ).all()

    # Collect all related IDs plus the resource ID itself to prevent any orphan records
    target_ids = list(note_ids) + list(media_asset_ids) + list(content_index_ids) + list(transcript_segment_ids) + list(lesson_ids) + [resource_id]

    if target_ids:
        # Dividir en chunks de 500 para evitar superar el límite de variables de SQLite (999)
        chunk_size = 500
        for i in range(0, len(target_ids), chunk_size):
            chunk = target_ids[i:i + chunk_size]
            db.query(EmbeddingRecord).filter(EmbeddingRecord.entity_id.in_(chunk)).delete(synchronize_session=False)
            db.query(KnowledgeConnection).filter(
                or_(
                    KnowledgeConnection.source_id.in_(chunk),
                    KnowledgeConnection.target_id.in_(chunk)
                )
            ).delete(synchronize_session=False)

    db.delete(resource)

    # Eliminar archivos físicos asociados
    import shutil
    from pathlib import Path
    storage_dir = settings.media_dir / str(resource_id)
    if storage_dir.exists() and storage_dir.is_dir():
        try:
            shutil.rmtree(storage_dir)
        except Exception as e:
            print(f"[delete_resource] Warning: No se pudo eliminar la carpeta física {storage_dir}: {e}")

    db.commit()

