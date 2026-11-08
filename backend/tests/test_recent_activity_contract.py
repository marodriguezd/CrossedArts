"""Recent activity reports what really exists.

The feed used to invent substitutes when an entry had no resource: it used the
SESSION's own id as `resource_id` and made up a `resource_type` (`lesson`,
`global`, `standalone`), so a consumer could not tell a resource id from a
session id nor filter by a real resource type.

These tests pin the repaired contract: `resource_id`/`resource_type` carry a
real resource or nothing, the entry has its own `title`, and sessions expose the
EFFECTIVE scope (the declared one re-derived from the anchors that still exist).
"""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from backend.app.core.utils import utc_now_naive
from backend.app.models.activity import LearningSession
from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Book, Course
from backend.app.services.note import NoteService
from backend.app.services.session import SessionService


def _get_activity(client: TestClient, entry_id: uuid.UUID) -> dict:
    response = client.get("/api/v1/dashboard/recent-activity")
    assert response.status_code == 200, response.text
    return next(
        (entry for entry in response.json() if entry["id"] == str(entry_id)), None
    )


def _course_with_lesson(db: Session) -> tuple[Course, Lesson]:
    course = Course(
        id=uuid.uuid4(), title="Curso Actividad", status=ResourceStatus.NOT_STARTED
    )
    module = Module(
        id=uuid.uuid4(), course_id=course.id, title="Módulo", order_index=1
    )
    lesson = Lesson(
        id=uuid.uuid4(),
        module_id=module.id,
        title="Lección del curso",
        duration_minutes=10,
        is_completed=False,
        order_index=1,
    )
    db.add_all([course, module, lesson])
    db.commit()
    return course, lesson


def test_resource_session_reports_a_real_resource(db: Session, client: TestClient):
    """The resource-scoped session carries the real resource and its type."""
    book = Book(id=uuid.uuid4(), title="Libro Anclado", reading_percentage=0.0)
    db.add(book)
    db.commit()
    session = SessionService.start_session(db, resource_id=book.id)
    SessionService.end_session(db, session.id)

    item = _get_activity(client, session.id)
    assert item is not None, "la sesión finalizada sí aparece"
    assert item["resource_id"] == str(book.id), "un recurso real, nunca el id de la sesión"
    assert item["resource_type"] == "book"
    assert item["title"] == "Libro Anclado"
    assert item["scope"] == "resource"
    assert item["lesson_id"] is None


def test_lesson_session_without_resource_is_not_a_resource(
    db: Session, client: TestClient
):
    """A lesson session that lost its resource reports no resource at all."""
    course, lesson = _course_with_lesson(db)
    session = SessionService.start_session(db, lesson_id=lesson.id)
    SessionService.end_session(db, session.id)

    item = _get_activity(client, session.id)
    assert item is not None
    assert item["resource_id"] is None, "sin recurso no hay resource_id"
    assert item["resource_type"] is None, "'lesson' no es un tipo de recurso"
    assert item["lesson_id"] == str(lesson.id)
    assert item["lesson_title"] == lesson.title
    assert item["scope"] == "lesson"
    assert item["title"] == lesson.title, "el titular es la lección, no un sustituto"


def test_global_session_reports_the_global_scope_without_any_anchor(
    db: Session, client: TestClient
):
    """The cross-cutting review is a first-class scope, not a missing resource."""
    session = SessionService.start_session(db)
    SessionService.end_session(db, session.id)

    item = _get_activity(client, session.id)
    assert item is not None
    assert item["resource_id"] is None
    assert item["resource_type"] is None
    assert item["lesson_id"] is None
    assert item["scope"] == "global"
    assert item["title"] == "Repaso general"
    # The feed reports what the session stored; it does not re-implement the
    # minimum-duration floor that `end_session` applies.
    stored = db.get(LearningSession, session.id)
    assert stored is not None
    assert item["duration_minutes"] == stored.duration_minutes


