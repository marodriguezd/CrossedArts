import uuid
import pytest
from sqlalchemy.orm import Session

from backend.app.models.resource import Course, Book
from backend.app.models.activity import Note
from backend.app.models.base import ResourceStatus
from backend.app.schemas.resource import UpdateResourceRequest


@pytest.fixture(autouse=True)
def _patch_session_local(db: Session, monkeypatch):
    """Patch SessionLocal so services_direct uses the in-memory test DB.
    
    We wrap the session so that .close() is a no-op (services_direct
    calls close in its finally blocks, which would detach ORM objects
    from the shared test session).
    """
    class _NoCloseSession:
        def __init__(self, session):
            self._session = session
        def __getattr__(self, name):
            if name == 'close':
                return lambda: None
            return getattr(self._session, name)
        def __bool__(self):
            return True

    import frontend.app.services_direct as sd
    monkeypatch.setattr(sd, "_get_session", lambda: _NoCloseSession(db))


def test_get_resources_direct(db: Session):
    from frontend.app.services_direct import get_resources_direct

    course = Course(id=uuid.uuid4(), title="Curso Direct", status=ResourceStatus.NOT_STARTED)
    book = Book(id=uuid.uuid4(), title="Libro Direct", reading_percentage=0.0)
    db.add_all([course, book])
    db.commit()

    result = get_resources_direct()
    assert result["total"] == 2
    assert len(result["items"]) == 2
    titles = {r["title"] for r in result["items"]}
    assert "Curso Direct" in titles
    assert "Libro Direct" in titles


def test_get_resources_direct_by_type(db: Session):
    from frontend.app.services_direct import get_resources_direct

    course = Course(id=uuid.uuid4(), title="Curso Filtro", status=ResourceStatus.NOT_STARTED)
    book = Book(id=uuid.uuid4(), title="Libro Filtro", reading_percentage=0.0)
    db.add_all([course, book])
    db.commit()

    result = get_resources_direct(type="course")
    assert result["total"] == 1
    assert len(result["items"]) == 1
    assert result["items"][0]["title"] == "Curso Filtro"


def test_get_in_progress_direct(db: Session):
    from frontend.app.services_direct import get_in_progress_direct

    course = Course(id=uuid.uuid4(), title="En Progreso", status=ResourceStatus.IN_PROGRESS)
    book = Book(id=uuid.uuid4(), title="No Progreso", status=ResourceStatus.NOT_STARTED, reading_percentage=0.0)
    db.add_all([course, book])
    db.commit()

    result = get_in_progress_direct()
    assert len(result) == 1
    assert result[0]["title"] == "En Progreso"


def test_get_recent_direct(db: Session):
    from frontend.app.services_direct import get_recent_direct

    for i in range(3):
        c = Course(id=uuid.uuid4(), title=f"Curso {i}", status=ResourceStatus.NOT_STARTED)
        db.add(c)
    db.commit()

    result = get_recent_direct(limit=2)
    assert len(result) == 2


