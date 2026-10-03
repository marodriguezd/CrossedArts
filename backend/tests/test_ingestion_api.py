import os
import pytest
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select
from fastapi.testclient import TestClient

from backend.app.core.settings import settings
from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.course_structure import Module, Lesson


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch):
    """Configura el entorno de prueba con un directorio de datos temporal."""
    test_home = tmp_path / "test_home"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)
    settings.ensure_dirs()


def test_validate_directory_endpoint(client: TestClient):
    """Prueba la validación de un directorio con subcarpetas y archivos multimedia."""
    course_dir = settings.data_dir / "my_test_course"
    course_dir.mkdir(parents=True, exist_ok=True)
    
    mod1_dir = course_dir / "Modulo 1"
    mod1_dir.mkdir()
    
    (mod1_dir / "video1.mp4").write_text("dummy video")
    (course_dir / "document.pdf").write_text("dummy pdf")
    
    response = client.post(f"/api/v1/content/validate-directory?path={course_dir}")
    assert response.status_code == 200
    data = response.json()
    assert data["exists"] is True
    assert data["is_directory"] is True
    assert data["total_files"] == 2
    assert "Modulo 1" in data["subdirectories"]
    assert "video1.mp4" in data["media_files"]["video"]
    assert "document.pdf" in data["media_files"]["pdf"]


def test_validate_directory_endpoint_invalid_or_unsafe(client: TestClient):
    """Prueba la validación de directorios inexistentes o fuera del workspace."""
    non_existent = settings.data_dir / "does_not_exist"
    response = client.post(f"/api/v1/content/validate-directory?path={non_existent}")
    assert response.status_code == 200
    assert response.json()["exists"] is False

    response = client.post("/api/v1/content/validate-directory?path=/etc")
    assert response.status_code == 200
    assert response.json()["exists"] is False


def test_import_course_reference(client: TestClient, db: Session):
    """Prueba la importación de un curso utilizando la estrategia de referencia."""
    course_dir = settings.data_dir / "reference_course"
    course_dir.mkdir(parents=True, exist_ok=True)
    mod_dir = course_dir / "Modulo Introduccion"
    mod_dir.mkdir()
    video_file = mod_dir / "lesson_one.mp4"
    video_file.write_text("video contents")

    payload = {
        "title": "Curso Test Referencia",
        "resource_type": "course",
        "category": "Programacion",
        "difficulty": "BEGINNER",
        "source_path": str(course_dir.resolve()),
        "storage_strategy": "reference",
        "structure_strategy": "auto_hierarchical"
    }

    response = client.post("/api/v1/content/import", json=payload)
    assert response.status_code == 201
    res_data = response.json()
    assert res_data["title"] == "Curso Test Referencia"
    assert res_data["modules_created"] == 1
    assert res_data["lessons_created"] == 1
    assert res_data["assets_created"] == 1

    # Verificar estado del modelo en la base de datos
    course_id = res_data["resource_id"]
    course = db.get(Course, course_id)
    assert course is not None
    assert course.title == "Curso Test Referencia"
    assert course.category == "Programacion"
    assert course.source_path == str(course_dir.resolve())

    stmt_mod = select(Module).where(Module.course_id == course.id)
    modules = db.scalars(stmt_mod).all()
    assert len(modules) == 1
    assert modules[0].title == "Modulo Introduccion"

    stmt_les = select(Lesson).where(Lesson.module_id == modules[0].id)
    lessons = db.scalars(stmt_les).all()
    assert len(lessons) == 1
    assert lessons[0].title == "lesson_one"

    stmt_asset = select(MediaAsset).where(MediaAsset.lesson_id == lessons[0].id)
    asset = db.scalars(stmt_asset).first()
    assert asset is not None
    assert asset.file_path == str(video_file.resolve())
    assert Path(asset.file_path).exists()


def test_import_course_copy(client: TestClient, db: Session):
    """Prueba la importación de un curso utilizando la estrategia de copia física."""
    course_dir = settings.data_dir / "copy_course"
    course_dir.mkdir(parents=True, exist_ok=True)
    mod_dir = course_dir / "Modulo Copy"
    mod_dir.mkdir()
    video_file = mod_dir / "lesson_two.mp4"
    video_file.write_text("video contents copy")

    payload = {
        "title": "Curso Test Copia",
        "resource_type": "course",
        "category": "Diseno",
        "difficulty": "ADVANCED",
        "source_path": str(course_dir.resolve()),
        "storage_strategy": "copy",
        "structure_strategy": "auto_hierarchical"
    }

    response = client.post("/api/v1/content/import", json=payload)
    assert response.status_code == 201
    res_data = response.json()
    assert res_data["title"] == "Curso Test Copia"

    # Verificar base de datos
    course_id = res_data["resource_id"]
    course = db.get(Course, course_id)
    assert course is not None
    assert course.title == "Curso Test Copia"

    stmt_mod = select(Module).where(Module.course_id == course.id)
    modules = db.scalars(stmt_mod).all()
    stmt_les = select(Lesson).where(Lesson.module_id == modules[0].id)
    lessons = db.scalars(stmt_les).all()

    # Verificar que el asset fue copiado al directorio media de la app
    stmt_asset = select(MediaAsset).where(MediaAsset.lesson_id == lessons[0].id)
    asset = db.scalars(stmt_asset).first()
    assert asset is not None
    assert asset.file_path != str(video_file.resolve())
    assert settings.media_dir in Path(asset.file_path).parents
    assert Path(asset.file_path).exists()
    assert Path(asset.file_path).read_text() == "video contents copy"


def test_import_book_reference_and_copy(client: TestClient, db: Session):
    """Prueba la importación de un libro con estrategias de referencia y copia."""
    # Estrategia Referencia
    book_dir_ref = settings.data_dir / "ref_book_folder"
    book_dir_ref.mkdir(parents=True, exist_ok=True)
    pdf_file_ref = book_dir_ref / "clean_code.pdf"
    pdf_file_ref.write_text("pdf content")

    payload_ref = {
        "title": "Clean Code Ref",
        "resource_type": "book",
        "category": "Software",
        "author": "Robert C. Martin",
        "source_path": str(book_dir_ref.resolve()),
        "storage_strategy": "reference"
    }

    response = client.post("/api/v1/content/import", json=payload_ref)
    assert response.status_code == 201
    res_data = response.json()
    book_id = res_data["resource_id"]

    book = db.get(Book, book_id)
    assert book is not None
    assert book.title == "Clean Code Ref"
    assert book.author == "Robert C. Martin"

    stmt_asset = select(MediaAsset).where(MediaAsset.resource_id == book.id)
    asset = db.scalars(stmt_asset).first()
    assert asset is not None
    assert asset.file_path == str(pdf_file_ref.resolve())
