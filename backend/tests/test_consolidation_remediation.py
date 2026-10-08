"""Remediation de las capas backend: notas autónomas, ámbito de sesión e idempotencia.

Cubre los hallazgos de la auditoría final:

- **Nota autónoma**: `note.resource_id` es nullable y el borrado del recurso o
  de la lección DESVINCULA la nota en lugar de destruirla (mismo contrato que
  el frontend SQLite WASM). No se crean recursos de relleno.
- **Ámbito de sesión**: los tres ámbitos canónicos (`lesson`, `resource`,
  `global`) se derivan de las anclas, se validan y se persisten.
- **Finalización idempotente**: repetir `end_session` no cambia el resultado ni
  vuelve a aplicar la actualización de metas.
- **Relaciones de grafo**: `parse_note_relations` es una única transacción,
  idempotente y determinista.
- **Límite acotado**: `/resources/recent` rechaza `limit` fuera de 1..100.
"""
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.app.models.activity import LearningSession, Note, resolve_session_scope
from backend.app.models.base import ResourceStatus
from backend.app.models.course_structure import Lesson, Module
from backend.app.models.knowledge import KnowledgeConnection
from backend.app.models.resource import Book, Course
from backend.app.models.workflow import Goal
from backend.app.schemas.note import CreateNoteRequest
from backend.app.services.knowledge_service import KnowledgeService
from backend.app.services.note import NoteService
from backend.app.services.session import SessionService
from backend.app.services.workflow import WorkflowService


# ===========================================================================
# Nota autónoma
# ===========================================================================

def test_note_can_be_standalone(db: Session):
    """Una nota sin recurso es válida: es un concepto de primera clase."""
    note = NoteService.create_note(db, None, "Idea suelta sobre óptica")
    assert note.resource_id is None
    assert note.content == "Idea suelta sobre óptica"

    fetched = db.get(Note, note.id)
    assert fetched is not None
    assert fetched.resource_id is None


def test_standalone_note_api_roundtrip(client: TestClient):
    """La API acepta y devuelve notas autónomas sin inventar un recurso."""
    response = client.post("/api/v1/notes", json={"content": "Nota sin destino"})
    assert response.status_code == 201
    assert response.json()["resource_id"] is None

    listed = client.get("/api/v1/notes")
    assert listed.status_code == 200
    assert any(n["id"] == response.json()["id"] for n in listed.json())


def test_standalone_note_keeps_no_fake_resource(db: Session):
    """No se crea un recurso de relleno para 'arreglar' el vínculo."""
    resources_before = len(db.scalars(select(Course)).all()) + len(db.scalars(select(Book)).all())
    note = NoteService.create_note(db, None, "Sin ancla")
    resources_after = len(db.scalars(select(Course)).all()) + len(db.scalars(select(Book)).all())
    assert resources_before == resources_after
    assert note.resource_id is None


