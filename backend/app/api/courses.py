import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.database import get_db
from backend.app.models.resource import Course
from backend.app.schemas.course import CourseDetailResponse, ToggleLessonRequest
from backend.app.services.progress import ProgressService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(tags=["Courses"])

@router.get("/courses/{course_id}", response_model=CourseDetailResponse)
def get_course_detail(course_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Retorna la estructura jerárquica completa de un curso (módulos, lecciones y tareas).
    """
    # Usar Joined Load o consulta directa. SQLAlchemy mapea las relaciones automáticamente
    course = db.get(Course, course_id)
    if not course:
        raise get_http_exception("COURSE_NOT_FOUND", f"El curso con ID {course_id} no existe.")
    return course


@router.post("/lessons/{lesson_id}/toggle-complete")
def toggle_lesson_completion(
    lesson_id: uuid.UUID,
    payload: ToggleLessonRequest,
    db: Session = Depends(get_db)
):
    """
    Marca una lección específica como completada o pendiente y actualiza el progreso del curso asociado.
    """
    try:
        new_progress = ProgressService.toggle_lesson_completion(db, lesson_id, payload.is_completed)
        return {
            "lesson_id": lesson_id,
            "is_completed": payload.is_completed,
            "course_progress_percentage": new_progress
        }
    except ValueError as e:
        raise get_http_exception("LESSON_NOT_FOUND", str(e))
