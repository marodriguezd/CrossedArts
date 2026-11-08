"""Reading progress reports the failure it actually had.

`PATCH /books/{id}/progress` mapped ANY `ValueError` to `BOOK_NOT_FOUND` with
400, so a percentage outside 0..100 told the client its book did not exist. The
toggle endpoint had the mirror problem: everything was `LESSON_NOT_FOUND`.
These tests pin the mapping that now travels with the error (`ProgressError`).
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Book, Course
from backend.app.services.progress import ProgressService, ReadingPercentageInvalid


def _error(response) -> dict:
    return response.json()["detail"]["error"]


def _course_with_lesson(db: Session) -> Lesson:
    course = Course(
        id=uuid.uuid4(), title="Curso Progreso", status=ResourceStatus.NOT_STARTED
    )
    module = Module(
        id=uuid.uuid4(), course_id=course.id, title="Módulo", order_index=1
    )
    lesson = Lesson(
        id=uuid.uuid4(),
        module_id=module.id,
        title="Lección",
        duration_minutes=10,
        is_completed=False,
        order_index=1,
    )
    db.add_all([course, module, lesson])
    db.commit()
    return lesson


def test_progress_on_a_missing_book_names_the_book(client: TestClient):
    missing = uuid.uuid4()
    response = client.patch(
        f"/api/v1/books/{missing}/progress", json={"reading_percentage": 10.0}
    )

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "BOOK_NOT_FOUND"


def test_percentage_out_of_range_is_not_a_missing_book(client: TestClient, db: Session):
    """The book exists; the number is what is wrong.

    Over HTTP the range is rejected by Pydantic (`ge=0.0, le=100.0`), so the
    answer is a 422 validation body — never the 404 `BOOK_NOT_FOUND` the blanket
    handler used to return. The service keeps its own guard for direct callers,
    which carries `READING_PERCENTAGE_INVALID` (asserted separately below).
    """
    book = Book(id=uuid.uuid4(), title="Libro existente", reading_percentage=0.0)
    db.add(book)
    db.commit()

    for invalid in (150.0, -1.0):
        response = client.patch(
            f"/api/v1/books/{book.id}/progress",
            json={"reading_percentage": invalid},
        )
        assert response.status_code == 422, response.text
        body = response.json()
        assert "error" not in str(body.get("detail", "")) or (
            body["detail"]["error"]["code"] != "BOOK_NOT_FOUND"
        ), "un porcentaje fuera de rango no puede presentarse como un libro inexistente"

    stored = client.get(f"/api/v1/books/{book.id}").json()
    assert stored["reading_percentage"] == 0.0, (
        "un porcentaje rechazado no puede dejar el libro modificado"
    )


def test_service_rejects_out_of_range_with_its_own_code(db: Session):
    """Direct callers get the code too, not a bare ValueError."""
    book = Book(id=uuid.uuid4(), title="Libro directo", reading_percentage=0.0)
    db.add(book)
    db.commit()

    with pytest.raises(ReadingPercentageInvalid) as raised:
        ProgressService.update_book_progress(db, book.id, 150.0)

    assert raised.value.code == "READING_PERCENTAGE_INVALID"
    assert raised.value.http_status == 422


def test_valid_progress_still_updates_the_book(client: TestClient, db: Session):
    book = Book(id=uuid.uuid4(), title="Libro medido", reading_percentage=0.0)
    db.add(book)
    db.commit()

    response = client.patch(
        f"/api/v1/books/{book.id}/progress", json={"reading_percentage": 42.5}
    )

    assert response.status_code == 200, response.text
    assert response.json()["reading_percentage"] == 42.5


def test_toggle_on_a_missing_lesson_names_the_lesson(client: TestClient):
    missing = uuid.uuid4()
    response = client.post(
        f"/api/v1/lessons/{missing}/toggle-complete", json={"is_completed": True}
    )

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "LESSON_NOT_FOUND"


def test_toggle_on_a_real_lesson_still_works(client: TestClient, db: Session):
    lesson = _course_with_lesson(db)
    response = client.post(
        f"/api/v1/lessons/{lesson.id}/toggle-complete", json={"is_completed": True}
    )

    assert response.status_code == 200, response.text
    assert response.json()["is_completed"] is True
