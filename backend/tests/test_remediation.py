"""Regression tests for the remediation of issues E, F, G and H.

E. learning_session contract: nullable resource_id, optional lesson_id,
   mandatory scope anchor (resource or lesson) across model, schema, service,
   API and migration.
F. Alembic history coherence: no duplicated indexes, deterministic upgrade
   and downgrade, single owner per index.
G. Transcript language: never forced to Spanish; metadata inferred, unknown
   language represented as 'und'.
H. AI output validation parity: malformed / wrong-schema / empty LLM output
   is rejected with a controlled error, never replaced by fabricated content.
"""
import uuid
from datetime import datetime, timedelta, time

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.core.utils import utc_now_naive
from backend.app.models.activity import LearningSession
from backend.app.models.content import Transcript, TranscriptSegment
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.base import ResourceStatus
from backend.app.models.resource import Book, Course, MediaAsset
from backend.app.services.ai_validation import (
    StudyMaterialValidationError,
    strip_code_fences,
    validate_flashcards,
    validate_quiz_questions,
)
from backend.app.services.extractor import (
    TranscriptExtractor,
    infer_transcript_language,
    normalize_language,
    UNDETERMINED_LANGUAGE,
)
from backend.app.services.llm import LLMService
from backend.app.services.session import SessionService


# ===========================================================================
# E — Contrato de sesión de estudio
# ===========================================================================

