"""Study sessions report the failure they actually had.

`POST /sessions/start` answered `RESOURCE_NOT_FOUND` with a 400 for EVERY
`ValueError` the service raised, so a nonexistent LESSON was reported as a
missing resource and the status contradicted the code. These tests pin the
mapping that now travels with the error (`SessionError.code` / `http_status`):
the anchor that failed is the anchor the code names, and a session id that does
not exist is a 404 `SESSION_NOT_FOUND`, not a broken request.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Book, Course
from backend.app.services.session import SessionScopeError, SessionService


def _error(response) -> dict:
    return response.json()["detail"]["error"]


def _course_with_lesson(db: Session) -> Lesson:
    course = Course(
        id=uuid.uuid4(), title="Curso Sesiones", status=ResourceStatus.NOT_STARTED
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


def test_start_with_a_missing_resource_names_the_resource(client: TestClient):
    missing = uuid.uuid4()
    response = client.post("/api/v1/sessions/start", json={"resource_id": str(missing)})

    assert response.status_code == 404, response.text
    error = _error(response)
    assert error["code"] == "RESOURCE_NOT_FOUND"
    assert str(missing) in error["message"]


def test_start_with_a_missing_lesson_names_the_lesson(client: TestClient):
    """The lesson was the broken anchor: the code must say lesson."""
    missing = uuid.uuid4()
    response = client.post("/api/v1/sessions/start", json={"lesson_id": str(missing)})

    assert response.status_code == 404, response.text
    error = _error(response)
    assert error["code"] == "LESSON_NOT_FOUND", (
        f"una lección inexistente no es un recurso inexistente: {error['code']}"
    )
    assert "Lección" in error["message"]


def test_start_on_a_real_resource_still_works(client: TestClient, db: Session):
    """The stricter mapping must not reject a coherent anchor."""
    book = Book(id=uuid.uuid4(), title="Libro real", reading_percentage=0.0)
    db.add(book)
    db.commit()

    response = client.post("/api/v1/sessions/start", json={"resource_id": str(book.id)})

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["scope"] == "resource"
    assert body["effective_scope"] == "resource"


def test_start_on_a_real_lesson_scopes_the_session_to_the_lesson(
    client: TestClient, db: Session
):
    lesson = _course_with_lesson(db)
    response = client.post("/api/v1/sessions/start", json={"lesson_id": str(lesson.id)})

    assert response.status_code == 201, response.text
    assert response.json()["scope"] == "lesson"


def test_missing_session_on_heartbeat_is_a_session_404(client: TestClient):
    missing = uuid.uuid4()
    response = client.post(f"/api/v1/sessions/{missing}/heartbeat")

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "SESSION_NOT_FOUND"


def test_missing_session_on_end_is_a_session_404(client: TestClient):
    missing = uuid.uuid4()
    response = client.post(f"/api/v1/sessions/{missing}/end")

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "SESSION_NOT_FOUND"


def test_incoherent_declared_scope_is_its_own_code(db: Session):
    """The request schema rejects the same thing as a 422; at the service level
    the failure also carries its own code instead of pretending an anchor is
    missing."""
    book = Book(id=uuid.uuid4(), title="Libro con ámbito", reading_percentage=0.0)
    db.add(book)
    db.commit()

    with pytest.raises(SessionScopeError) as raised:
        SessionService.start_session(db, resource_id=book.id, scope="lesson")

    assert raised.value.code == "SESSION_SCOPE_INVALID"
    assert raised.value.http_status == 422
    assert "incoherente" in str(raised.value)
