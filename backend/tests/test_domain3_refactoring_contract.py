import uuid
from pathlib import Path
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.core.errors import DomainError
from backend.app.services.ai_validation import StudyMaterialValidationError
from backend.app.services.workflow import (
    WorkflowError, LearningPathNotFoundError, GoalNotFoundError, HabitNotFoundError
)
from backend.app.services.resource import ResourceService
from backend.app.services.dashboard import DashboardService
from backend.app.services.semantic_search import SemanticSearchService
from backend.app.services.search import SearchService
from backend.app.schemas.search import SearchResultResponse, SemanticSearchResultResponse
from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.course_structure import Module, Lesson
from backend.app.models.content import Transcript, TranscriptSegment
from backend.app.models.activity import Note
from backend.app.models.base import ResourceStatus
from backend.app.core.settings import settings


def _err(res) -> dict:
    return res.json()["detail"]["error"]


def test_study_material_validation_error_is_domain_error():
    assert issubclass(StudyMaterialValidationError, DomainError)
    assert issubclass(StudyMaterialValidationError, ValueError)
    err = StudyMaterialValidationError("test error")
    assert err.code == "STUDY_MATERIAL_INVALID"
    assert err.http_status == 422


def test_workflow_error_hierarchy():
    assert issubclass(WorkflowError, DomainError)
    assert issubclass(LearningPathNotFoundError, WorkflowError)
    assert issubclass(GoalNotFoundError, WorkflowError)
    assert issubclass(HabitNotFoundError, WorkflowError)
    assert LearningPathNotFoundError.http_status == 404
    assert LearningPathNotFoundError.code == "LEARNING_PATH_NOT_FOUND"


def test_workflow_api_error_contract(client: TestClient):
    random_id = uuid.uuid4()
    # 1. Path not found
    res = client.get(f"/api/v1/workflow/paths/{random_id}")
    assert res.status_code == 404
    err = _err(res)
    assert err["code"] == "LEARNING_PATH_NOT_FOUND"

    # 2. Plan not found
    res = client.get(f"/api/v1/workflow/plans/{random_id}")
    assert res.status_code == 404
    assert _err(res)["code"] == "STUDY_PLAN_NOT_FOUND"

    # 3. Goal not found
    res = client.get(f"/api/v1/workflow/goals/{random_id}")
    assert res.status_code == 404
    assert _err(res)["code"] == "GOAL_NOT_FOUND"

    # 4. Habit stats not found
    res = client.get(f"/api/v1/workflow/habits/{random_id}/stats")
    assert res.status_code == 404
    assert _err(res)["code"] == "HABIT_NOT_FOUND"


def test_ai_api_error_contract(client: TestClient):
    # Standalone invalid note query
    random_id = uuid.uuid4()
    res = client.post("/api/v1/ai/notes/summarize", json={"note_ids": [str(random_id)]})
    assert res.status_code == 404
    err = _err(res)
    assert err["code"] == "NOTE_NOT_FOUND"


def test_standalone_note_search_schemas():
    # 1. SearchResultResponse with None resource_id
    res_schema = SearchResultResponse(
        resource_id=None,
        resource_title=None,
        resource_type=None,
        match_type="note",
        snippet="Prueba",
        score=4.0
    )
    assert res_schema.resource_id is None

    # 2. SemanticSearchResultResponse with None resource_id
    sem_schema = SemanticSearchResultResponse(
        resource_id=None,
        resource_title=None,
        resource_type=None,
        match_type="note",
        snippet="Prueba semántica",
        score=0.85
    )
    assert sem_schema.resource_id is None


def test_search_service_includes_standalone_notes(db: Session):
    standalone_note = Note(
        id=uuid.uuid4(),
        resource_id=None,
        content="Algoritmos de grafos y matrices dispersas."
    )
    db.add(standalone_note)
    db.commit()

    results = SearchService.search(db, query="grafos y matrices")
    matching = [r for r in results if r["match_type"] == "note" and "grafos" in r["snippet"]]
    assert len(matching) >= 1
    assert matching[0]["resource_id"] is None
    assert matching[0]["resource_type"] == "note"


def test_semantic_search_provenance_resolution(db: Session):
    course = Course(id=uuid.uuid4(), title="Curso de Arquitectura", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Modulo 1", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección 1", duration_minutes=15, is_completed=False, order_index=1)
    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=course.id,
        lesson_id=lesson.id,
        file_path="/tmp/fake.mp4",
        file_name="fake.mp4",
        mime_type="video/mp4",
        media_type="video"
    )
    transcript = Transcript(id=uuid.uuid4(), media_asset_id=asset.id)
    segment = TranscriptSegment(id=uuid.uuid4(), transcript_id=transcript.id, start_time=12.5, end_time=20.0, text="Arquitectura de software desacoplada")

    db.add_all([course, module, lesson, asset, transcript, segment])
    db.commit()

    # Test _resolve_resource_ids directly
    resolved = SemanticSearchService._resolve_resource_ids(db, [str(segment.id)])
    assert str(segment.id) in resolved
    assert resolved[str(segment.id)] == course.id


def test_resource_service_delete_resource(db: Session, tmp_path: Path, monkeypatch):
    test_media_dir = tmp_path / "media"
    test_media_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(type(settings), "media_dir", property(lambda self: test_media_dir))

    book = Book(id=uuid.uuid4(), title="Libro a Borrar", reading_percentage=0.0)
    db.add(book)
    db.commit()

    book_storage = test_media_dir / str(book.id)
    book_storage.mkdir()
    (book_storage / "sample.pdf").write_text("contenido")
    assert book_storage.exists()

    success = ResourceService.delete_resource(db, book.id)
    assert success is True
    assert db.get(Book, book.id) is None
    assert not book_storage.exists()


def test_dashboard_service_metrics(db: Session):
    summary = DashboardService.get_summary(db)
    assert hasattr(summary, "total_resources")
    assert hasattr(summary, "completed_resources")
    assert hasattr(summary, "in_progress_resources")

    activity = DashboardService.get_recent_activity(db, limit=3)
    assert isinstance(activity, list)
    assert len(activity) <= 3
