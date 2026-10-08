import uuid
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select
from fastapi.testclient import TestClient

from backend.app.services.thumbnail import ThumbnailService
from backend.app.services.scanner import CourseScanner, BookScanner
from backend.app.models.base import ResourceStatus
from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.activity import MediaProgress
from backend.app.models.course_structure import Module, Lesson

def test_thumbnail_resolution_precedence():
    # 1. URL externa
    url = ThumbnailService.resolve_cover_url("http://example.com/cover.png", None, "course")
    assert url == "http://example.com/cover.png"

    # 2. Ruta /static/ que no existe en disco → placeholder
    placeholder = ThumbnailService.resolve_cover_url("/static/covers/test.jpg", None, "book")
    assert placeholder == "/static/placeholders/book_placeholder.png"

    # 3. Ruta /static/ que SÍ existe → se devuelve tal cual
    covers_dir = ThumbnailService.STATIC_DIR / "covers"
    covers_dir.mkdir(parents=True, exist_ok=True)
    test_file = covers_dir / "test.jpg"
    test_file.write_bytes(b"fake-image")
    try:
        static_url = ThumbnailService.resolve_cover_url("/static/covers/test.jpg", None, "book")
        assert static_url == "/static/covers/test.jpg"
    finally:
        test_file.unlink()

    # 4. Fallback a placeholder por defecto (curso)
    assert ThumbnailService.resolve_cover_url(None, None, "course") == "/static/placeholders/course_placeholder.png"

    # 5. Fallback a placeholder por defecto (libro)
    assert ThumbnailService.resolve_cover_url(None, None, "book") == "/static/placeholders/book_placeholder.png"

def test_video_discovery_and_idempotency(db: Session, tmp_path: Path):
    # Crear un directorio temporal de curso con un video
    course_dir = tmp_path / "course_photography"
    course_dir.mkdir()
    
    # Crear video de prueba
    video_file = course_dir / "01_introduction.mp4"
    video_file.write_bytes(b"dummy video content")

    # Ejecutar scanner
    scanner = CourseScanner()
    # 1. Primer escaneo (Descubrimiento y creación)
    created, updated = scanner.scan(db, course_dir, None)
    assert created is True
    
    # Verificar que el curso, la lección heurística y el MediaAsset fueron creados
    course = db.scalars(select(Course).where(Course.title == "course_photography")).first()
    assert course is not None
    
    lessons = db.scalars(select(Lesson).join(Lesson.module).where(Module.course_id == course.id)).all()
    assert len(lessons) == 1
    assert lessons[0].title == "01_introduction"
    
    assets = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == course.id)).all()
    assert len(assets) == 1
    assert assets[0].media_type == "video"
    assert assets[0].file_name == "01_introduction.mp4"
    assert assets[0].lesson_id == lessons[0].id

    # 2. Segundo escaneo (Idempotencia)
    created_2, updated_2 = scanner.scan(db, course_dir, None)
    assert created_2 is False
    assert updated_2 is False
    
    # Las lecciones y activos de medios deben seguir siendo exactamente los mismos
    assets_2 = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == course.id)).all()
    assert len(assets_2) == 1


def test_pdf_discovery_and_epub_foundation(db: Session, tmp_path: Path):
    # Crear directorio de libros temporal
    books_dir = tmp_path / "books"
    books_dir.mkdir()
    book_folder = books_dir / "atomic_habits"
    book_folder.mkdir()

    pdf_file = book_folder / "atomic_habits.pdf"
    pdf_file.write_bytes(b"dummy pdf content")
    
    epub_file = book_folder / "clean_code.epub"
    epub_file.write_bytes(b"dummy epub content")

    scanner = BookScanner()
    
    # Escanear PDF
    created, updated = scanner.scan(db, book_folder, {"resource_type": "book", "title": "Atomic Habits"})
    assert created is True
    
    book = db.scalars(select(Book).where(Book.title == "Atomic Habits")).first()
    assert book is not None
    
    assets = db.scalars(select(MediaAsset).where(MediaAsset.resource_id == book.id)).all()
    assert len(assets) == 2
    types = {a.media_type for a in assets}
    assert "pdf" in types
    assert "epub" in types



def test_media_api_streaming_range_requests(client: TestClient, db: Session):
    # Crear archivo real temporal dentro de ~/.domestik/ para pasar la validación de is_safe_path
    from backend.app.core.settings import settings
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    dummy_file = settings.data_dir / f"stream_video_{uuid.uuid4().hex[:6]}.mp4"
    dummy_content = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    dummy_file.write_bytes(dummy_content)

    try:
        # Crear curso y media asset
        course = Course(id=uuid.uuid4(), title="Test Stream Course", status=ResourceStatus.NOT_STARTED)
        db.add(course)
        db.commit()

        asset = MediaAsset(
            id=uuid.uuid4(),
            resource_id=course.id,
            media_type="video",
            file_path=str(dummy_file.resolve()),
            file_name="stream_video.mp4",
            file_size=len(dummy_content),
            mime_type="video/mp4"
        )
        db.add(asset)
        db.commit()

        # Petición normal sin cabecera Range
        response = client.get(f"/api/v1/media/{asset.id}/stream")
        assert response.status_code in (200, 206)
        assert response.headers["Content-Length"] == str(len(dummy_content))
        assert response.content == dummy_content

        # Petición con cabecera Range bytes=0-9
        response_range = client.get(f"/api/v1/media/{asset.id}/stream", headers={"Range": "bytes=0-9"})
        assert response_range.status_code == 206
        assert response_range.headers["Content-Range"] == f"bytes 0-9/{len(dummy_content)}"
        assert response_range.content == b"0123456789"
    finally:
        if dummy_file.exists():
            dummy_file.unlink()



def test_media_playback_progress_and_completion_threshold(client: TestClient, db: Session):
    # Configurar curso -> módulo -> lección -> media asset
    course = Course(id=uuid.uuid4(), title="Progress Course", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Module 1")
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lesson 1", is_completed=False, duration_minutes=10)
    db.add(course)
    db.add(module)
    db.add(lesson)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=course.id,
        lesson_id=lesson.id,
        media_type="video",
        file_path="/dummy/path/lesson1.mp4",
        file_name="lesson1.mp4",
        mime_type="video/mp4"
    )
    db.add(asset)
    db.commit()

    # 1. Guardar progreso al 50%
    response = client.post(f"/api/v1/media/{asset.id}/progress?position=50.0&duration=100.0")
    assert response.status_code == 200
    data = response.json()
    assert data["last_position"] == 50.0
    assert data["is_watched"] is False

    # Verificar que el progreso esté guardado en BD
    db.expire_all()
    progress = db.scalars(select(MediaProgress).where(MediaProgress.media_asset_id == asset.id)).first()
    assert progress is not None
    assert progress.last_position == 50.0
    
    # La lección asociada NO debe estar completada todavía
    db.refresh(lesson)
    assert lesson.is_completed is False

    # 2. Guardar progreso al 91% (supera el umbral del 90%)
    response_completion = client.post(f"/api/v1/media/{asset.id}/progress?position=91.0&duration=100.0")
    assert response_completion.status_code == 200
    assert response_completion.json()["is_watched"] is True

    # La lección debe haberse completado automáticamente
    db.refresh(lesson)
    assert lesson.is_completed is True