def test_note_lesson_linkage_is_preserved(db: Session):
    """El vínculo con la lección se conserva cuando existe."""
    course = Course(id=uuid.uuid4(), title="Curso Nota Lección", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo Nota", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección Nota", order_index=1,
                    duration_minutes=5, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    note = NoteService.create_note(db, course.id, "Con lección", lesson_id=lesson.id)
    assert note.lesson_id == lesson.id
    assert note.resource_id == course.id

    assert NoteService.list_notes_by_lesson(db, lesson.id)


def test_deleting_resource_unlinks_notes_instead_of_destroying_them(db: Session):
    """Borrar el recurso DESVINCULA la nota; el trabajo del usuario sobrevive."""
    book = Book(id=uuid.uuid4(), title="Libro con notas", reading_percentage=0.0)
    db.add(book)
    db.commit()

    note = NoteService.create_note(db, book.id, "Nota importante del usuario")
    db.delete(book)
    db.commit()

    surviving = db.get(Note, note.id)
    assert surviving is not None, "La nota del usuario nunca se destruye al reorganizar su biblioteca"
    assert surviving.resource_id is None
    assert surviving.content == "Nota importante del usuario"


def test_deleting_lesson_unlinks_notes_instead_of_destroying_them(db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Nota Huérfana", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo Huérfano", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección Huérfana", order_index=1,
                    duration_minutes=5, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    note = NoteService.create_note(db, course.id, "Nota de una lección", lesson_id=lesson.id)
    db.delete(lesson)
    db.commit()

    surviving = db.get(Note, note.id)
    assert surviving is not None
    assert surviving.lesson_id is None


def test_create_note_still_rejects_unknown_anchors(db: Session):
    """Un ancla inexistente sigue siendo un error: no se crean notas fantasma."""
    with pytest.raises(ValueError, match="no encontrado"):
        NoteService.create_note(db, uuid.uuid4(), "Nota a recurso inexistente")
    with pytest.raises(ValueError, match="no encontrada"):
        NoteService.create_note(db, None, "Nota a lección inexistente", lesson_id=uuid.uuid4())


def test_note_schema_accepts_missing_resource():
    assert CreateNoteRequest(content="Sin recurso").resource_id is None


# ===========================================================================
# Ámbito de sesión (tres ámbitos canónicos)
# ===========================================================================

def test_resolve_session_scope_table():
    assert resolve_session_scope(resource_id=uuid.uuid4()) == "resource"
    assert resolve_session_scope(lesson_id=uuid.uuid4()) == "lesson"
    assert resolve_session_scope(resource_id=uuid.uuid4(), lesson_id=uuid.uuid4()) == "lesson"
    assert resolve_session_scope() == "global"


def test_global_session_is_persisted_with_explicit_scope(db: Session):
    session = SessionService.start_session(db)
    assert session.scope == "global"
    assert session.resource_id is None and session.lesson_id is None

    reloaded = db.get(LearningSession, session.id)
    assert reloaded is not None and reloaded.scope == "global"


def test_global_session_api_response_includes_scope(client: TestClient):
    response = client.post("/api/v1/sessions/start", json={})
    assert response.status_code == 201
    assert response.json()["scope"] == "global"


def test_lesson_and_resource_sessions_persist_their_scope(db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Ámbitos", status=ResourceStatus.NOT_STARTED)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Módulo Ámbitos", order_index=1)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección Ámbitos", order_index=1,
                    duration_minutes=5, is_completed=False)
    db.add_all([course, module, lesson])
    db.commit()

    lesson_session = SessionService.start_session(db, resource_id=course.id, lesson_id=lesson.id)
    resource_session = SessionService.start_session(db, resource_id=course.id)
    assert lesson_session.scope == "lesson"
    assert resource_session.scope == "resource"


def test_scope_is_kept_coherent_when_anchors_change(db: Session):
    """El modelo reclasifica el ámbito si las anclas dejan de estar presentes."""
    session = SessionService.start_session(db)
    assert session.scope == "global"

    # Pasar a recurso: el ámbito derivado cambia y así se persiste.
    book = Book(id=uuid.uuid4(), title="Libro Ámbito", reading_percentage=0.0)
    db.add(book)
    db.flush()
    session.resource_id = book.id
    db.flush()
    assert session.scope == "resource"


# ===========================================================================
# Finalización idempotente
# ===========================================================================

def test_end_session_is_idempotent(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro Idempotencia", reading_percentage=0.0)
    db.add(book)
    db.commit()

    session = SessionService.start_session(db, resource_id=book.id)
    first = SessionService.end_session(db, session.id)
    ended_at = first.ended_at
    duration = first.duration_minutes

    second = SessionService.end_session(db, session.id)
    assert second.ended_at == ended_at, "Repetir la finalización no mueve la marca de fin"
    assert second.duration_minutes == duration
    assert second.ended_at is not None


def test_end_session_applies_goal_update_exactly_once(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro Metas", reading_percentage=0.0)
    db.add(book)
    db.commit()

    goal = Goal(
        id=uuid.uuid4(),
        title="Estudiar 60 minutos",
        target_type="study_minutes",
        resource_id=book.id,
        target_value=60.0,
        current_value=0.0,
        is_completed=False,
    )
    db.add(goal)
    db.commit()

    session = SessionService.start_session(db, resource_id=book.id)
    SessionService.end_session(db, session.id)
    SessionService.end_session(db, session.id)
    SessionService.end_session(db, session.id)

    db.refresh(goal)
    assert goal.current_value == pytest.approx(session.duration_minutes), \
        "Las metas se actualizan UNA vez por finalización, no tres"
    assert goal.is_completed is False


def test_heartbeat_after_finalization_does_not_rewrite_the_session(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro Latido", reading_percentage=0.0)
    db.add(book)
    db.commit()

    session = SessionService.start_session(db, resource_id=book.id)
    finalized = SessionService.end_session(db, session.id)
    ended_at = finalized.ended_at

    SessionService.update_session_heartbeat(db, session.id)
    db.refresh(session)
    assert session.ended_at == ended_at, "Un latido posterior no reabre una sesión finalizada"


def test_end_session_unknown_id_still_fails(db: Session):
    with pytest.raises(ValueError, match="no encontrada"):
        SessionService.end_session(db, uuid.uuid4())


# ===========================================================================
# Relaciones del grafo: atomicidad e idempotencia
# ===========================================================================

def _note_edges(db: Session, note_id: uuid.UUID) -> list:
    return list(db.scalars(select(KnowledgeConnection).where(
        KnowledgeConnection.source_id == note_id,
        KnowledgeConnection.source_type == "note",
    )).all())


def test_repeated_parsing_does_not_duplicate_edges(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro Grafo", reading_percentage=0.0)
    db.add(book)
    db.commit()

    note = NoteService.create_note(db, book.id, "Habla de #fotografia y [[contraste]]")

    first = sorted(
        (c.target_id, c.target_type, c.connection_type) for c in _note_edges(db, note.id)
    )
    KnowledgeService.parse_note_relations(db, note.id, commit=True)
    second = sorted(
        (c.target_id, c.target_type, c.connection_type) for c in _note_edges(db, note.id)
    )
    assert first == second, "La regeneración es idempotente"
    assert len(second) > 0


def test_relation_regeneration_is_deterministic(db: Session):
    book = Book(id=uuid.uuid4(), title="Libro Determinista", reading_percentage=0.0)
    db.add(book)
    db.commit()

    note = NoteService.create_note(db, book.id, "Conceptos #a #b #c y enlaces [[uno]] [[dos]]")

    runs = []
    for _ in range(3):
        KnowledgeService.parse_note_relations(db, note.id, commit=True)
        runs.append(sorted(
            (c.target_type, c.connection_type) for c in _note_edges(db, note.id)
        ))
    assert runs[0] == runs[1] == runs[2]


def test_failed_parse_leaves_previous_edges_untouched(db: Session, monkeypatch):
    book = Book(id=uuid.uuid4(), title="Libro Fallo", reading_percentage=0.0)
    db.add(book)
    db.commit()

    note = NoteService.create_note(db, book.id, "Texto con #estable")
    before = sorted((c.target_id, c.target_type, c.connection_type) for c in _note_edges(db, note.id))

    original = KnowledgeService.create_connection

    def exploding(*args, **kwargs):
        raise RuntimeError("fallo de parseo")

    monkeypatch.setattr(KnowledgeService, "create_connection", staticmethod(exploding))
    with pytest.raises(RuntimeError):
        KnowledgeService.parse_note_relations(db, note.id, commit=True)
    db.rollback()
    monkeypatch.setattr(KnowledgeService, "create_connection", staticmethod(original))

    after = sorted((c.target_id, c.target_type, c.connection_type) for c in _note_edges(db, note.id))
    assert after == before, "Un parseo fallido no deja el conjunto de aristas a medias"


def test_parse_note_relations_commits_once(db: Session, monkeypatch):
    """El parseo confirma UNA sola vez: nada de commit por arista."""
    book = Book(id=uuid.uuid4(), title="Libro Commit", reading_percentage=0.0)
    db.add(book)
    db.commit()
    note = NoteService.create_note(db, book.id, "Muchos #conceptos #varios #aqui #alla #mas")

    commits = []
    original_commit = db.commit

    def counting_commit():
        commits.append(1)
        return original_commit()

    monkeypatch.setattr(db, "commit", counting_commit)
    KnowledgeService.parse_note_relations(db, note.id, commit=True)
    assert len(commits) == 1


def test_standalone_note_has_no_containment_edge(db: Session):
    """Una nota autónoma no inventa una arista de contención."""
    note = NoteService.create_note(db, None, "Autónoma #idea")
    edges = _note_edges(db, note.id)
    assert all(e.target_type != "resource" for e in edges)
    assert any(e.target_type == "concept" for e in edges)


# ===========================================================================
# Límite acotado en /resources/recent
# ===========================================================================

def test_recent_resources_limit_is_bounded(client: TestClient, db: Session):
    db.add(Book(id=uuid.uuid4(), title="Libro Reciente", reading_percentage=0.0))
    db.commit()

    assert client.get("/api/v1/resources/recent?limit=5").status_code == 200
    assert client.get("/api/v1/resources/recent?limit=100").status_code == 200
    assert client.get("/api/v1/resources/recent?limit=0").status_code == 422
    assert client.get("/api/v1/resources/recent?limit=101").status_code == 422
    assert client.get("/api/v1/resources/recent?limit=-1").status_code == 422

def test_dashboard_recent_activity_only_lists_finalized_sessions(db: Session, client: TestClient):
    """Una sesión en curso (con latido, sin cierre formal) no es actividad cerrada."""
    running_book = Book(id=uuid.uuid4(), title="Libro En Curso", reading_percentage=0.0)
    finished_book = Book(id=uuid.uuid4(), title="Libro Finalizado", reading_percentage=0.0)
    db.add_all([running_book, finished_book])
    db.commit()

    running = SessionService.start_session(db, resource_id=running_book.id)
    SessionService.update_session_heartbeat(db, running.id)

    finished = SessionService.start_session(db, resource_id=finished_book.id)
    SessionService.end_session(db, finished.id)

    response = client.get("/api/v1/dashboard/recent-activity")
    assert response.status_code == 200
    titles = [item.get("resource_title") for item in response.json()]
    assert "Libro Finalizado" in titles, "La sesión finalizada sí aparece"
    assert "Libro En Curso" not in titles, "Una sesión en curso no es actividad cerrada"
