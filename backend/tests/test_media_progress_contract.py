"""Contract: playback telemetry is not learning state.

`POST /media/{media_id}/progress` used to mark the linked lesson as completed
past 90% watched. That made the server derive a learning fact from bytes it
reported to a player, which contradicts the project contract (the browser's
SQLite database is the only source of truth for learner progress) and, in
practice, a `Range`-heavy stream or a re-requested mark could complete a lesson
nobody watched. The endpoint now records the position, the duration and its own
`is_watched` flag and touches nothing else.

The threshold, the position and the flag are asserted here too, so "does not
touch the lesson" cannot be achieved by simply not saving anything.
"""
import uuid

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.activity import MediaProgress
from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.resource import Course, MediaAsset


def _course_with_lesson_and_media(db: Session) -> tuple[Course, Lesson, MediaAsset]:
    course = Course(id=uuid.uuid4(), title="Curso con vídeo", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo")
    db.add(module)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección", is_completed=False)
    db.add(lesson)
    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=course.id,
        lesson_id=lesson.id,
        media_type="video",
        file_path=f"/tmp/{uuid.uuid4()}.mp4",
        file_name="clase.mp4",
        file_size=1024,
        mime_type="video/mp4",
    )
    db.add(asset)
    db.commit()
    return course, lesson, asset


def test_playback_past_threshold_marks_the_medium_but_not_the_lesson(
    client: TestClient, db: Session
) -> None:
    course, lesson, asset = _course_with_lesson_and_media(db)

    response = client.post(
        f"/api/v1/media/{asset.id}/progress",
        params={"position": 95.0, "duration": 100.0},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["is_watched"] is True
    assert body["last_position"] == 95.0
    assert body["duration"] == 100.0

    # The lesson and its course are the learner's business, not the player's.
    db.expire_all()
    assert db.get(Lesson, lesson.id).is_completed is False
    assert db.get(Course, course.id).status == ResourceStatus.NOT_STARTED


def test_playback_below_threshold_is_not_watched(client: TestClient, db: Session) -> None:
    _, _, asset = _course_with_lesson_and_media(db)

    response = client.post(
        f"/api/v1/media/{asset.id}/progress",
        params={"position": 10.0, "duration": 100.0},
    )

    assert response.status_code == 200
    assert response.json()["is_watched"] is False


def test_playback_mark_upserts_a_single_row(client: TestClient, db: Session) -> None:
    _, _, asset = _course_with_lesson_and_media(db)

    client.post(f"/api/v1/media/{asset.id}/progress", params={"position": 30.0, "duration": 100.0})
    second = client.post(
        f"/api/v1/media/{asset.id}/progress", params={"position": 92.0, "duration": 100.0}
    )

    assert second.status_code == 200
    assert second.json()["last_position"] == 92.0
    rows = db.scalars(select(MediaProgress).where(MediaProgress.media_asset_id == asset.id)).all()
    assert len(rows) == 1
    assert rows[0].is_watched is True

    # A zero duration cannot divide: it must not raise and must not guess.
    zero = client.post(
        f"/api/v1/media/{asset.id}/progress", params={"position": 0.0, "duration": 0.0}
    )
    assert zero.status_code == 200
    assert zero.json()["is_watched"] is True  # the mark from the previous call stands
