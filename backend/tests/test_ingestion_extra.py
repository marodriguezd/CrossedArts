import pytest
import uuid
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.core.settings import settings
from backend.app.models.resource import Course, MediaAsset
from backend.app.models.course_structure import Module, Lesson
from backend.app.schemas.ingestion import ImportResourceRequest
from backend.app.services.ingestion import IngestionService


@pytest.fixture(autouse=True)
def setup_test_env(tmp_path: Path, monkeypatch):
    test_home = tmp_path / "test_home"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)
    settings.ensure_dirs()


def test_import_course_flat_strategy(db: Session):
    # Crear un directorio de origen con archivos multimedia sueltos en subcarpetas dentro de data_dir
    source_dir = settings.data_dir / "my_flat_course"
    source_dir.mkdir(parents=True, exist_ok=True)
    (source_dir / "intro.mp4").write_text("video 1")
    (source_dir / "outro.mp4").write_text("video 2")

    request = ImportResourceRequest(
        title="Curso Plano",
        resource_type="course",
        category="Tech",
        source_path=str(source_dir.resolve()),
        storage_strategy="reference",
        structure_strategy="flat"  # FLAT STRATEGY
    )

    manager = IngestionService(db)
    result = manager.import_resource(request)

    assert result.title == "Curso Plano"
    assert result.modules_created == 1
    assert result.lessons_created == 2

    # Verificar BD
    course = db.get(Course, uuid.UUID(result.resource_id))
    assert course is not None
    
    modules = db.scalars(select(Module).where(Module.course_id == course.id)).all()
    assert len(modules) == 1
    assert modules[0].title == "Contenido Principal"

    lessons = db.scalars(select(Lesson).where(Lesson.module_id == modules[0].id)).all()
    assert len(lessons) == 2


def test_import_course_with_root_media_files(db: Session):
    # Crear un curso con subcarpetas y también archivos de video sueltos en la raíz dentro de data_dir
    source_dir = settings.data_dir / "mixed_course"
    source_dir.mkdir(parents=True, exist_ok=True)
    
    mod_dir = source_dir / "Módulo Uno"
    mod_dir.mkdir(parents=True, exist_ok=True)
    (mod_dir / "video1.mp4").write_text("video 1")

    # Archivo en la raíz
    (source_dir / "extra_material.mp4").write_text("video 2")

    request = ImportResourceRequest(
        title="Curso Mixto",
        resource_type="course",
        category="Tech",
        source_path=str(source_dir.resolve()),
        storage_strategy="reference",
        structure_strategy="auto_hierarchical"
    )

    manager = IngestionService(db)
    result = manager.import_resource(request)

    # Debe haber creado el Módulo Uno más el módulo "Material Adicional" para la raíz
    assert result.modules_created == 2
    assert result.lessons_created == 2

    course = db.get(Course, uuid.UUID(result.resource_id))
    modules = db.scalars(select(Module).where(Module.course_id == course.id)).all()
    module_titles = [m.title for m in modules]
    assert "Módulo Uno" in module_titles
    assert "Material Adicional" in module_titles
