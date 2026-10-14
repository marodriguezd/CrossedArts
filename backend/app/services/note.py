import uuid
from typing import List, Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.app.models.activity import Note
from backend.app.models.resource import LearningResource
from backend.app.models.course_structure import Lesson

class NoteService:
    @staticmethod
    def create_note(
        db: Session,
        resource_id: Optional[uuid.UUID],
        content: str,
        lesson_id: Optional[uuid.UUID] = None
    ) -> Note:
        """
        Create a new note, optionally linked to a resource and a lesson.

        A STANDALONE note is valid: `resource_id=None` means "loose note", not
        "invalid data". A given resource or lesson is verified to exist so no
        ghost notes are created.
        """
        if resource_id is not None:
            resource = db.get(LearningResource, resource_id)
            if not resource:
                raise ValueError(f"Recurso de aprendizaje con ID {resource_id} no encontrado.")

        if lesson_id:
            lesson = db.get(Lesson, lesson_id)
            if not lesson:
                raise ValueError(f"Lección con ID {lesson_id} no encontrada.")

        note = Note(
            resource_id=resource_id,
            lesson_id=lesson_id,
            content=content
        )
        db.add(note)
        db.flush()

        # Parse and store the note's concept relations without piecemeal commits.
        from backend.app.services.knowledge_service import KnowledgeService
        KnowledgeService.parse_note_relations(db, note.id, commit=False)

        db.commit()
        db.refresh(note)
        return note

    @staticmethod
    def update_note(db: Session, note_id: uuid.UUID, content: str) -> Note:
        """
        Update an existing note's content.
        """
        note = db.get(Note, note_id)
        if not note:
            raise ValueError(f"Nota con ID {note_id} no encontrada.")

        note.content = content
        db.add(note)
        db.flush()

        # Parse and store updated concept relations without piecemeal commits.
        from backend.app.services.knowledge_service import KnowledgeService
        KnowledgeService.parse_note_relations(db, note.id, commit=False)

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