def test_get_resource_direct(db: Session):
    from frontend.app.services_direct import get_resource_direct

    course = Course(id=uuid.uuid4(), title="Curso Get", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    result = get_resource_direct(course.id)
    assert result["title"] == "Curso Get"
    assert result["type"] == "course"


def test_get_resource_direct_not_found(db: Session):
    from frontend.app.services_direct import get_resource_direct
    import pytest

    with pytest.raises(ValueError, match="not found"):
        get_resource_direct(uuid.uuid4())


def test_update_resource_direct(db: Session):
    from frontend.app.services_direct import update_resource_direct

    course = Course(id=uuid.uuid4(), title="Curso Update", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    payload = UpdateResourceRequest(title="Curso Actualizado", category="Nueva Cat")
    result = update_resource_direct(course.id, payload)
    assert result["title"] == "Curso Actualizado"
    assert result["category"] == "Nueva Cat"


def test_delete_resource_direct(db: Session):
    from frontend.app.services_direct import delete_resource_direct

    course = Course(id=uuid.uuid4(), title="Curso Delete", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    result = delete_resource_direct(course.id)
    assert result is True

    remaining = db.query(Course).all()
    assert len(remaining) == 0


def test_resource_to_dict_course(db: Session):
    from frontend.app.services_direct import _resource_to_dict

    course = Course(
        id=uuid.uuid4(),
        title="Dict Test",
        description="Desc",
        category="Cat",
        status=ResourceStatus.IN_PROGRESS,
    )
    db.add(course)
    db.commit()

    d = _resource_to_dict(course)
    assert d["type"] == "course"
    assert d["difficulty"] == "BEGINNER"
    assert "author" not in d
    assert "reading_percentage" not in d


def test_resource_to_dict_book(db: Session):
    from frontend.app.services_direct import _resource_to_dict

    book = Book(
        id=uuid.uuid4(),
        title="Dict Book",
        author="Autor Test",
        reading_percentage=42.5,
        status=ResourceStatus.IN_PROGRESS,
    )
    db.add(book)
    db.commit()

    d = _resource_to_dict(book)
    assert d["type"] == "book"
    assert d["author"] == "Autor Test"
    assert d["reading_percentage"] == 42.5
    assert "difficulty" not in d


def test_create_note_direct(db: Session):
    from frontend.app.services_direct import create_note_direct

    book = Book(id=uuid.uuid4(), title="Libro Nota")
    db.add(book)
    db.commit()

    book_id_str = str(book.id)
    result = create_note_direct(book.id, "Nota de prueba directa")
    assert result["content"] == "Nota de prueba directa"
    assert result["resource_id"] == book_id_str


def test_delete_note_direct(db: Session):
    from frontend.app.services_direct import delete_note_direct, create_note_direct

    book = Book(id=uuid.uuid4(), title="Libro Borrar")
    db.add(book)
    db.commit()

    note = create_note_direct(book.id, "Borrar esta nota")
    result = delete_note_direct(note["id"])
    assert result is True


def test_list_notes_direct(db: Session):
    from frontend.app.services_direct import list_notes_direct, create_note_direct

    book = Book(id=uuid.uuid4(), title="Libro Listar")
    db.add(book)
    db.commit()

    create_note_direct(book.id, "Nota 1")
    create_note_direct(book.id, "Nota 2")

    notes = list_notes_direct()
    assert len(notes) == 2


def test_dashboard_summary_direct(db: Session):
    from frontend.app.services_direct import get_dashboard_summary_direct

    course = Course(id=uuid.uuid4(), title="C", status=ResourceStatus.COMPLETED)
    book = Book(id=uuid.uuid4(), title="B", status=ResourceStatus.IN_PROGRESS, reading_percentage=50.0)
    db.add_all([course, book])
    db.commit()

    summary = get_dashboard_summary_direct()
    assert summary["total_resources"] == 2
    assert summary["courses_count"] == 1
    assert summary["books_count"] == 1
    assert summary["completed_resources"] == 1


def test_learning_paths_direct(db: Session):
    from frontend.app.services_direct import (
        get_learning_paths_direct, get_resource_paths_direct,
        create_learning_path_direct, update_resource_paths_direct
    )
    
    # 1. Crear ruta
    p1 = create_learning_path_direct("Ruta Test 1", "Una descripción")
    assert p1["title"] == "Ruta Test 1"
    assert p1["description"] == "Una descripción"
    
    # 2. Obtener rutas
    paths = get_learning_paths_direct()
    assert len(paths) >= 1
    assert any(p["title"] == "Ruta Test 1" for p in paths)
    
    # 3. Crear recurso y asociarlo
    course = Course(id=uuid.uuid4(), title="Curso Asoc", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()
    
    # Obtener asociaciones vacías
    assoc = get_resource_paths_direct(course.id)
    assert len(assoc) == 0
    
    # Actualizar asociaciones
    update_resource_paths_direct(course.id, [p1["id"]])
    
    # Verificar
    assoc = get_resource_paths_direct(course.id)
    assert len(assoc) == 1
    assert assoc[0] == p1["id"]
    
    # Quitar asociación
    update_resource_paths_direct(course.id, [])
    assoc = get_resource_paths_direct(course.id)
    assert len(assoc) == 0


def test_save_settings_and_placeholders_direct(db: Session, tmp_path, monkeypatch):
    from pathlib import Path
    from frontend.app.services_direct import save_settings_direct, generate_placeholders_direct
    from backend.app.core.settings import settings
    from backend.app.models.resource import Course, Book

    orig_llm_provider = settings.llm_provider
    orig_openai_api_key = settings.openai_api_key
    orig_openai_model = settings.openai_model

    try:
        # Mock Path.home to direct settings to tmp_path
        monkeypatch.setattr(Path, "home", lambda: tmp_path)

        # 1. Test save_settings_direct
        new_vals = {
            "llm_provider": "openai",
            "openai_api_key": "sk-testkey",
            "openai_model": "gpt-4-test",
        }
        save_settings_direct(new_vals)
        
        assert settings.llm_provider == "openai"
        assert settings.openai_api_key == "sk-testkey"
        assert settings.openai_model == "gpt-4-test"
        
        # Check that .env file exists and contains the values
        env_file = tmp_path / ".domestik" / ".env"
        assert env_file.exists()
        content = env_file.read_text()
        assert "LLM_PROVIDER=openai" in content
        assert "OPENAI_API_KEY=sk-testkey" in content
        assert "OPENAI_MODEL=gpt-4-test" in content

        # 2. Test generate_placeholders_direct
        # Clear existing resources in db to ensure a clean count
        db.query(Course).delete()
        db.query(Book).delete()
        db.commit()

        success = generate_placeholders_direct()
        assert success is True
        
        # Assert resources are generated
        courses = db.query(Course).all()
        books = db.query(Book).all()
        assert len(courses) >= 1
        assert len(books) >= 2
        assert any(c.title == "FastAPI & Python Backend Mastery" for c in courses)
        assert any(b.title == "El Arte del Aprendizaje Efectivo" for b in books)
    finally:
        settings.llm_provider = orig_llm_provider
        settings.openai_api_key = orig_openai_api_key
        settings.openai_model = orig_openai_model


def test_update_resource_paths_direct_idempotency(db: Session):
    from frontend.app.services_direct import (
        create_learning_path_direct, get_resource_paths_direct, update_resource_paths_direct
    )
    p1 = create_learning_path_direct("Ruta Idempotente")
    course = Course(id=uuid.uuid4(), title="Curso Idempotente", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    # Assign once
    update_resource_paths_direct(course.id, [p1["id"]])
    assert get_resource_paths_direct(course.id) == [p1["id"]]

    # Assign again (idempotent check)
    update_resource_paths_direct(course.id, [p1["id"]])
    assert get_resource_paths_direct(course.id) == [p1["id"]]


def test_update_resource_paths_direct_multi_assignment(db: Session):
    from frontend.app.services_direct import (
        create_learning_path_direct, get_resource_paths_direct, update_resource_paths_direct
    )
    p1 = create_learning_path_direct("Ruta 1")
    p2 = create_learning_path_direct("Ruta 2")
    course = Course(id=uuid.uuid4(), title="Curso Multi", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    # Assign to both
    update_resource_paths_direct(course.id, [p1["id"], p2["id"]])
    assigned = set(get_resource_paths_direct(course.id))
    assert assigned == {p1["id"], p2["id"]}


def test_update_resource_paths_direct_incremental_removal(db: Session):
    from frontend.app.services_direct import (
        create_learning_path_direct, get_resource_paths_direct, update_resource_paths_direct
    )
    p1 = create_learning_path_direct("Ruta A")
    p2 = create_learning_path_direct("Ruta B")
    course = Course(id=uuid.uuid4(), title="Curso Incremental", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    # Both assigned
    update_resource_paths_direct(course.id, [p1["id"], p2["id"]])
    
    # Remove one
    update_resource_paths_direct(course.id, [p2["id"]])
    assert get_resource_paths_direct(course.id) == [p2["id"]]

    # Clear all
    update_resource_paths_direct(course.id, [])
    assert len(get_resource_paths_direct(course.id)) == 0


def test_update_resource_paths_direct_sequence_ordering(db: Session):
    from frontend.app.services_direct import (
        create_learning_path_direct, update_resource_paths_direct
    )
    p1 = create_learning_path_direct("Ruta Orden")
    c1 = Course(id=uuid.uuid4(), title="Primero", status=ResourceStatus.NOT_STARTED)
    c2 = Course(id=uuid.uuid4(), title="Segundo", status=ResourceStatus.NOT_STARTED)
    db.add_all([c1, c2])
    db.commit()

    # Assign first resource
    update_resource_paths_direct(c1.id, [p1["id"]])
    # Assign second resource
    update_resource_paths_direct(c2.id, [p1["id"]])

    # Query DB items sequence order directly to verify c1 is 1, c2 is 2
    from backend.app.models.workflow import LearningPathItem
    items = db.query(LearningPathItem).filter(LearningPathItem.learning_path_id == uuid.UUID(p1["id"])).order_by(LearningPathItem.sequence_order).all()
    assert len(items) == 2
    assert str(items[0].resource_id) == str(c1.id)
    assert items[0].sequence_order == 1
    assert str(items[1].resource_id) == str(c2.id)
    assert items[1].sequence_order == 2


def test_get_about_statistics_direct(db: Session):
    from frontend.app.services_direct import get_about_statistics_direct
    from backend.app.models.resource import Course, Book
    from backend.app.models.course_structure import Module, Lesson
    from backend.app.models.activity import Note
    from backend.app.models.knowledge import Concept

    course_id = uuid.uuid4()
    c = Course(id=course_id, title="Test Course", status=ResourceStatus.NOT_STARTED)
    b = Book(id=uuid.uuid4(), title="Test Book", reading_percentage=0.0)
    m = Module(id=uuid.uuid4(), course_id=course_id, title="Test Module")
    db.add_all([c, b, m])
    db.commit()

    l = Lesson(id=uuid.uuid4(), module_id=m.id, title="Test Lesson")
    n = Note(id=uuid.uuid4(), resource_id=course_id, content="Notes...")
    cp = Concept(id=uuid.uuid4(), name="Test Concept", description="Description...")
    db.add_all([l, n, cp])
    db.commit()

    stats = get_about_statistics_direct()
    assert stats["courses"] == 1
    assert stats["books"] == 1
    assert stats["modules"] == 1
    assert stats["lessons"] == 1
    assert stats["notes"] == 1
    assert stats["concepts"] == 1


def test_update_resource_direct_cover_path_removal(db: Session):
    from frontend.app.services_direct import update_resource_direct

    course = Course(
        id=uuid.uuid4(),
        title="Curso Cover",
        cover_path="/static/covers/test.jpg",
        status=ResourceStatus.NOT_STARTED
    )
    db.add(course)
    db.commit()

    # Verify initial state
    assert course.cover_path == "/static/covers/test.jpg"

    # Set cover_path to None in the payload
    payload = UpdateResourceRequest(cover_path=None)
    result = update_resource_direct(course.id, payload)
    
    # Assert cover_path in the returned dictionary is None
    assert result["cover_path"] is None

    # Assert cover_path in database is None
    db.refresh(course)
    assert course.cover_path is None




