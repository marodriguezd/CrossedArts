from typing import List, Optional
from fastapi import APIRouter, Depends, Query, BackgroundTasks, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid

from backend.app.core.database import get_db, SessionLocal
from backend.app.services.semantic_search import SemanticSearchService
from backend.app.services.embedding import EmbeddingService

router = APIRouter(prefix="/semantic", tags=["Semantic"])

class SemanticSearchResultResponse(BaseModel):
    resource_id: uuid.UUID
    resource_title: str
    resource_type: str
    match_type: str
    snippet: str
    score: float
    match_reason: str

@router.get("/search", response_model=List[SemanticSearchResultResponse])
def semantic_search(
    q: str = Query(..., min_length=1, description="Texto de consulta semántica"),
    resource_type: Optional[str] = Query(None, description="Filtrar por tipo (course, book)"),
    limit: int = Query(20, ge=1, le=100, description="Máximo de resultados devueltos"),
    offset: int = Query(0, ge=0, description="Resultados a omitir del ranking"),
    db: Session = Depends(get_db)
):
    """
    Realiza una búsqueda semántica de conceptos sobre la biblioteca de CrossedArts.

    La paginación (`limit`/`offset`) se aplica sobre el ranking de similitud: el
    top-k se mantiene acotado en memoria y nunca se materializa la colección
    completa de embeddings (A-4/A-8).
    """
    return SemanticSearchService.search(
        db, query=q, limit=limit, offset=offset, resource_type=resource_type
    )

@router.post("/reindex", status_code=status.HTTP_202_ACCEPTED)
def trigger_reindex(background_tasks: BackgroundTasks):
    """
    Genera embeddings en lote para todo el contenido no indexado en la base de datos en segundo plano.
    """
    def run_reindex():
        # `SessionLocal` se importa dentro de la función: las pruebas parchean
        # `backend.app.core.database.SessionLocal` para que el trabajo en
        # segundo plano use SIEMPRE la base de datos de prueba (A-1).
        from backend.app.core.database import SessionLocal as session_factory
        db = session_factory()
        try:
            EmbeddingService.index_all_unindexed(db)
        finally:
            db.close()

    background_tasks.add_task(run_reindex)
    return {"status": "accepted", "message": "Reindexing started in background"}
