import uuid
from datetime import datetime
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from backend.app.models.resource import Course, Book
from backend.app.models.course_structure import Lesson
from backend.app.models.base import ResourceStatus

class ProgressService:
    @staticmethod
    def recalculate_course_progress(db: Session, course_id: uuid.UUID) -> float:
        """
        Recalcula el progreso de un curso en función del estado de completado de sus lecciones.
        Actualiza el estado del curso a COMPLETED si todas las lecciones están completadas.
        """
        # Obtener todas las lecciones pertenecientes a los módulos del curso
        stmt = (
            select(Lesson)
            .join(Lesson.module)
            .where(Lesson.module.has(course_id=course_id))
        )
        lessons = db.scalars(stmt).all()
        
        if not lessons:
            return 0.0

        total_lessons = len(lessons)
        completed_lessons = sum(1 for lesson in lessons if lesson.is_completed)
        
        progress_percentage = (completed_lessons / total_lessons) * 100.0
        
        # Obtener el curso para actualizar su estado
        course = db.get(Course, course_id)
        if course:
            if completed_lessons == total_lessons:
                course.status = ResourceStatus.COMPLETED
            elif completed_lessons > 0:
                course.status = ResourceStatus.IN_PROGRESS
            else:
                course.status = ResourceStatus.NOT_STARTED
                
            db.add(course)
            db.commit()
            db.refresh(course)
            
        return progress_percentage

    @staticmethod
    def toggle_lesson_completion(db: Session, lesson_id: uuid.UUID, is_completed: bool) -> float:
        """
        Cambia el estado de completado de una lección y recalcula el progreso del curso asociado.
        """
        lesson = db.get(Lesson, lesson_id)
        if not lesson:
            raise ValueError(f"Lección con ID {lesson_id} no encontrada.")

        lesson.is_completed = is_completed
        db.add(lesson)
        db.flush()
        
        # Encontrar el curso asociado a través del módulo
        course_id = lesson.module.course_id
        
        if is_completed:
            from backend.app.services.workflow import WorkflowService
            WorkflowService.trigger_goal_update_from_activity(db, "complete_lesson", resource_id=course_id, change_amount=1.0)
            
        return ProgressService.recalculate_course_progress(db, course_id)

    @staticmethod
    def update_book_progress(db: Session, book_id: uuid.UUID, percentage: float) -> Book:
        """
        Actualiza manualmente el porcentaje de lectura de un libro.
        Si alcanza el 100%, cambia automáticamente el estado a COMPLETED.
        """
        if not (0.0 <= percentage <= 100.0):
            raise ValueError("El porcentaje de lectura debe estar entre 0.0 y 100.0")

        book = db.get(Book, book_id)
        if not book:
            raise ValueError(f"Libro con ID {book_id} no encontrado.")

        # Guardar porcentaje anterior para comprobar si pasa de no completado a completado
        old_completed = book.reading_percentage >= 100.0
        book.reading_percentage = percentage
        
        if percentage >= 100.0:
            book.status = ResourceStatus.COMPLETED
            if not old_completed:
                from backend.app.services.workflow import WorkflowService
                WorkflowService.trigger_goal_update_from_activity(db, "finish_book", resource_id=book_id, change_amount=1.0)
        elif percentage > 0.0:
            book.status = ResourceStatus.IN_PROGRESS
        else:
            book.status = ResourceStatus.NOT_STARTED

        db.add(book)
        db.commit()
        db.refresh(book)
        return book
