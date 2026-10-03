import uuid
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.models.resource import Course, Book
from backend.app.models.course_structure import Module, Lesson
from backend.app.models.base import ResourceStatus


def test_api_list_and_get_resources(client: TestClient, db: Session):
    # Sembrar un recurso
    course = Course(
        id=uuid.uuid4(),
        title="Curso API Test",
        status=ResourceStatus.NOT_STARTED
    )
    db.add(course)
    db.commit()

    # Listar recursos
    response = client.get("/api/v1/resources")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["title"] == "Curso API Test"

    # Obtener por ID
    resource_id = data[0]["id"]
    response = client.get(f"/api/v1/resources/{resource_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Curso API Test"


def test_api_toggle_lesson_completion(client: TestClient, db: Session):
    # Sembrar curso -> módulo -> lección
    course = Course(id=uuid.uuid4(), title="Curso Progreso API", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    module = Module(id=uuid.uuid4(), course_id=course.id, title="Modulo Test")
    db.add(module)
    lesson = Lesson(id=uuid.uuid4(), module_id=module.id, title="Lección Test", is_completed=False)
    db.add(lesson)
    db.commit()

    # Toggle complete = True
    response = client.post(
        f"/api/v1/lessons/{lesson.id}/toggle-complete",
        json={"is_completed": True}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["is_completed"] is True
    assert data["course_progress_percentage"] == 100.0


def test_api_update_book_progress(client: TestClient, db: Session):
    # Sembrar libro
    book = Book(id=uuid.uuid4(), title="Libro API Test", reading_percentage=0.0)
    db.add(book)
    db.commit()

    # Cambiar porcentaje
    response = client.patch(
        f"/api/v1/books/{book.id}/progress",
        json={"reading_percentage": 45.5}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["reading_percentage"] == 45.5
    assert data["status"] == "IN_PROGRESS"


def test_api_notes_crud(client: TestClient, db: Session):
    # Sembrar recurso
    book = Book(id=uuid.uuid4(), title="Libro para Notas")
    db.add(book)
    db.commit()

    # 1. Crear Nota
    response = client.post(
        "/api/v1/notes",
        json={"resource_id": str(book.id), "content": "Nota test API"}
    )
    assert response.status_code == 201
    note_id = response.json()["id"]

    # 2. Listar Notas
    response = client.get(f"/api/v1/resources/{book.id}/notes")
    assert response.status_code == 200
    assert len(response.json()) == 1

    # 3. Actualizar Nota
    response = client.patch(
        f"/api/v1/notes/{note_id}",
        json={"content": "Nota modificada API"}
    )
    assert response.status_code == 200
    assert response.json()["content"] == "Nota modificada API"

    # 4. Eliminar Nota
    response = client.delete(f"/api/v1/notes/{note_id}")
    assert response.status_code == 204


def test_api_sessions_lifecycle(client: TestClient, db: Session):
    book = Book(id=uuid.uuid4(), title="Recurso para Sesion")
    db.add(book)
    db.commit()

    # 1. Iniciar sesión
    response = client.post("/api/v1/sessions/start", json={"resource_id": str(book.id)})
    assert response.status_code == 201
    session_id = response.json()["id"]

    # 2. Heartbeat
    response = client.post(f"/api/v1/sessions/{session_id}/heartbeat")
    assert response.status_code == 200

    # 3. Finalizar sesión
    response = client.post(f"/api/v1/sessions/{session_id}/end")
    assert response.status_code == 200
    assert response.json()["ended_at"] is not None


def test_api_dashboard_summary(client: TestClient, db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Dash", status=ResourceStatus.IN_PROGRESS)
    book = Book(id=uuid.uuid4(), title="Libro Dash", status=ResourceStatus.COMPLETED, reading_percentage=100.0)
    db.add_all([course, book])
    db.commit()

    response = client.get("/api/v1/dashboard/summary")
    assert response.status_code == 200
    data = response.json()
    assert data["total_resources"] == 2
    assert data["courses_count"] == 1
    assert data["books_count"] == 1
    assert data["completed_resources"] == 1


def test_api_polymorphic_course_fields(client: TestClient, db: Session):
    """Courses must include 'difficulty' in API responses (not stripped by parent schema)."""
    course = Course(
        id=uuid.uuid4(),
        title="Curso Polimorfismo",
        status=ResourceStatus.NOT_STARTED,
    )
    db.add(course)
    db.commit()

    response = client.get("/api/v1/resources")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["type"] == "course"
    assert "difficulty" in data[0]
    assert data[0]["difficulty"] is not None


def test_api_polymorphic_book_fields(client: TestClient, db: Session):
    """Books must include 'author' and 'reading_percentage' in API responses."""
    book = Book(
        id=uuid.uuid4(),
        title="Libro Polimorfismo",
        author="Autor Test",
        reading_percentage=72.5,
    )
    db.add(book)
    db.commit()

    response = client.get("/api/v1/resources")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["type"] == "book"
    assert data[0]["author"] == "Autor Test"
    assert data[0]["reading_percentage"] == 72.5


def test_api_polymorphic_mixed_list(client: TestClient, db: Session):
    """Mixed resource lists must preserve type-specific fields for each item."""
    course = Course(id=uuid.uuid4(), title="Curso Mixto", status=ResourceStatus.NOT_STARTED)
    book = Book(id=uuid.uuid4(), title="Libro Mixto", author="Autor Mixto", reading_percentage=30.0)
    db.add_all([course, book])
    db.commit()

    response = client.get("/api/v1/resources")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2

    by_title = {r["title"]: r for r in data}
    assert by_title["Curso Mixto"]["type"] == "course"
    assert "difficulty" in by_title["Curso Mixto"]
    assert by_title["Libro Mixto"]["type"] == "book"
    assert by_title["Libro Mixto"]["author"] == "Autor Mixto"
    assert by_title["Libro Mixto"]["reading_percentage"] == 30.0


def test_api_polymorphic_get_by_id(client: TestClient, db: Session):
    """GET /resources/{id} must return type-specific fields."""
    book = Book(
        id=uuid.uuid4(),
        title="Libro ID Test",
        author="Autor ID",
        reading_percentage=55.0,
    )
    db.add(book)
    db.commit()

    response = client.get(f"/api/v1/resources/{book.id}")
    assert response.status_code == 200
    data = response.json()
    assert data["type"] == "book"
    assert data["author"] == "Autor ID"
    assert data["reading_percentage"] == 55.0


def test_api_polymorphic_patch_preserves_fields(client: TestClient, db: Session):
    """PATCH must not lose type-specific fields in the response."""
    course = Course(id=uuid.uuid4(), title="Curso Patch", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    response = client.patch(
        f"/api/v1/resources/{course.id}",
        json={"title": "Curso Patched"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Curso Patched"
    assert data["type"] == "course"
    assert "difficulty" in data


def test_api_cover_path_removal(client: TestClient, db: Session):
    course = Course(
        id=uuid.uuid4(),
        title="Curso Cover API",
        cover_path="/static/covers/api_test.jpg",
        status=ResourceStatus.NOT_STARTED
    )
    db.add(course)
    db.commit()

    # Verify initial state
    assert course.cover_path == "/static/covers/api_test.jpg"

    # Send a PATCH request to clear the cover
    response = client.patch(
        f"/api/v1/resources/{course.id}",
        json={"cover_path": None},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["cover_path"] is None

    # Assert cover_path in database is None
    db.refresh(course)
    assert course.cover_path is None
