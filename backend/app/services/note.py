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
        Crea una nueva nota, opcionalmente asociada a un recurso y a una lección.

        La nota AUTÓNOMA es válida: `resource_id=None` significa "nota suelta",
        no "dato inválido". Si se indica un recurso o una lección, se verifica
        que existan para no crear notas fantasma.
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

        # Analizar y guardar relaciones conceptuales de la nota sin confirmar de forma fragmentada
        from backend.app.services.knowledge_service import KnowledgeService
        KnowledgeService.parse_note_relations(db, note.id, commit=False)

        db.commit()
        db.refresh(note)
        return note

    @staticmethod
    def update_note(db: Session, note_id: uuid.UUID, content: str) -> Note:
        """
        Actualiza el contenido de una nota existente.
        """
        note = db.get(Note, note_id)
        if not note:
            raise ValueError(f"Nota con ID {note_id} no encontrada.")

        note.content = content
        db.add(note)
        db.flush()

        # Analizar y guardar relaciones conceptuales actualizadas sin confirmar de forma fragmentada
        from backend.app.services.knowledge_service import KnowledgeService
        KnowledgeService.parse_note_relations(db, note.id, commit=False)

        db.commit()
        db.refresh(note)
        return note

    @staticmethod
    def delete_note(db: Session, note_id: uuid.UUID) -> bool:
        """
        Elimina una nota por su ID.
        """
        note = db.get(Note, note_id)
        if not note:
            return False

        # Eliminar conexiones asociadas
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
        Retorna todas las notas vinculadas a un recurso de aprendizaje específico.
        """
        stmt = select(Note).where(Note.resource_id == resource_id).order_by(Note.created_at.desc())
        return list(db.scalars(stmt).all())

    @staticmethod
    def list_notes_by_lesson(db: Session, lesson_id: uuid.UUID) -> List[Note]:
        """
        Retorna todas las notas específicas vinculadas a una lección concreta.
        """
        stmt = select(Note).where(Note.lesson_id == lesson_id).order_by(Note.created_at.desc())
        return list(db.scalars(stmt).all())
