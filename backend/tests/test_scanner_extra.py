import json
import yaml
import pytest
import uuid
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.settings import settings
from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.course_structure import Module, Lesson
from backend.app.models.base import ResourceStatus, LessonType
from backend.app.services.scanner import ScannerManager, CourseScanner, BookScanner


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch):
    test_home = tmp_path / "test_home"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)
    settings.ensure_dirs()


def test_course_scanner_with_media_files_and_lesson_mapping(db: Session):
    # 1. Crear directorios de curso y módulo en settings.data_dir
    course_dir = settings.data_dir / "Design_101"
    course_dir.mkdir(parents=True, exist_ok=True)
    
    # Escribir metadata
    metadata = {
        "resource_type": "course",
        "title": "Diseño UX/UI",
        "category": "Diseño"
    }
    with open(course_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    # Crear módulo y videos
    mod_dir = course_dir / "Modulo 1 - Introduccion"
    mod_dir.mkdir(parents=True, exist_ok=True)
    
    # Crear videos
    (mod_dir / "01_welcome.mp4").write_text("fake video content")
    (mod_dir / "02_basics.mp4").write_text("fake video content")

    # Guardar curso y módulo previamente en base de datos para mapeo de lecciones
    course = Course(id=uuid.uuid4(), title="Diseño UX/UI", status=ResourceStatus.NOT_STARTED, category="Diseño", source_path=str(course_dir.resolve()))
    db.add(course)
    db.commit()

    module = Module(id=uuid.uuid4(), course_id=course.id, title="Modulo 1 - Introduccion", order_index=1)
    db.add(module)
    db.commit()

    lesson1 = Lesson(id=uuid.uuid4(), module_id=module.id, title="welcome", order_index=1, lesson_type=LessonType.VIDEO)
    lesson2 = Lesson(id=uuid.uuid4(), module_id=module.id, title="basics", order_index=2, lesson_type=LessonType.VIDEO)
    db.add(lesson1)
    db.add(lesson2)
    db.commit()

    scanner = CourseScanner()
    scanner.scan(db, course_dir, metadata=metadata, background_tasks=None)

    # Verificar que los assets se crearon y se asociaron a las lecciones por el prefijo numérico
    assets = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == course.id)).all()
    assert len(assets) == 2
    
    asset_welcome = [a for a in assets if "01_welcome" in a.file_name][0]
    assert asset_welcome.lesson_id == lesson1.id


def test_book_scanner_with_media_files(db: Session):
    book_dir = settings.data_dir / "Clean_Code"
    book_dir.mkdir(parents=True, exist_ok=True)

    # metadata
    metadata = {
        "resource_type": "book",
        "title": "Clean Code",
        "author": "Robert C. Martin",
        "category": "Desarrollo"
    }
    with open(book_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    (book_dir / "clean_code.pdf").write_text("fake pdf data")

    scanner = BookScanner()
    scanner.scan(db, book_dir, metadata=metadata, background_tasks=None)

    # Validar creación del libro y del asset
    book = db.scalars(select(Book).where(Book.title == "Clean Code")).first()
    assert book is not None
    assert book.author == "Robert C. Martin"

    asset = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == book.id)).first()
    assert asset is not None
    assert asset.media_type == "pdf"
