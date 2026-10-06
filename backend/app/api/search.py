from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.search import SearchResultResponse
from backend.app.services.search import SearchService, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT

router = APIRouter(prefix="/search", tags=["Search"])

@router.get("", response_model=List[SearchResultResponse])
def search(
    q: str = Query(..., min_length=1, description="Texto a buscar"),
    resource_type: Optional[str] = Query(None, description="Filtrar por tipo de recurso (course, book)"),
    limit: int = Query(DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT, description="Máximo de resultados devueltos"),
    offset: int = Query(0, ge=0, description="Resultados a omitir del ranking"),
    db: Session = Depends(get_db)
):
    """
    Endpoint de búsqueda global para encontrar coincidencias en metadatos, notas,
    transcripciones de video y contenido extraído de documentos de la biblioteca.

    La paginación (`limit`/`offset`) se aplica a nivel de base de datos: cada
    fuente consulta como mucho `limit + offset` filas, así que responder una
    página no exige cargar en memoria todas las coincidencias (A-8).
    """
    return SearchService.search(
        db, query=q, resource_type=resource_type, limit=limit, offset=offset
    )
