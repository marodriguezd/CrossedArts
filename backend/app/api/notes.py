import uuid
from typing import List
from fastapi import APIRouter, Depends, status, Response, BackgroundTasks
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.models.activity import Note
from backend.app.models.resource import LearningResource
from backend.app.schemas.note import NoteResponse, CreateNoteRequest, UpdateNoteRequest
from backend.app.services.note import NoteError, NoteService
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
    Return the notes linked to a specific learning resource.

    A resource that does not exist is a 404, not an empty list: answering 200
    `[]` claims "this resource has no notes", which is a different statement from
    "this resource does not exist" and hides the client's real mistake.
    """
    if db.get(LearningResource, resource_id) is None:
        raise get_http_exception(
            "RESOURCE_NOT_FOUND", f"El recurso con ID {resource_id} no existe."
        )
    return NoteService.list_notes_by_resource(db, resource_id)


def _schedule_note_embedding(
    background_tasks: BackgroundTasks, note_id: uuid.UUID, content: str
) -> None:
    def index_note_emb():
        from backend.app.core.database import SessionLocal
        from backend.app.services.embedding import EmbeddingService
        db_local = SessionLocal()
        try:
            EmbeddingService.index_entity(db_local, note_id, "note", content)
        finally:
            db_local.close()
    background_tasks.add_task(index_note_emb)


@router.post("/notes", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(payload: CreateNoteRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Create a new Markdown note. The resource is optional: a STANDALONE note is
    valid (same contract as the SQLite WASM frontend). A given lesson keeps its
    link. The title is part of the note contract: if the caller omits it, the
    service derives it from the content; `tags` is optional.
    """
    try:
        note = NoteService.create_note(
            db,
            payload.resource_id,
            payload.content,
            payload.lesson_id,
            title=payload.title,
            tags=payload.tags,
        )
        _schedule_note_embedding(background_tasks, note.id, payload.content)
        return note
    except NoteError as e:
        # The service already decided which code this failure deserves: a
        # missing lesson is LESSON_NOT_FOUND, not a missing resource.
        raise get_http_exception(e.code, str(e), status_code=e.http_status)


@router.patch("/notes/{note_id}", response_model=NoteResponse)
def update_note(note_id: uuid.UUID, payload: UpdateNoteRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    """
    Modifica una nota existente: contenido, título y etiquetas son opcionales y
    solo se escribe lo que llega. El embedding se reindexa únicamente cuando
    cambia el contenido, que es lo único que indexa.
    """
    try:
        note = NoteService.update_note(
            db,
            note_id,
            payload.content,
            title=payload.title,
            tags=payload.tags,
        )
        if payload.content is not None:
            _schedule_note_embedding(background_tasks, note.id, payload.content)
        return note
    except NoteError as e:
        # Not every failure while editing a note means the note is missing: a
        # content the parser cannot read is NOTE_PARSE_ERROR (422), never a 404.
        raise get_http_exception(e.code, str(e), status_code=e.http_status)


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