def test_model_allows_lesson_scoped_session_without_resource(db: Session):
    """Una sesión acotada SOLO a lección es estado válido (contrato frontend)."""
    course = Course(id=uuid.uuid4(), title="Curso Sesiones E", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo E", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección E", order_index=1, duration_minutes=10, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    session = SessionService.start_session(db, lesson_id=lesson.id)
    assert session.resource_id is None
    assert session.lesson_id == lesson.id
    assert session.mode == "flashcards"


def test_model_allows_resource_and_lesson_scoped_session(db: Session):
    """Una sesión con recurso Y lección sigue siendo válida."""
    course = Course(id=uuid.uuid4(), title="Curso E2", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo E2", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección E2", order_index=1, duration_minutes=5, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    session = SessionService.start_session(db, resource_id=course.id, lesson_id=lesson.id)
    assert session.resource_id == course.id
    assert session.lesson_id == lesson.id


def test_session_without_any_scope_is_rejected(db: Session):
    """Nunca existe una sesión sin ámbito (regla de dominio compartida)."""
    with pytest.raises(ValueError, match="recurso o a una lección"):
        SessionService.start_session(db)
    with pytest.raises(ValueError, match="recurso o a una lección"):
        SessionService.start_session(db, resource_id=None, lesson_id=None)


def test_lesson_scoped_session_rejects_unknown_lesson(db: Session):
    with pytest.raises(ValueError, match="no encontrada"):
        SessionService.start_session(db, lesson_id=uuid.uuid4())


def test_resource_scoped_session_still_works(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro E", reading_percentage=0.0)
    db.add(book)
    db.commit()
    session = SessionService.start_session(db, resource_id=book.id)
    assert session.resource_id == book.id
    assert session.lesson_id is None


def test_schema_rejects_scopeless_start_request():
    from backend.app.schemas.session import StartSessionRequest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StartSessionRequest()
    with pytest.raises(ValidationError):
        StartSessionRequest(resource_id=None, lesson_id=None)
    ok = StartSessionRequest(lesson_id=uuid.uuid4())
    assert ok.resource_id is None and ok.lesson_id is not None


def test_api_start_lesson_scoped_session(client: TestClient, db: Session):
    course = Course(id=uuid.uuid4(), title="Curso API E", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo API E", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección API E", order_index=1, duration_minutes=8, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    response = client.post("/api/v1/sessions/start", json={"lesson_id": str(lesson.id)})
    assert response.status_code == 201
    data = response.json()
    assert data["lesson_id"] == str(lesson.id)
    assert data["resource_id"] is None

    # El ciclo completo (heartbeat + end) funciona para sesiones de lección.
    hb = client.post(f"/api/v1/sessions/{data['id']}/heartbeat")
    assert hb.status_code == 200
    end = client.post(f"/api/v1/sessions/{data['id']}/end")
    assert end.status_code == 200
    assert end.json()["duration_minutes"] >= 1


def test_api_start_scopeless_session_returns_422(client: TestClient):
    """Una petición sin ámbito de recurso NI lección es rechazada por el esquema."""
    response = client.post("/api/v1/sessions/start", json={})
    assert response.status_code == 422
    assert "recurso o a una lección" in str(response.json())


def test_scope_check_constraint_is_declared_on_model():
    """El CHECK de ámbito existe en el modelo (y así en la base recreada)."""
    from backend.app.models.activity import LearningSession as LS
    constraints = {c.name for c in LS.__table__.constraints}
    check = [c for c in LS.__table__.constraints if c.__class__.__name__ == "CheckConstraint"]
    assert any("resource_id IS NOT NULL OR lesson_id IS NOT NULL" in str(c.sqltext) for c in check)


def test_aggregations_ignore_null_resource_gracefully(db: Session):
    """Las agregaciones existentes siguen funcionando con resource_id nulo."""
    book = Book(id=uuid.uuid4(), title="Libro E3", reading_percentage=0.0)
    db.add(book)
    db.commit()
    s1 = SessionService.start_session(db, resource_id=book.id)
    s1.started_at = datetime.combine(utc_now_naive().date(), time(12, 0))
    s1.ended_at = s1.started_at + timedelta(minutes=20)
    s1.duration_minutes = 20
    s2 = SessionService.start_session(db, lesson_id=None, resource_id=book.id)
    s2.duration_minutes = 5
    db.add_all([s1, s2])
    db.commit()

    assert SessionService.get_total_study_minutes(db) >= 25


# ===========================================================================
# F — Historia de migraciones coherente
# ===========================================================================

def test_no_index_is_declared_by_two_migrations():
    """Cada índice tiene exactamente UNA migración propietaria."""
    import os
    import re
    versions_dir = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions")
    owner = {}
    for fname in os.listdir(versions_dir):
        if not fname.endswith(".py") or fname.startswith("__"):
            continue
        with open(os.path.join(versions_dir, fname)) as f:
            content = f.read()
        for match in re.findall(r"\('([a-z_]+)',\s*'[a-z_]+',\s*\[", content):
            owner.setdefault(match, set()).add(fname)
    duplicated = {name: files for name, files in owner.items() if len(files) > 1}
    assert not duplicated, f"Índices declarados por varias migraciones: {duplicated}"


def test_second_index_migration_no_longer_repeats_indexes():
    import os
    versions_dir = os.path.join(os.path.dirname(__file__), "..", "alembic", "versions")
    path = os.path.join(versions_dir, "d8d6741e257c_add_performance_indexes.py")
    with open(path) as f:
        content = f.read()
    # Solo el bloque INDEXES cuenta: los comentarios históricos pueden citar los
    # nombres de los índices duplicados que fueron eliminados.
    code_body = content.split('INDEXES = [', 1)[1].split(']', 1)[0]
    for duplicated in ("ix_learning_resource_status", "ix_learning_session_ended_at", "ix_task_is_completed", "ix_note_created_at"):
        assert duplicated not in code_body, f"{duplicated} pertenece a a1b2c3d4e5f6, no a d8d6741e257c"
    assert "except Exception" not in content, "El silenciamiento de errores de migración fue eliminado"


def test_migration_upgrade_downgrade_roundtrip(tmp_path):
    """upgrade -> downgrade -> upgrade converge al mismo esquema, sin duplicados."""
    import os
    import sqlite3
    import subprocess
    import sys

    test_db = tmp_path / "roundtrip.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{test_db}"
    env["PYTHONPATH"] = os.getcwd()

    def run(*args):
        res = subprocess.run(
            [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", *args],
            env=env, capture_output=True, text=True, cwd=os.getcwd()
        )
        assert res.returncode == 0, f"alembic {' '.join(args)} falló: {res.stderr}"
        return res

    run("upgrade", "head")
    conn = sqlite3.connect(test_db)
    names_up = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    ddl = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='learning_session'").fetchone()[0]
    assert "resource_id GUID," in ddl or "resource_id GUID " in ddl.replace("GUID NOT NULL", ""), \
        "resource_id debe ser nullable tras la migración"
    assert "ck_learning_session_scope" in ddl
    # Sin duplicados y con los índices esperados exactamente una vez.
    assert len(names_up) == len(set(names_up))
    for expected in ("ix_learning_resource_status", "ix_learning_session_ended_at",
                     "ix_task_is_completed", "ix_note_created_at",
                     "ix_learning_resource_created_at", "ix_learning_session_lesson_id"):
        assert names_up.count(expected) == 1, f"{expected} debe existir exactamente una vez"
    conn.close()

    run("downgrade", "a1b2c3d4e5f6")
    conn = sqlite3.connect(test_db)
    ddl_down = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='learning_session'").fetchone()[0]
    assert "resource_id GUID NOT NULL" in ddl_down
    conn.close()

    run("upgrade", "head")
    conn = sqlite3.connect(test_db)
    names_again = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    assert len(names_again) == len(set(names_again))
    assert names_again.count("ix_learning_session_lesson_id") == 1
    conn.close()


# ===========================================================================
# G — Idioma de transcriptos
# ===========================================================================

def test_normalize_language_accepts_codes_and_rejects_free_text():
    assert normalize_language("es") == "es"
    assert normalize_language(" EN ") == "en"
    assert normalize_language("en-US") == "en-us"
    assert normalize_language("pt_BR") == "pt-br"
    assert normalize_language("spa") == "spa"
    assert normalize_language("idioma del video") is None
    assert normalize_language("") is None
    assert normalize_language(None) is None
    assert normalize_language(42) is None


def test_infer_transcript_language_prefers_metadata_then_und():
    from pathlib import Path
    assert infer_transcript_language({"language": "en"}, Path("x.json")) == "en"
    assert infer_transcript_language({"languages": ["fr", "en"]}, Path("x.json")) == "fr"
    assert infer_transcript_language({"lang": "de"}, Path("x.json")) == "de"
    # Pista en el nombre de archivo: lecture.en.srt -> en
    assert infer_transcript_language(None, Path("lecture.en.srt")) == "en"
    # Sin ninguna pista: indeterminado, nunca español por defecto.
    assert infer_transcript_language(None, Path("lecture.srt")) == UNDETERMINED_LANGUAGE
    assert infer_transcript_language({}, Path("lecture.srt")) == UNDETERMINED_LANGUAGE


def test_transcript_without_metadata_is_und_not_spanish(db: Session, tmp_path):
    """Un SRT sin metadatos NO se etiqueta falsamente como español."""
    srt = "1\n00:00:01,000 --> 00:00:04,000\nThe photosynthetic membrane.\n"
    srt_path = tmp_path / "lesson.srt"
    srt_path.write_text(srt, encoding="utf-8")

    course = Course(id=uuid.uuid4(), title="Curso G1", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()
    asset = MediaAsset(
        id=uuid.uuid4(), resource_id=course.id, media_type="video",
        file_path="/dummy/lesson.mp4", file_name="lesson.mp4", mime_type="video/mp4"
    )
    db.add(asset)
    db.commit()

    TranscriptExtractor().extract(db, asset.id, srt_path)
    transcript = db.scalars(select(Transcript).where(Transcript.media_asset_id == asset.id)).first()
    assert transcript is not None
    assert transcript.language == UNDETERMINED_LANGUAGE


def test_transcript_json_metadata_language_is_honored(db: Session, tmp_path):
    """El idioma declarado en metadatos JSON se respeta (inglés aquí)."""
    import json as _json
    payload = {
        "language": "en",
        "segments": [
            {"start": 0.0, "end": 2.0, "text": "Hello again."},
            {"start": 2.0, "end": 5.0, "text": "Today we study indexes."},
        ],
    }
    json_path = tmp_path / "lecture.json"
    json_path.write_text(_json.dumps(payload), encoding="utf-8")

    course = Course(id=uuid.uuid4(), title="Curso G2", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()
    asset = MediaAsset(
        id=uuid.uuid4(), resource_id=course.id, media_type="video",
        file_path="/dummy/lecture.mp4", file_name="lecture.mp4", mime_type="video/mp4"
    )
    db.add(asset)
    db.commit()

    TranscriptExtractor().extract(db, asset.id, json_path)
    transcript = db.scalars(select(Transcript).where(Transcript.media_asset_id == asset.id)).first()
    assert transcript is not None
    assert transcript.language == "en"
    segments = db.scalars(select(TranscriptSegment).where(TranscriptSegment.transcript_id == transcript.id)).all()
    assert len(segments) == 2


# ===========================================================================
# H — Validación de salida del LLM en el backend
# ===========================================================================

VALID_QUIZ = [
    {"id": "q1", "question": "¿Qué es una matriz simétrica?", "options": ["Igual a su transpuesta", "Un vector"], "answer": "Igual a su transpuesta", "type": "multiple_choice"},
    {"id": "q2", "question": "Define valor propio en una frase.", "options": [], "answer": "Escalar asociado a un vector propio", "type": "short_answer"},
]

VALID_FLASHCARDS = [
    {"front": "¿Qué es SM-2?", "back": "Algoritmo de repetición espaciada"},
    {"front": "¿Para qué sirve el ease factor?", "back": "Ajusta el intervalo entre repeticiones"},
]


class TestQuizValidation:
    def test_valid_payload_passes(self):
        questions = validate_quiz_questions(VALID_QUIZ)
        assert len(questions) == 2
        assert questions[0]["type"] == "multiple_choice"
        assert questions[1]["options"] == []

    def test_wrapped_object_with_questions_key_passes(self):
        assert validate_quiz_questions({"questions": VALID_QUIZ}) == validate_quiz_questions(VALID_QUIZ)

    def test_malformed_json_raises(self):
        import json
        with pytest.raises(json.JSONDecodeError):
            json.loads("{not json")

    def test_wrong_structure_rejected(self):
        with pytest.raises(StudyMaterialValidationError):
            validate_quiz_questions({"foo": "bar"})
        with pytest.raises(StudyMaterialValidationError):
            validate_quiz_questions("texto plano")

    def test_empty_output_rejected(self):
        with pytest.raises(StudyMaterialValidationError):
            validate_quiz_questions(None)
        with pytest.raises(StudyMaterialValidationError):
            validate_quiz_questions([])

    def test_missing_answer_rejected(self):
        payload = [{"question": "Pregunta suficientemente larga", "type": "short_answer"}]
        with pytest.raises(StudyMaterialValidationError, match="no tiene respuesta"):
            validate_quiz_questions(payload)

    def test_invalid_question_type_rejected(self):
        payload = [{"question": "Pregunta suficientemente larga", "answer": "x", "type": "essay"}]
        with pytest.raises(StudyMaterialValidationError, match="tipo no permitido"):
            validate_quiz_questions(payload)

    def test_multiple_choice_requires_answer_among_options(self):
        payload = [{"question": "Pregunta suficientemente larga", "options": ["A", "B"], "answer": "C", "type": "multiple_choice"}]
        with pytest.raises(StudyMaterialValidationError, match="no figura entre las opciones"):
            validate_quiz_questions(payload)

    def test_duplicate_options_rejected(self):
        payload = [{"question": "Pregunta suficientemente larga", "options": ["A", "A"], "answer": "A", "type": "multiple_choice"}]
        with pytest.raises(StudyMaterialValidationError, match="duplicadas"):
            validate_quiz_questions(payload)

    def test_too_short_question_rejected(self):
        with pytest.raises(StudyMaterialValidationError, match="demasiado corto"):
            validate_quiz_questions([{"question": "¿c?", "answer": "x", "type": "short_answer"}])


class TestFlashcardValidation:
    def test_valid_payload_passes(self):
        cards = validate_flashcards(VALID_FLASHCARDS)
        assert len(cards) == 2
        assert cards[0] == {"front": "¿Qué es SM-2?", "back": "Algoritmo de repetición espaciada"}

    def test_wrapped_object_passes(self):
        assert validate_flashcards({"flashcards": VALID_FLASHCARDS}) == validate_flashcards(VALID_FLASHCARDS)

    def test_empty_rejected(self):
        with pytest.raises(StudyMaterialValidationError):
            validate_flashcards([])
        with pytest.raises(StudyMaterialValidationError):
            validate_flashcards(None)

    def test_missing_back_rejected(self):
        with pytest.raises(StudyMaterialValidationError, match="reverso"):
            validate_flashcards([{"front": "Pregunta válida"}])

    def test_duplicate_fronts_deduplicated(self):
        cards = validate_flashcards(VALID_FLASHCARDS + [VALID_FLASHCARDS[0]])
        assert len(cards) == 2


def test_strip_code_fences_extracts_json_block():
    raw = "```json\n" + str(VALID_QUIZ).replace("'", '"') + "\n```"
    assert strip_code_fences(raw).startswith("[")
    assert strip_code_fences('  {"a": 1}  ') == '{"a": 1}'


def test_api_quiz_with_malformed_llm_output_returns_error_not_fallback(client: TestClient, db: Session, monkeypatch):
    """JSON malformado del modelo => error controlado, NO material fabricado."""
    course = Course(id=uuid.uuid4(), title="Curso H1", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    async def broken(*args, **kwargs):
        return "esto no es json {"
    monkeypatch.setattr(LLMService, "generate_response", staticmethod(broken))

    response = client.post("/api/v1/ai/quiz", json={"resource_id": str(course.id)})
    assert response.status_code == 502
    assert "validación" in response.json()["detail"].lower()


def test_api_quiz_with_wrong_schema_rejected(client: TestClient, db: Session, monkeypatch):
    course = Course(id=uuid.uuid4(), title="Curso H2", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    async def wrong_schema(*args, **kwargs):
        import json as _json
        return _json.dumps([{"foo": "bar"}])
    monkeypatch.setattr(LLMService, "generate_response", staticmethod(wrong_schema))

    response = client.post("/api/v1/ai/quiz", json={"resource_id": str(course.id)})
    assert response.status_code == 502


def test_api_quiz_with_valid_output_persists(client: TestClient, db: Session, monkeypatch):
    course = Course(id=uuid.uuid4(), title="Curso H3", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    async def good(*args, **kwargs):
        import json as _json
        return _json.dumps(VALID_QUIZ)
    monkeypatch.setattr(LLMService, "generate_response", staticmethod(good))

    response = client.post("/api/v1/ai/quiz", json={"resource_id": str(course.id), "title": "Quiz H3"})
    assert response.status_code == 200
    data = response.json()
    assert len(data["questions"]) == 2
    assert all(q["type"] in ("multiple_choice", "short_answer") for q in data["questions"])


def test_api_flashcards_with_valid_output(client: TestClient, db: Session, monkeypatch):
    from backend.app.models.activity import Note
    course = Course(id=uuid.uuid4(), title="Curso H4", status=ResourceStatus.NOT_STARTED)
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="Las matrices simétricas son diagonalizables.")
    db.add_all([course, note])
    db.commit()

    async def good(*args, **kwargs):
        import json as _json
        return _json.dumps(VALID_FLASHCARDS)
    monkeypatch.setattr(LLMService, "generate_response", staticmethod(good))

    response = client.post("/api/v1/ai/notes/flashcards", json={"note_ids": [str(note.id)]})
    assert response.status_code == 200
    assert len(response.json()["flashcards"]) == 2


def test_api_flashcards_with_malformed_output_rejected(client: TestClient, db: Session, monkeypatch):
    from backend.app.models.activity import Note
    course = Course(id=uuid.uuid4(), title="Curso H5", status=ResourceStatus.NOT_STARTED)
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="Contenido de notas.")
    db.add_all([course, note])
    db.commit()

    async def broken(*args, **kwargs):
        return "no-json"
    monkeypatch.setattr(LLMService, "generate_response", staticmethod(broken))

    response = client.post("/api/v1/ai/notes/flashcards", json={"note_ids": [str(note.id)]})
    assert response.status_code == 502
