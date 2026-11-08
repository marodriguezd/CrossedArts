import uuid
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.models.base import ResourceStatus
from backend.app.schemas.resource import ResourceResponse, UpdateResourceRequest
from backend.app.services.resource import ResourceService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/resources", tags=["Resources"])


@router.get("", response_model=List[ResourceResponse])
def list_resources(
    type: Optional[str] = Query(None, description="Filter by type: 'course' or 'book'"),
    status: Optional[ResourceStatus] = Query(None, description="Filter by progress status"),
    db: Session = Depends(get_db)
):
    """
    List all learning resources with dynamic filters.
    """
    return ResourceService.list_resources(db, type=type, status=status)


@router.get("/in-progress", response_model=List[ResourceResponse])
def list_in_progress_resources(db: Session = Depends(get_db)):
    """
    Return the currently in-progress learning resources.
    """
    return ResourceService.list_in_progress(db)


@router.get("/recent", response_model=List[ResourceResponse])
def list_recent_resources(
    limit: int = Query(5, ge=1, le=100, description="Max resources to return"),
    db: Session = Depends(get_db)
):
    """
    Return recently accessed resources. The limit is bounded (1..100): an
    unbounded value would let one response dump the whole catalog, a trivial
    abuse vector instead of a paginated endpoint.
    """
    return ResourceService.list_recent(db, limit=limit)


@router.get("/{resource_id}", response_model=ResourceResponse)
def get_resource(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Obtiene el detalle base de un recurso de aprendizaje por su ID.
    """
    resource = ResourceService.get_resource(db, resource_id)
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
    Update a learning resource's metadata: title, category, description, cover,
    status, and type-specific fields (difficulty for courses, author for books).
    """
    resource = ResourceService.update_resource(db, resource_id, payload)
    if not resource:
        raise get_http_exception("RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe.")
    return resource


@router.delete("/{resource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_resource(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Delete a learning resource and the data it owns (modules, lessons, media
    assets and their derived content). User work is NOT destroyed: notes and
    study sessions survive, unlinked by the database (`ON DELETE SET NULL`), as
    the domain contract requires; a session's effective scope is re-derived on
    read.
    """
    success = ResourceService.delete_resource(db, resource_id)
    if not success:
        raise get_http_exception("RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe.")

