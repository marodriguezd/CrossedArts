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

# TEST DATABASE ISOLATION (A-1)
# This file must NEVER import or use the app's real engine.
#
# The old behavior ran schema creation against the app's real engine, creating
# the model tables directly in the user's database (~/.crossedarts/crossedarts.db)
# without recording any Alembic revision.
# Real consequence: the user database ended up with every table while Alembic
# believed no migration had applied, and the next `alembic upgrade head` failed
# with "table ... already exists".
#
# Rules in this file:
#   1. Each test gets its own in-memory SQLite engine (`db` fixture).
#   2. Background tasks doing `from backend.app.core.database import SessionLocal`
#      receive a session factory bound to the test engine (autouse fixture
#      `isolated_background_sessions`). The import resolves at call time, so
#      the patch sticks.
#   3. Boot migration validation is disabled in tests so no lifecycle code
#      inspects the real database by accident.
#   4. The user's real database is never wiped or recreated.


@pytest.fixture(name="db_engine")
def db_engine_fixture():
    """In-memory SQLite engine, isolated per test, with a shared pool."""
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
    """Session bound to the test engine (never the real database)."""
    SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    session = SessionTest()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture(autouse=True)
def isolated_background_sessions(monkeypatch, db_engine):
    """
    Redirect `SessionLocal` to the test engine.

    Endpoints and scanners open their own sessions for background work (a
    function-local `from backend.app.core.database import SessionLocal`). Without
    this patch those sessions would use the app's real engine and tests would
    write to the user's database.
    """
    import backend.app.core.database as database_module

    test_session_factory = sessionmaker(autocommit=False, autoflush=False, bind=db_engine)
    monkeypatch.setattr(database_module, "SessionLocal", test_session_factory)
    yield test_session_factory


@pytest.fixture(autouse=True)
def skip_startup_migration_validation(monkeypatch):
    """
    Keep any app boot during tests away from the real database. Alembic
    validation has its own dedicated coverage on temp engines
    (tests/test_migration_validation.py).
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
