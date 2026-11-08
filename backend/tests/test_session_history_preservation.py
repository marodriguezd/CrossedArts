"""Study history survives library reorganization.

`learning_session.resource_id`/`lesson_id` are anchors into the material a
session studied. Both layers promise `ON DELETE SET NULL` preserves an already
finished session when that material disappears, and both docblocks used to
contradict the schema: the backend deleted sessions with `ON DELETE CASCADE`
(plus `delete-orphan`) and the browser could not even run the unlink because a
CHECK required `resource_id` for `scope='resource'`.

These tests pin the fixed contract: deleting a resource or a lesson unlinks the
session, keeps its declared scope and duration, and the effective scope is
re-derived from the surviving anchors on read.
"""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.models.activity import (
    LearningSession,
    Note,
    resolve_effective_session_scope,
)
from backend.app.models.base import ResourceStatus
from backend.app.models.content import EmbeddingRecord
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Course
from backend.app.services.session import SessionService


def _enable_foreign_keys(db: Session) -> None:
    """SQLite does not enforce FKs by default; the contract lives in them."""
    db.execute(text("PRAGMA foreign_keys = ON"))
    assert db.execute(text("PRAGMA foreign_keys")).scalar() == 1, (
        "sin FKs activas estas pruebas no probarían el ON DELETE SET NULL: "
        "SQLite ignora el PRAGMA dentro de una transacción"
    )


def _course_with_lesson(db: Session) -> tuple[Course, Lesson]:
    course = Course(
        id=uuid.uuid4(),
        title="Curso Historia",
        status=ResourceStatus.NOT_STARTED,
    )
    module = Module(
        id=uuid.uuid4(),
        course_id=course.id,
        title="Módulo Historia",
        order_index=1,
    )
    lesson = Lesson(
        id=uuid.uuid4(),
        module_id=module.id,
        title="Lección Historia",
        duration_minutes=10,
        is_completed=False,
        order_index=1,
    )
    db.add_all([course, module, lesson])
    db.commit()
    return course, lesson


def test_deleting_a_resource_unlinks_its_session(db: Session):
    """The session survives with its history and a re-derived effective scope."""
    _enable_foreign_keys(db)
    course, _ = _course_with_lesson(db)
    session = SessionService.start_session(db, resource_id=course.id)
    session_id = session.id

    db.delete(course)
    db.commit()
    db.expire_all()

    preserved = db.get(LearningSession, session_id)
    assert preserved is not None, "borrar el recurso no puede destruir la sesión"
    assert preserved.resource_id is None, "la FK debe desvincular, no borrar"
    assert preserved.scope == "resource", "el ámbito declarado es historia, no se reescribe"
    assert (
        resolve_effective_session_scope(
            preserved.scope, preserved.resource_id, preserved.lesson_id
        )
        == "global"
    ), "sin anclas, el ámbito efectivo es el repaso global"


def test_deleting_a_lesson_reclassifies_a_lesson_session(db: Session):
    """Lesson sessions keep the resource anchor and re-derive to `resource`."""
    _enable_foreign_keys(db)
    course, lesson = _course_with_lesson(db)
    session = SessionService.start_session(
        db, resource_id=course.id, lesson_id=lesson.id
    )
    session_id = session.id
    assert session.scope == "lesson"

    db.delete(lesson)
    db.commit()
    db.expire_all()

    preserved = db.get(LearningSession, session_id)
    assert preserved is not None, "borrar la lección no puede destruir la sesión"
    assert preserved.lesson_id is None
    assert preserved.resource_id == course.id
    assert preserved.scope == "lesson"
    assert (
        resolve_effective_session_scope(
            preserved.scope, preserved.resource_id, preserved.lesson_id
        )
        == "resource"
    ), "el ámbito efectivo baja a recurso porque el recurso sigue ahí"


def test_delete_resource_endpoint_keeps_session_note_and_its_embedding(
    client: TestClient, db: Session
):
    """User work and its derived data survive the endpoint, unlinked."""
    _enable_foreign_keys(db)
    course, _ = _course_with_lesson(db)
    session = SessionService.start_session(db, resource_id=course.id)

    note = Note(resource_id=course.id, content="Idea que debe sobrevivir")
    db.add(note)
    db.commit()

    embedding = EmbeddingRecord(
        entity_id=note.id,
        entity_type="note",
        vector=[0.1, 0.2],
        model="test",
        hash_content="hash-nota",
    )
    db.add(embedding)
    db.commit()
    note_id, embedding_id, session_id = note.id, embedding.id, session.id

    response = client.delete(f"/api/v1/resources/{course.id}")
    assert response.status_code == 204, response.text
    db.expire_all()

    assert db.get(LearningSession, session_id) is not None, "la sesión histórica sobrevive"
    preserved_note = db.get(Note, note_id)
    assert preserved_note is not None, "la nota es trabajo del usuario, no del recurso"
    assert preserved_note.resource_id is None
    assert (
        db.get(EmbeddingRecord, embedding_id) is not None
    ), "el embedding de una nota que sobrevive sigue siendo válido"


def test_session_response_exposes_declared_and_effective_scope(
    client: TestClient, db: Session
):
    """Both values travel in the response: declared truth and supported scope."""
    course, _ = _course_with_lesson(db)
    response = client.post(
        "/api/v1/sessions/start", json={"resource_id": str(course.id)}
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["scope"] == "resource"
    assert body["effective_scope"] == "resource"


def test_unlinked_session_response_reports_declared_scope_and_effective_scope(
    client: TestClient, db: Session
):
    """After the anchor disappears the two values must DIVERGE.

    The declared scope is what the user did; the effective scope is what the
    anchors still support. A copy of one into the other would present a lesson
    that can no longer be opened as if it were still reachable.
    """
    from backend.app.schemas.session import LearningSessionResponse

    course, _ = _course_with_lesson(db)
    started = client.post("/api/v1/sessions/start", json={"resource_id": str(course.id)})
    assert started.status_code == 201, started.text
    session_id = started.json()["id"]
    assert client.post(f"/api/v1/sessions/{session_id}/end").status_code == 200

    assert client.delete(f"/api/v1/resources/{course.id}").status_code == 204
    db.expire_all()

    session = db.get(LearningSession, uuid.UUID(session_id))
    assert session is not None, "la sesión histórica sobrevive al recurso"
    response = LearningSessionResponse.model_validate(session)
    assert response.scope == "resource", "el ámbito declarado no se reescribe"
    assert response.effective_scope == "global", (
        "sin recurso el ámbito efectivo es el repaso global"
    )
