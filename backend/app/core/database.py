import sqlite3
import unicodedata
import uuid
from typing import Generator, Optional
from sqlalchemy import create_engine, event, types
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.engine import Engine
from backend.app.core.settings import settings


def remove_accents(s: Optional[str]) -> str:
    """Normalize string and remove accent marks for accent-insensitive SQL LIKE search."""
    if s is None:
        return ""
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")


def is_sqlite_connection(dbapi_connection: object) -> bool:
    """
    Check if a DBAPI connection is an active SQLite connection.
    Verifies connection type or module before applying SQLite-specific PRAGMAs.
    """
    if isinstance(dbapi_connection, sqlite3.Connection):
        return True
    module_name = getattr(dbapi_connection.__class__, "__module__", "")
    return "sqlite" in module_name.lower() or hasattr(dbapi_connection, "create_function")

# Ensure the database directory exists before creating the engine
settings.data_dir.mkdir(parents=True, exist_ok=True)

# SQLite needs check_same_thread=False for FastAPI's async/threaded handling.
connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(settings.database_url, connect_args=connect_args, echo=False)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

# Explicitly enable foreign-key support, WAL mode, and custom search functions on SQLite.
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if not is_sqlite_connection(dbapi_connection):
        return

    # Driver check: register custom SQLite SQL function if supported
    if hasattr(dbapi_connection, "create_function"):
        try:
            dbapi_connection.create_function("remove_accents", 1, remove_accents)
        except Exception:
            pass

    if hasattr(dbapi_connection, "cursor"):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-10000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()

# Session generator for FastAPI dependencies (Session DI).
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# TypeDecorator bridging UUID between SQLite and PostgreSQL.
class GUID(types.TypeDecorator):
    """
    Transparent UUID compatibility.
    Maps to the native UUID column on PostgreSQL.
    Maps to CHAR(36) on SQLite and handles Python UUID objects.
    """
    impl = types.CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            from sqlalchemy.dialects.postgresql import UUID as PG_UUID
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(types.CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return value
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            return value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if not isinstance(value, uuid.UUID):
            try:
                return uuid.UUID(value)
            except ValueError:
                return value
        return value
