from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.search import SearchResultResponse
from backend.app.services.search import SearchService, DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT

router = APIRouter(prefix="/search", tags=["Search"])

@router.get("", response_model=List[SearchResultResponse])
def search(
    q: str = Query(..., min_length=1, description="Text to search for"),
    resource_type: Optional[str] = Query(None, description="Filter by resource type (course, book)"),
    limit: int = Query(DEFAULT_SEARCH_LIMIT, ge=1, le=MAX_SEARCH_LIMIT, description="Max results returned"),
    offset: int = Query(0, ge=0, description="Ranking results to skip"),
    db: Session = Depends(get_db)
):
    """
    Global search across metadata, notes, video transcripts, and extracted
    library-document content. Pagination (`limit`/`offset`) applies at the
    database level: each source fetches at most `limit + offset` rows, so one
    page never requires loading every match into memory.
    """
    return SearchService.search(
        db, query=q, resource_type=resource_type, limit=limit, offset=offset
    )
