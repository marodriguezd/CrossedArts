import pytest
import sys
import os
import uuid
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from sqlalchemy.pool import StaticPool

# Resolve workspace root dynamically instead of hardcoded path
workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, workspace_root)

from backend.app.core.database import Base
from backend.app.models import *

# =============================================================================
# AISLAMIENTO DE BASE DE DATOS EN PRUEBAS (A-1)
# =============================================================================
# Este archivo NO debe importar ni usar el engine real de la aplicación.
#
# El comportamiento anterior ejecutaba una creación de esquema sobre el engine
# real de la aplicación, creando las tablas del modelo directamente en la base
# de datos del usuario (~/.crossedarts/crossedarts.db) sin registrar ninguna
# revisión de Alembic.
# Consecuencia real: la base del usuario quedaba con todas las tablas mientras
# Alembic creía que no se había aplicado ninguna migración, y el siguiente
# `alembic upgrade head` fallaba con "table ... already exists".
#
# Reglas de este archivo:
#   1. Cada prueba usa su propio engine SQLite en memoria (fixture `db`).
#   2. Las tareas en segundo plano que hacen `from backend.app.core.database
#      import SessionLocal` reciben una fábrica de sesiones ligada al engine de
#      la prueba (fixture autouse `isolated_background_sessions`). El import se
#      resuelve en tiempo de llamada, así que el parche es efectivo.
#   3. La validación de migraciones de arranque se desactiva en pruebas para que
#      ningún código de ciclo de vida inspeccione la base real por accidente.
#   4. Nunca se borra ni se recrea la base real del usuario.
# =============================================================================


@pytest.fixture(name="db_engine")
def db_engine_fixture():
    """Engine SQLite en memoria, aislado por prueba, con pool compartido."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture(name="db")
def db_fixture(db_engine) -> Session:
    """Sesión ligada al engine de la prueba (nunca a la base real)."""
    SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    session = SessionTest()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def isolated_background_sessions(monkeypatch, db_engine):
    """
    Redirige `SessionLocal` al engine de la prueba.

    Los endpoints y scanners abren sesiones propias para trabajo en segundo
    plano (`from backend.app.core.database import SessionLocal` dentro de la
    función). Sin este parche esas sesiones usarían el engine real de la
    aplicación y las pruebas escribirían en la base del usuario.
    """
    import backend.app.core.database as database_module

    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    monkeypatch.setattr(database_module, "SessionLocal", test_session_factory)
    yield test_session_factory


@pytest.fixture(autouse=True)
def skip_startup_migration_validation(monkeypatch):
    """
    Evita que cualquier arranque de la app durante las pruebas inspeccione la
    base de datos real. La validación de Alembic tiene su propia cobertura
    dedicada con engines temporales (tests/test_migration_validation.py).
    """
    monkeypatch.setenv("SKIP_MIGRATION_VALIDATION", "1")
    yield


@pytest.fixture(name="sample_course")
def sample_course_fixture(db: Session):
    """Create a pre-seeded Course for tests that just need a resource."""
    from backend.app.models.resource import Course
    from backend.app.models.base import ResourceStatus
    course = Course(
        id=uuid.uuid4(),
        title="Curso de Ejemplo",
        description="Un curso de prueba",
        category="General",
        status=ResourceStatus.NOT_STARTED,
    )
    db.add(course)
    db.commit()
    return course


@pytest.fixture(name="sample_book")
def sample_book_fixture(db: Session):
    """Create a pre-seeded Book for tests that just need a resource."""
    from backend.app.models.resource import Book
    from backend.app.models.base import ResourceStatus
    book = Book(
        id=uuid.uuid4(),
        title="Libro de Ejemplo",
        description="Un libro de prueba",
        category="General",
        status=ResourceStatus.NOT_STARTED,
        reading_percentage=0.0,
    )
    db.add(book)
    db.commit()
    return book


@pytest.fixture(name="client")
def client_fixture(db: Session):
    """
    Shared TestClient fixture that overrides FastAPI's get_db dependency
    with the in-memory test session.
    """
    from fastapi.testclient import TestClient
    from backend.app.main import app
    from backend.app.core.database import get_db

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.fixture(name="tmp_data_dir")
def tmp_data_dir_fixture(tmp_path: Path):
    """Provide a temporary data directory and patch settings to use it."""
    data_dir = tmp_path / "crossedarts_data"
    data_dir.mkdir()
    return data_dir
