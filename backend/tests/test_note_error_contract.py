"""The notes API reports the failure it actually had.

Two of its codes were lies:

- `POST /notes` with a nonexistent LESSON answered `RESOURCE_NOT_FOUND`, so a
  client could not tell which anchor was wrong (and the message talked about a
  lesson while the code said resource).
- `PATCH /notes/{id}` turned ANY `ValueError` into `NOTE_NOT_FOUND` 404 — the
  note was alive and the CONTENT was the problem.

These tests pin the repaired mapping: the code travels with the error
(`NoteError.code` / `http_status`) instead of being guessed from the message, a
failed relation parse is a 422 `NOTE_PARSE_ERROR` that rolls the edit back, and
a resource that does not exist is a 404 instead of an empty note list.
"""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Book, Course
from backend.app.services.knowledge_service import KnowledgeService


def _error(response) -> dict:
    return response.json()["detail"]["error"]


def _course_with_lesson(db: Session) -> Lesson:
    course = Course(
        id=uuid.uuid4(), title="Curso Errores", status=ResourceStatus.NOT_STARTED
    )
    module = Module(
        id=uuid.uuid4(), course_id=course.id, title="Módulo", order_index=1
    )
    lesson = Lesson(
        id=uuid.uuid4(),
        module_id=module.id,
        title="Lección real",
        duration_minutes=10,
        is_completed=False,
        order_index=1,
    )
    db.add_all([course, module, lesson])
    db.commit()
    return lesson


def test_missing_lesson_is_reported_as_a_missing_lesson(client: TestClient):
    """The anchor that failed is the one the code names."""
    missing = uuid.uuid4()
    response = client.post(
        "/api/v1/notes", json={"content": "Nota suelta", "lesson_id": str(missing)}
    )

    assert response.status_code == 404, response.text
    error = _error(response)
    assert error["code"] == "LESSON_NOT_FOUND", (
        f"una lección inexistente no es un recurso inexistente: {error['code']}"
    )
    assert "Lección" in error["message"]
    assert str(missing) in error["message"]


def test_missing_resource_is_reported_as_a_missing_resource(client: TestClient):
    response = client.post(
        "/api/v1/notes", json={"content": "Nota suelta", "resource_id": str(uuid.uuid4())}
    )

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "RESOURCE_NOT_FOUND"


def test_note_with_a_real_lesson_is_created(client: TestClient, db: Session):
    """The stricter mapping must not reject a coherent link."""
    lesson = _course_with_lesson(db)
    response = client.post(
        "/api/v1/notes", json={"content": "Nota en la lección", "lesson_id": str(lesson.id)}
    )

    assert response.status_code == 201, response.text
    assert response.json()["lesson_id"] == str(lesson.id)


def test_notes_of_a_missing_resource_is_a_404(client: TestClient):
    """200 `[]` would claim the resource exists and simply has no notes."""
    missing = uuid.uuid4()
    response = client.get(f"/api/v1/resources/{missing}/notes")

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "RESOURCE_NOT_FOUND"


def test_notes_of_an_existing_resource_is_an_empty_list(client: TestClient, db: Session):
    book = Book(id=uuid.uuid4(), title="Libro sin notas", reading_percentage=0.0)
    db.add(book)
    db.commit()

    response = client.get(f"/api/v1/resources/{book.id}/notes")

    assert response.status_code == 200, response.text
    assert response.json() == []


def test_missing_note_on_edit_is_still_a_404(client: TestClient):
    """The one genuine \"not found\" keeps its code."""
    response = client.patch(
        f"/api/v1/notes/{uuid.uuid4()}", json={"content": "Texto nuevo"}
    )

    assert response.status_code == 404, response.text
    assert _error(response)["code"] == "NOTE_NOT_FOUND"


def test_parse_failure_on_create_is_a_422_not_a_missing_note(
    client: TestClient, db: Session, monkeypatch
):
    """A note the graph cannot read is a bad content, not a missing note."""
    def _explode(_db, _note_id, commit=True):  # noqa: ANN001 - test double
        raise ValueError("hashtag ilegible")

    monkeypatch.setattr(
        KnowledgeService, "parse_note_relations", staticmethod(_explode)
    )

    response = client.post("/api/v1/notes", json={"content": "Cuerpo con #raro"})

    assert response.status_code == 422, response.text
    error = _error(response)
    assert error["code"] == "NOTE_PARSE_ERROR"
    assert "relaciones" in error["message"]
    assert "hashtag ilegible" in error["message"]
    assert client.get("/api/v1/notes").json() == [], (
        "una nota cuyo análisis falla no debe quedar creada a medias"
    )


def test_parse_failure_on_edit_keeps_the_stored_note(
    client: TestClient, monkeypatch
):
    """The failed edit is rolled back: the note and its body survive."""
    created = client.post(
        "/api/v1/notes", json={"content": "Primera versión\ncon texto"}
    )
    assert created.status_code == 201, created.text
    note_id = created.json()["id"]

    def _explode(_db, _note_id, commit=True):  # noqa: ANN001 - test double
        raise ValueError("contenido no interpretable")

    monkeypatch.setattr(
        KnowledgeService, "parse_note_relations", staticmethod(_explode)
    )

    response = client.patch(
        f"/api/v1/notes/{note_id}", json={"content": "Segunda versión"}
    )

    assert response.status_code == 422, response.text
    assert _error(response)["code"] == "NOTE_PARSE_ERROR", (
        "un fallo de análisis no puede presentarse como una nota inexistente"
    )

    stored = next(n for n in client.get("/api/v1/notes").json() if n["id"] == note_id)
    assert stored["content"] == "Primera versión\ncon texto", (
        "un análisis fallido no puede dejar escrito el contenido nuevo"
    )
