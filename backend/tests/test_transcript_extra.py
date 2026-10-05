import uuid
import json
import pytest
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import select

from backend.app.models.resource import Course, MediaAsset
from backend.app.models.content import Transcript, TranscriptSegment, ContentIndex
from backend.app.models.base import ResourceStatus
from backend.app.services.extractor import TranscriptExtractor


def test_transcript_extraction_vtt(db: Session, tmp_path: Path):
    vtt_content = """WEBVTT

1
00:01.000 --> 00:04.500
Hola de nuevo.

2
00:01:04.500 --> 00:01:09.000
Prueba de transcripción VTT de dos dígitos para las horas.
"""
    vtt_path = tmp_path / "lesson.vtt"
    vtt_path.write_text(vtt_content, encoding="utf-8")

    course = Course(id=uuid.uuid4(), title="Curso de Foto 2", status=ResourceStatus.NOT_STARTED)
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
    assert extractor.can_handle("text/vtt", vtt_path)
    extractor.extract(db, asset.id, vtt_path)

    # Validar. La fuente VTT no declara idioma: no se etiqueta falsamente como
    # español, se registra como indeterminado ('und').
    transcript = db.scalars(select(Transcript).where(Transcript.media_asset_id == asset.id)).first()
    assert transcript is not None
    assert transcript.language == "und"
    
    segments = db.scalars(select(TranscriptSegment).where(TranscriptSegment.transcript_id == transcript.id)).all()
    assert len(segments) == 2
    assert segments[0].text == "Hola de nuevo."
    assert segments[0].start_time == 1.0
    assert segments[0].end_time == 4.5
    assert segments[1].start_time == 64.5
    assert segments[1].end_time == 69.0


def test_transcript_extraction_json(db: Session, tmp_path: Path):
    json_data = {
        "segments": [
            {"start": 0.0, "end": 2.5, "text": "Segmento uno en JSON."},
            {"start_time": 2.5, "end_time": 5.0, "text": "Segmento dos con start_time."}
        ]
    }
    json_path = tmp_path / "transcript.json"
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(json_data, f)

    course = Course(id=uuid.uuid4(), title="Curso JSON", status=ResourceStatus.NOT_STARTED)
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
    assert extractor.can_handle("application/json", json_path)
    extractor.extract(db, asset.id, json_path)

    transcript = db.scalars(select(Transcript).where(Transcript.media_asset_id == asset.id)).first()
    assert transcript is not None
    
    segments = db.scalars(select(TranscriptSegment).where(TranscriptSegment.transcript_id == transcript.id)).all()
    assert len(segments) == 2
    assert segments[0].text == "Segmento uno en JSON."
    assert segments[1].text == "Segmento dos con start_time."
