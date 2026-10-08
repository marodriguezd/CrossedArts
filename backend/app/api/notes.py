import uuid
from typing import List
from fastapi import APIRouter, Depends, status, Response, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.models.activity import Note
from backend.app.schemas.note import NoteResponse, CreateNoteRequest, UpdateNoteRequest
from backend.app.services.note import NoteService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(tags=["Notes"])

@router.get("/notes", response_model=List[NoteResponse])
def list_all_notes(db: Session = Depends(get_db)):
    """
    Retorna la lista de todas las notas creadas por el usuario en el sistema.
    """
    stmt = select(Note).order_by(Note.updated_at.desc())
    return list(db.scalars(stmt).all())


@router.get("/resources/{resource_id}/notes", response_model=List[NoteResponse])
def list_notes_by_resource(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Retorna la lista de notas asociadas a un recurso de aprendizaje específico.
    """
    return NoteService.list_notes_by_resource(db, resource_id)


@router.post("/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(payload: CreateNoteRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Crea una nueva anotación Markdown.

    El recurso es opcional: una nota AUTÓNOMA es válida (mismo contrato que el
    frontend SQLite WASM). Si se indica lección, su vínculo se conserva.
    """
    try:
        note = NoteService.create_note(
            db,
            payload.resource_id,
            payload.content,
            payload.lesson_id
        )
        def index_note_emb():
            from backend.app.core.database import SessionLocal
            from backend.app.services.embedding import EmbeddingService
            db_local = SessionLocal()
            try:
                EmbeddingService.index_entity(db_local, note.id, "note", payload.content)
            finally:
                db_local.close()
        background_tasks.add_task(index_note_emb)
        return note
    except ValueError as e:
        raise get_http_exception("RESOURCE_NOT_FOUND", str(e), status_code=status.HTTP_400_BAD_REQUEST)


@router.patch("/notes/{note_id}", response_model=NoteResponse)
def update_note(note_id: uuid.UUID, payload: UpdateNoteRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Modifica el contenido de una nota existente.
    """
    try:
        note = NoteService.update_note(db, note_id, payload.content)
        def index_note_emb():
            from backend.app.core.database import SessionLocal
            from backend.app.services.embedding import EmbeddingService
            db_local = SessionLocal()
            try:
                EmbeddingService.index_entity(db_local, note.id, "note", payload.content)
            finally:
                db_local.close()
        background_tasks.add_task(index_note_emb)
        return note
    except ValueError as e:
        raise get_http_exception("NOTE_NOT_FOUND", str(e))


@router.delete("/notes/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(note_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Elimina una nota por su identificador.
    """
    deleted = NoteService.delete_note(db, note_id)
    if not deleted:
        raise get_http_exception("NOTE_NOT_FOUND", f"La nota con ID {note_id} no existe.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/notes/{note_id}/related")
def get_related_notes(note_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Retorna anotaciones relacionadas conceptualmente.
    """
    from backend.app.services.semantic_search import SemanticSearchService
    return SemanticSearchService.get_related_notes(db, note_id)