def test_unlinked_session_keeps_declared_history_and_reports_effective_scope(
    db: Session, client: TestClient
):
    """`ON DELETE SET NULL` unlinks the session; the feed never resurrects it."""
    book = Book(id=uuid.uuid4(), title="Libro Borrado", reading_percentage=0.0)
    db.add(book)
    db.commit()
    session = SessionService.start_session(db, resource_id=book.id)
    SessionService.end_session(db, session.id)

    response = client.delete(f"/api/v1/resources/{book.id}")
    assert response.status_code == 204, response.text
    db.expire_all()

    item = _get_activity(client, session.id)
    assert item is not None, "la historia de la sesión sobrevive al recurso"
    assert item["resource_id"] is None, "ya no existe ese recurso: no se informa"
    assert item["scope"] == "global", "el ámbito efectivo es el repaso global"
    assert item["title"] == "Repaso general"


def test_standalone_note_reports_its_own_title_and_no_invented_type(
    db: Session, client: TestClient
):
    """A resourceless note is shown through its own title, not a fake resource."""
    note = NoteService.create_note(db, None, "Pensamiento suelto")

    item = _get_activity(client, note.id)
    assert item is not None
    assert item["title"] == "Pensamiento suelto"
    assert item["resource_id"] is None
    assert item["resource_type"] is None, "'standalone' no es un tipo de recurso"
    assert item["resource_title"] is None
    assert item["scope"] is None


def test_note_linked_to_a_resource_reports_that_resource(
    db: Session, client: TestClient
):
    """A linked note keeps pointing at its real resource and type."""
    book = Book(id=uuid.uuid4(), title="Libro con nota", reading_percentage=0.0)
    db.add(book)
    db.commit()
    note = NoteService.create_note(db, book.id, "Anotación sobre el libro")

    item = _get_activity(client, note.id)
    assert item is not None
    assert item["resource_id"] == str(book.id)
    assert item["resource_type"] == "book"
    assert item["resource_title"] == "Libro con nota"
    assert item["title"] == "Anotación sobre el libro"


def test_finalized_session_without_end_stamp_is_skipped_not_a_500(
    db: Session, client: TestClient
):
    """A legal legacy row must not take the whole feed down.

    `learning_session.ended_at` is nullable and `finalized` is the formal close
    marker, so a row can be finalized with no end stamp (legacy data, and an
    INSERT that never went through `end_session`). The query used to filter on
    `finalized` alone: building the item raised ValidationError and the endpoint
    answered 500 for everyone, not just for that entry.
    """
    book = Book(id=uuid.uuid4(), title="Libro Sin Cierre", reading_percentage=0.0)
    db.add(book)
    db.commit()

    outdated = LearningSession(
        id=uuid.uuid4(),
        resource_id=book.id,
        scope="resource",
        mode="flashcards",
        started_at=utc_now_naive(),
        ended_at=None,
        finalized=True,
        duration_minutes=3,
        inactive_seconds=0,
    )
    db.add(outdated)
    db.commit()

    response = client.get("/api/v1/dashboard/recent-activity")
    assert response.status_code == 200, response.text
    assert all(entry["id"] != str(outdated.id) for entry in response.json()), (
        "una sesión sin hora de cierre no puede presentarse como actividad cerrada"
    )


def test_no_entry_reuses_its_own_id_as_resource_id(db: Session, client: TestClient):
    """Regression: the surrogate id that made the feed dishonest is gone."""
    course, _ = _course_with_lesson(db)
    lesson_session = SessionService.start_session(db, resource_id=course.id)
    SessionService.end_session(db, lesson_session.id)
    global_session = SessionService.start_session(db)
    SessionService.end_session(db, global_session.id)

    response = client.get("/api/v1/dashboard/recent-activity")
    assert response.status_code == 200, response.text
    for entry in response.json():
        assert entry["resource_id"] != entry["id"], (
            f"{entry['activity_type']} reutiliza su propio id como resource_id"
        )
        assert entry["resource_type"] in (None, "course", "book"), (
            f"tipo de recurso inventado: {entry['resource_type']}"
        )
        assert entry["title"], "toda actividad tiene un titular real"
