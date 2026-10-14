from typing import List, Optional
from fastapi import APIRouter, Depends, Query, BackgroundTasks, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
import uuid

from backend.app.core.database import get_db
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
    q: str = Query(..., min_length=1, description="Semantic query text"),
    resource_type: Optional[str] = Query(None, description="Filter by type (course, book)"),
    limit: int = Query(20, ge=1, le=100, description="Max results returned"),
    offset: int = Query(0, ge=0, description="Ranking results to skip"),
    db: Session = Depends(get_db)
):
    """
    Semantic concept search over the CrossedArts library. Pagination
    (`limit`/`offset`) applies over the similarity ranking: top-k stays bounded
    in memory and the full embedding collection is never materialized.
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
        # `SessionLocal` is imported inside the function: tests patch
        # `backend.app.core.database.SessionLocal` so background work ALWAYS
        # uses the test database.
        from backend.app.core.database import SessionLocal as session_factory
        db = session_factory()
        try:
            EmbeddingService.index_all_unindexed(db)
        finally:
            db.close()

    background_tasks.add_task(run_reindex)
    return {"status": "accepted", "message": "Reindexing started in background"}
