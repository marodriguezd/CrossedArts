from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.search import SearchResultResponse
from backend.app.services.search import SearchService

router = APIRouter(prefix="/search", tags=["Search"])

@router.get("", response_model=List[SearchResultResponse])
def search(
    q: str = Query(..., min_length=1, description="Texto a buscar"),
    resource_type: Optional[str] = Query(None, description="Filtrar por tipo de recurso (course, book)"),
    db: Session = Depends(get_db)
):
    """
    Endpoint de búsqueda global para encontrar coincidencias en metadatos, notas,
    transcripciones de video y contenido extraído de documentos de la biblioteca.
    """
    return SearchService.search(db, query=q, resource_type=resource_type)
