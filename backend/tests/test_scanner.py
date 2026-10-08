import json
import yaml
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Course, Book
from backend.app.services.scanner import ScannerManager

def test_course_with_metadata_json(db: Session, tmp_path: Path):
    # 1. Crear directorio del curso
    courses_dir = tmp_path / "Courses"
    courses_dir.mkdir()
    course_dir = courses_dir / "Photography 101"
    course_dir.mkdir()

    # 2. Escribir metadata.json
    metadata = {
        "resource_type": "course",
        "title": "Fotografía Profesional",
        "category": "Arte",
        "difficulty": "intermediate",
        "description": "Curso completo de fotografía avanzada."
    }
    with open(course_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    # 3. Escanear
    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    assert result.discovered == 1
    assert result.created == 1
    assert len(result.errors) == 0

    # Verificar inserción
    stmt = select(Course).where(Course.title == "Fotografía Profesional")
    course = db.scalars(stmt).first()
    assert course is not None
    assert course.category == "Arte"
    assert course.difficulty.value == "INTERMEDIATE"


def test_course_with_metadata_yaml(db: Session, tmp_path: Path):
    courses_dir = tmp_path / "Courses"
    courses_dir.mkdir()
    course_dir = courses_dir / "Python Course"
    course_dir.mkdir()

    # Escribir metadata.yaml
    metadata = {
        "resource_type": "course",
        "title": "Aprende Python",
        "category": "Programación",
        "difficulty": "beginner"
    }
    with open(course_dir / "metadata.yaml", "w", encoding="utf-8") as f:
        yaml.dump(metadata, f)

    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    assert result.discovered == 1
    assert result.created == 1

    stmt = select(Course).where(Course.title == "Aprende Python")
    course = db.scalars(stmt).first()
    assert course is not None


def test_course_without_metadata_fallback(db: Session, tmp_path: Path):
    courses_dir = tmp_path / "Courses"
    courses_dir.mkdir()
    course_dir = courses_dir / "Illustration Fundamentals"
    course_dir.mkdir()

    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    assert result.discovered == 1
    assert result.created == 1

    # Debe tomar el nombre del directorio como título
    stmt = select(Course).where(Course.title == "Illustration Fundamentals")
    course = db.scalars(stmt).first()
    assert course is not None
    assert course.category == "General"


def test_book_with_metadata_and_files(db: Session, tmp_path: Path):
    books_dir = tmp_path / "Books"
    books_dir.mkdir()
    book_dir = books_dir / "Atomic Habits Book"
    book_dir.mkdir()

    # Crear archivo ficticio .epub
    (book_dir / "habits.epub").write_text("dummy")

    metadata = {
        "resource_type": "book",
        "title": "Hábitos Atómicos",
        "author": "James Clear",
        "category": "Autoayuda"
    }
    with open(book_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    assert result.discovered == 1
    assert result.created == 1

    stmt = select(Book).where(Book.title == "Hábitos Atómicos")
    book = db.scalars(stmt).first()
    assert book is not None
    assert book.author == "James Clear"


def test_book_without_metadata_heuristic(db: Session, tmp_path: Path):
    books_dir = tmp_path / "Books"
    books_dir.mkdir()
    book_dir = books_dir / "Deep Work Novel"
    book_dir.mkdir()

    # Escribir un .pdf para activar la heurística
    (book_dir / "deep_work.pdf").write_text("dummy")

    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    assert result.discovered == 1
    assert result.created == 1

    stmt = select(Book).where(Book.title == "Deep Work Novel")
    book = db.scalars(stmt).first()
    assert book is not None
    assert book.author == "Desconocido"


def test_scanner_idempotency_and_update(db: Session, tmp_path: Path):
    courses_dir = tmp_path / "Courses"
    courses_dir.mkdir()
    course_dir = courses_dir / "Photography 101"
    course_dir.mkdir()

    metadata = {
        "resource_type": "course",
        "title": "Fotografía Profesional",
        "category": "Arte"
    }
    with open(course_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    manager = ScannerManager(db)
    
    # Primer escaneo: crea recurso
    res1 = manager.scan_directory(str(tmp_path))
    assert res1.created == 1

    # Segundo escaneo sin cambios: debe ignorarlo
    res2 = manager.scan_directory(str(tmp_path))
    assert res2.created == 0
    assert res2.updated == 0

    # Modificar metadata
    metadata["title"] = "Fotografía Profesional v2"
    with open(course_dir / "metadata.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f)

    # Tercer escaneo con cambios: debe actualizar
    res3 = manager.scan_directory(str(tmp_path))
    assert res3.created == 0
    assert res3.updated == 1

    stmt = select(Course).where(Course.title == "Fotografía Profesional v2")
    course = db.scalars(stmt).first()
    assert course is not None


def test_invalid_metadata_handling(db: Session, tmp_path: Path):
    courses_dir = tmp_path / "Courses"
    courses_dir.mkdir()
    course_dir = courses_dir / "Photography Broken"
    course_dir.mkdir()

    # Escribir json inválido
    with open(course_dir / "metadata.json", "w", encoding="utf-8") as f:
        f.write("{invalid json:}")

    manager = ScannerManager(db)
    result = manager.scan_directory(str(tmp_path))

    # Debe reportar una advertencia y aplicar el fallback heurístico al no poder parsear metadatos
    assert result.discovered == 1
    assert len(result.warnings) == 1
    assert "Error parseando metadata.json" in result.warnings[0]
