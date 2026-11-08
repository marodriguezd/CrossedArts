import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.app.core.errors import DomainError
from backend.app.models.activity import Note, derive_note_title
from backend.app.models.resource import LearningResource
from backend.app.models.course_structure import Lesson


class NoteError(DomainError):
    """A note operation failed for a reason the API must report verbatim.

    The code and the HTTP status travel WITH the error instead of being guessed
    from its message: a missing lesson used to be reported as a missing
    resource, and any failure while parsing the note's relations was reported as
    a missing note (404). Subclasses `ValueError` so existing `except
    ValueError` callers keep working.
    """

    code = "NOTE_INVALID"
    http_status = 422


class ResourceNotFoundError(NoteError):
    """The resource a note points at does not exist."""

    code = "RESOURCE_NOT_FOUND"
    http_status = 404


class LessonNotFoundError(NoteError):
    """The lesson a note points at does not exist."""

    code = "LESSON_NOT_FOUND"
    http_status = 404


class NoteNotFoundError(NoteError):
    """The note itself does not exist."""

    code = "NOTE_NOT_FOUND"
    http_status = 404


class NoteParseError(NoteError):
    """The note exists but its content could not be analysed into relations."""

    code = "NOTE_PARSE_ERROR"
    http_status = 422


def _parse_relations(db: Session, note_id: uuid.UUID) -> None:
    """Regenerate the note's concept/wikilink relations, mapping parse failures.

    Only a `ValueError` from the parser (content it cannot interpret) becomes a
    `NoteParseError`. A database failure is deliberately NOT caught: dressing it
    as a bad request would hide a server fault behind a 422.
    """
    from backend.app.services.knowledge_service import KnowledgeService

    try:
        KnowledgeService.parse_note_relations(db, note_id, commit=False)
    except ValueError as exc:
        raise NoteParseError(
            f"No se pudieron analizar las relaciones de la nota: {exc}"
        ) from exc


class NoteService:
    @staticmethod
    def create_note(
        db: Session,
        resource_id: Optional[uuid.UUID],
        content: str,
        lesson_id: Optional[uuid.UUID] = None,
        title: Optional[str] = None,
        tags: Optional[str] = None,
    ) -> Note:
        """
        Create a new note, optionally linked to a resource and a lesson.

        A STANDALONE note is valid: `resource_id=None` means "loose note", not
        "invalid data". A given resource or lesson is verified to exist so no
        ghost notes are created. The title is part of the contract (the browser
        schema requires it): when the caller omits it, it is derived from the
        content instead of being stored empty.
        """
        if resource_id is not None:
            resource = db.get(LearningResource, resource_id)
            if not resource:
                raise ResourceNotFoundError(
                    f"Recurso de aprendizaje con ID {resource_id} no encontrado."
                )

        if lesson_id:
            lesson = db.get(Lesson, lesson_id)
            if not lesson:
                raise LessonNotFoundError(f"Lección con ID {lesson_id} no encontrada.")

        note = Note(
            resource_id=resource_id,
            lesson_id=lesson_id,
            title=(title or "").strip() or derive_note_title(content),
            content=content,
            tags=tags,
        )
        db.add(note)
        db.flush()

        # Parse and store the note's concept relations without piecemeal commits.
        try:
            _parse_relations(db, note.id)
        except NoteParseError:
            # One commit point: a failed parse leaves no half-created note behind.
            db.rollback()
            raise

        db.commit()
        db.refresh(note)
        return note

    @staticmethod
    def update_note(
        db: Session,
        note_id: uuid.UUID,
        content: Optional[str] = None,
        *,
        title: Optional[str] = None,
        tags: Optional[str] = None,
    ) -> Note:
        """
        Update the fields actually provided, leaving the rest untouched.

        Partial update, same semantics as the frontend's `COALESCE`: a `None`
        field was not sent, while `tags=""` is a real value that clears tags.
        Concept relations are re-parsed only when the content changed, because
        that is the only field they depend on.
        """
        note = db.get(Note, note_id)
        if not note:
            raise NoteNotFoundError(f"Nota con ID {note_id} no encontrada.")

        if title is not None:
            # A blank title would leave the note without a headline; derive one
            # from the content instead of storing whitespace. "Not provided" is
            # checked with `is None`: an explicitly emptied content derives the
            # neutral default, not a title from the text it just lost.
            note.title = title.strip() or derive_note_title(
                note.content if content is None else content
            )
        if tags is not None:
            note.tags = tags
        content_changed = content is not None and content != note.content
        if content is not None:
            note.content = content
        db.add(note)
        db.flush()

        if content_changed:
            # Parse and store updated concept relations without piecemeal commits.
            # A parse failure rolls the edit back: the stored note keeps its
            # previous content instead of a body the graph could not read.
            try:
                _parse_relations(db, note.id)
            except NoteParseError:
                db.rollback()
                raise

        db.commit()
        db.refresh(note)
        return note

    @staticmethod
    def delete_note(db: Session, note_id: uuid.UUID) -> bool:
        """
        Delete a note by ID.
        """
        note = db.get(Note, note_id)
        if not note:
            return False

        # Drop linked connections.
        from backend.app.models.knowledge import KnowledgeConnection
        from backend.app.models.content import EmbeddingRecord
        from sqlalchemy import or_, and_
        db.query(KnowledgeConnection).filter(
            or_(
                and_(KnowledgeConnection.source_id == note_id, KnowledgeConnection.source_type == "note"),
                and_(KnowledgeConnection.target_id == note_id, KnowledgeConnection.target_type == "note")
            )
        ).delete()

        db.query(EmbeddingRecord).filter(
            and_(EmbeddingRecord.entity_id == note_id, EmbeddingRecord.entity_type == "note")
        ).delete()

        db.delete(note)
        db.commit()
        return True

    @staticmethod
    def list_notes_by_resource(db: Session, resource_id: uuid.UUID) -> List[Note]:
        """
        Return every note linked to a specific learning resource.
        """
        stmt = select(Note).where(Note.resource_id == resource_id).order_by(Note.created_at.desc())
        return list(db.scalars(stmt).all())

    @staticmethod
    def list_notes_by_lesson(db: Session, lesson_id: uuid.UUID) -> List[Note]:
        """
        Return every note linked to a specific lesson.
        """
        stmt = select(Note).where(Note.lesson_id == lesson_id).order_by(Note.created_at.desc())
        return list(db.scalars(stmt).all())
