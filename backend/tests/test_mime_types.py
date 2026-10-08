"""Tests de resolución de tipos MIME (auditoría P1-13).

El scanner asignaba ``video/mp4`` a todos los vídeos y la ingesta sólo conocía
unos pocos tipos; aquí se fija el contrato canónico.
"""

from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.mime import guess_mime_type
from backend.app.models.resource import Course, MediaAsset
from backend.app.models.base import ResourceStatus
from backend.app.services.scanner import CourseScanner


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("clip.mp4", "video/mp4"),
        ("clip.webm", "video/webm"),
        ("clip.mov", "video/quicktime"),
        ("clip.mkv", "video/x-matroska"),
        ("clip.avi", "video/x-msvideo"),
        ("clip.m4v", "video/x-m4v"),
    ],
)
def test_video_mime_types_are_resolved_per_extension(filename, expected):
    assert guess_mime_type(filename) == expected


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("track.mp3", "audio/mpeg"),
        ("track.wav", "audio/wav"),
        ("track.ogg", "audio/ogg"),
        ("track.flac", "audio/flac"),
        ("track.m4a", "audio/mp4"),
        ("track.aac", "audio/aac"),
    ],
)
def test_audio_mime_types_are_resolved_per_extension(filename, expected):
    assert guess_mime_type(filename) == expected


@pytest.mark.parametrize(
    "filename,expected",
    [
        ("book.pdf", "application/pdf"),
        ("book.epub", "application/epub+zip"),
        ("notes.txt", "text/plain"),
        ("notes.md", "text/markdown"),
    ],
)
def test_document_mime_types_are_resolved_per_extension(filename, expected):
    assert guess_mime_type(filename) == expected


def test_unknown_extension_falls_back_to_octet_stream():
    assert guess_mime_type("archive.xyz") == "application/octet-stream"
    assert guess_mime_type("no_extension") == "application/octet-stream"


def test_extension_matching_is_case_insensitive():
    assert guess_mime_type("CLIP.MKV") == "video/x-matroska"
    assert guess_mime_type("Book.PDF") == "application/pdf"
    assert guess_mime_type("Track.MP3") == "audio/mpeg"


def test_accepts_path_objects_and_ignores_directories():
    assert guess_mime_type(Path("/media/library/lesson 01.mkv")) == "video/x-matroska"
    assert guess_mime_type(Path("nested/dir/clip.webm")) == "video/webm"


def test_scanner_source_no_longer_hardcodes_mp4():
    """Regresión: el scanner no debe volver a etiquetar todo vídeo como mp4."""
    source = Path(__file__).resolve().parents[1] / "app" / "services" / "scanner.py"
    text = source.read_text(encoding="utf-8")
    assert 'mime_type="video/mp4"' not in text
    assert "video/mp4" not in text


class _CollectingBackgroundTasks:
    """Recoge las tareas de extracción sin ejecutarlas (evita I/O en el test)."""

    def __init__(self):
        self.tasks = []

    def add_task(self, func, *args, **kwargs):
        self.tasks.append((func, args, kwargs))


def test_scanner_registers_mkv_with_correct_mime(tmp_path: Path, db: Session):
    """Un .mkv registrado por el scanner debe quedar como video/x-matroska."""
    course_dir = tmp_path / "course"
    course_dir.mkdir()
    (course_dir / "01 introduccion.mkv").write_bytes(b"fake video bytes")

    tasks = _CollectingBackgroundTasks()
    created, _updated = CourseScanner().scan(db, course_dir, None, tasks)
    assert created is True

    course = db.scalars(select(Course)).first()
    assets = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == course.id)).all()
    assert len(assets) == 1
    assert assets[0].mime_type == "video/x-matroska"
    assert assets[0].mime_type != "video/mp4"
    assert assets[0].media_type == "video"


def test_ingestion_uses_shared_resolver(db: Session):
    """La ingesta ya no mantiene su propia tabla MIME."""
    import backend.app.services.ingestion as ingestion

    assert not hasattr(ingestion, "MIME_MAP")
    assert ingestion.guess_mime_type("x.mkv") == "video/x-matroska"
