import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.models.resource import Book
from backend.app.schemas.book import BookDetailResponse, UpdateBookProgressRequest
from backend.app.services.progress import ProgressService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/books", tags=["Books"])

@router.get("/{book_id}", response_model=BookDetailResponse)
def get_book_detail(book_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Retorna el detalle y el progreso de lectura de un libro específico.
    """
    book = db.get(Book, book_id)
    if not book:
        raise get_http_exception("BOOK_NOT_FOUND", f"El libro con ID {book_id} no existe.")
    return book


@router.patch("/{book_id}/progress", response_model=BookDetailResponse)
def update_book_progress(
    book_id: uuid.UUID,
    payload: UpdateBookProgressRequest,
    db: Session = Depends(get_db)
):
    """
    Actualiza manualmente el porcentaje de lectura de un libro e infiere el estado final de completado.
    """
    try:
        updated_book = ProgressService.update_book_progress(db, book_id, payload.reading_percentage)
        return updated_book
    except ValueError as e:
        raise get_http_exception("BOOK_NOT_FOUND", str(e), status_code=status.HTTP_400_BAD_REQUEST)
