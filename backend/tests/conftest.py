import pytest
import sys
import os
import uuid
from pathlib import Path
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session

# Resolve workspace root dynamically instead of hardcoded path
workspace_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, workspace_root)

from backend.app.core.database import Base
from backend.app.models import *

# Ensure real database has all tables (needed for background tasks during tests)
from backend.app.core.database import engine as real_engine
from backend.app.core.settings import settings
if settings.database_url.startswith("sqlite"):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=real_engine)


@pytest.fixture(name="db")
def db_fixture() -> Session:
    """
    Creates an in-memory SQLite database before each test and drops all tables afterward.
    """
    from sqlalchemy.pool import StaticPool
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool
    )

    Base.metadata.create_all(bind=engine)

    SessionTest = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionTest()

    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


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
    data_dir = tmp_path / "domestik_data"
    data_dir.mkdir()
    return data_dir
