import uuid
from sqlalchemy import select
from sqlalchemy.orm import Session
from backend.app.models.resource import Course, Book
from backend.app.models.course_structure import Lesson
from backend.app.models.base import ResourceStatus

class ProgressService:
    @staticmethod
    def recalculate_course_progress(db: Session, course_id: uuid.UUID) -> float:
        """
        Recalculate a course's progress from its lessons' completion state.
        Sets the course to COMPLETED when every lesson is done.
        """
        # Fetch every lesson in the course's modules.
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

        # Fetch the course to update its status.
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
        Toggle a lesson's completion state and recalculate its course progress.
        """
        lesson = db.get(Lesson, lesson_id)
        if not lesson:
            raise ValueError(f"Lección con ID {lesson_id} no encontrada.")

        lesson.is_completed = is_completed
        db.add(lesson)
        db.flush()

        # Find the course via the module.
        course_id = lesson.module.course_id

        if is_completed:
            from backend.app.services.workflow import WorkflowService
            WorkflowService.trigger_goal_update_from_activity(db, "complete_lesson", resource_id=course_id, change_amount=1.0)

        return ProgressService.recalculate_course_progress(db, course_id)

    @staticmethod
    def update_book_progress(db: Session, book_id: uuid.UUID, percentage: float) -> Book:
        """
        Manually update a book's reading percentage. Reaching 100% flips the
        status to COMPLETED automatically.
        """
        if not (0.0 <= percentage <= 100.0):
            raise ValueError("El porcentaje de lectura debe estar entre 0.0 y 100.0")

        book = db.get(Book, book_id)
        if not book:
            raise ValueError(f"Libro con ID {book_id} no encontrado.")

        # Remember the previous value to detect the incomplete -> completed flip.
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
