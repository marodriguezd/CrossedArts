import uuid
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.activity import Note
from backend.app.models.content import ExtractedMetadata, ContentIndex, Transcript, TranscriptSegment
from backend.app.models.base import ResourceStatus
from backend.app.services.extractor import PDFExtractor, EPUBExtractor, TranscriptExtractor, ContentIntelligenceManager
from backend.app.services.search import SearchService

def test_pdf_extraction(db: Session, tmp_path: Path):
    # Crear un PDF mock básico
    # Como crear un PDF binario real válido requiere pypdf para poder ser leído,
    # podemos escribir un PDF minimalista usando pypdf o usar una firma PDF básica.
    # Dado que instalamos pypdf, podemos usarlo para escribir un archivo PDF simple de prueba.
    from pypdf import PdfWriter
    writer = PdfWriter()
    writer.add_blank_page(width=72, height=72)
    # Agregar algunos metadatos
    writer.add_metadata({
        "/Title": "Libro de Fotografia Avanzada",
        "/Author": "Ansel Adams"
    })
    pdf_path = tmp_path / "test_book.pdf"
    with open(pdf_path, "wb") as f:
        writer.write(f)

    # Crear modelos en BD
    book = Book(id=uuid.uuid4(), title="Test PDF Book", status=ResourceStatus.NOT_STARTED)
    db.add(book)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=book.id,
        media_type="pdf",
        file_path=str(pdf_path.resolve()),
        file_name="test_book.pdf",
        mime_type="application/pdf"
    )
    db.add(asset)
    db.commit()

    # Ejecutar extractor
    extractor = PDFExtractor()
    extractor.extract(db, asset.id, pdf_path)

    # Validar persistencia de metadatos
    meta = db.scalars(select(ExtractedMetadata).where(ExtractedMetadata.media_asset_id == asset.id)).first()
    assert meta is not None
    assert meta.title == "Libro de Fotografia Avanzada"
    assert meta.author == "Ansel Adams"
    assert meta.page_count == 1

    # Validar idempotencia: correr de nuevo no duplica
    extractor.extract(db, asset.id, pdf_path)
    meta_count = db.query(ExtractedMetadata).filter(ExtractedMetadata.media_asset_id == asset.id).count()
    assert meta_count == 1


def test_transcript_extraction_srt(db: Session, tmp_path: Path):
    # Crear srt mock
    srt_content = """1
00:00:01,000 --> 00:00:04,500
Hola y bienvenidos a este curso de fotografia.

2
00:00:04,500 --> 00:00:09,000
Hoy aprenderemos sobre la exposicion y la apertura.
"""
    srt_path = tmp_path / "lesson.srt"
    srt_path.write_text(srt_content, encoding="utf-8")

    # Crear curso y asset
    course = Course(id=uuid.uuid4(), title="Curso de Foto", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    asset = MediaAsset(
        id=uuid.uuid4(),
        resource_id=course.id,
        media_type="video",
        file_path="/dummy/path/lesson.mp4",
        file_name="lesson.mp4",
        mime_type="video/mp4"
    )
    db.add(asset)
    db.commit()

    extractor = TranscriptExtractor()
    extractor.extract(db, asset.id, srt_path)

    # Validar
    transcript = db.scalars(select(Transcript).where(Transcript.media_asset_id == asset.id)).first()
    assert transcript is not None
    assert transcript.language == "es"
    
    segments = db.scalars(select(TranscriptSegment).where(TranscriptSegment.transcript_id == transcript.id)).all()
    assert len(segments) == 2
    assert segments[0].text == "Hola y bienvenidos a este curso de fotografia."
    assert segments[1].start_time == 4.5
    assert segments[1].end_time == 9.0


def test_search_service(db: Session):
    # Crear registros semilla de prueba
    course = Course(id=uuid.uuid4(), title="Aprende Iluminacion", description="Domina el triangulo de exposicion", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    
    # Nota de estudio
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="La regla de los tercios es fundamental para composicion")
    db.add(note)
    db.commit()

    # Ejecutar búsquedas
    res_title = SearchService.search(db, "Iluminacion")
    assert len(res_title) == 1
    assert res_title[0]["match_type"] == "title"
    assert res_title[0]["resource_id"] == course.id

    res_note = SearchService.search(db, "tercios")
    assert len(res_note) == 1
    assert res_note[0]["match_type"] == "note"
    assert "tercios" in res_note[0]["snippet"]
