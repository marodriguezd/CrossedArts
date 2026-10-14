import uuid
from sqlalchemy.orm import Session

from backend.app.models.resource import Course, Book
from backend.app.models.course_structure import Module, Lesson
from backend.app.models.base import ResourceStatus
from backend.app.services.progress import ProgressService

def test_course_progress_calculation(db: Session):
    course = Course(
        id=uuid.uuid4(),
        title="Curso de Prueba",
        status=ResourceStatus.NOT_STARTED
    )
    db.add(course)
    
    module = Module(
        id=uuid.uuid4(),
        course_id=course.id,
        title="Módulo 1"
    )
    db.add(module)
    
    lessons = [
        Lesson(id=uuid.uuid4(), module_id=module.id, title=f"Lección {i}", is_completed=False)
        for i in range(4)
    ]
    db.add_all(lessons)
    db.commit()

    # Progreso inicial es 0%
    progress = ProgressService.recalculate_course_progress(db, course.id)
    assert progress == 0.0
    assert course.status == ResourceStatus.NOT_STARTED

    progress = ProgressService.toggle_lesson_completion(db, lessons[0].id, True)
    assert progress == 25.0
    assert course.status == ResourceStatus.IN_PROGRESS

    for lesson in lessons[1:]:
        ProgressService.toggle_lesson_completion(db, lesson.id, True)
    
    db.refresh(course)
    assert course.status == ResourceStatus.COMPLETED


def test_book_progress_calculation(db: Session):
    book = Book(
        id=uuid.uuid4(),
        title="Libro de Prueba",
        status=ResourceStatus.NOT_STARTED,
        reading_percentage=0.0
    )
    db.add(book)
    db.commit()

    # Actualizar a 50%
    ProgressService.update_book_progress(db, book.id, 50.0)
    assert book.reading_percentage == 50.0
    assert book.status == ResourceStatus.IN_PROGRESS

    # Actualizar a 100% (debe marcar completado)
    ProgressService.update_book_progress(db, book.id, 100.0)
    assert book.reading_percentage == 100.0
    assert book.status == ResourceStatus.COMPLETED
