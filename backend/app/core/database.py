import uuid
from typing import Generator
from sqlalchemy import create_engine, event, types
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from sqlalchemy.engine import Engine
from backend.app.core.settings import settings

# Ensure the database directory exists before creating the engine
settings.data_dir.mkdir(parents=True, exist_ok=True)

# Creación del motor (Engine)
# En SQLite, connect_args={"check_same_thread": False} es obligatorio para el manejo asíncrono y de hilos en FastAPI
connect_args = {}
if settings.database_url.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(settings.database_url, connect_args=connect_args, echo=False)

# Crear fábrica de sesiones
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Base declarativa para los modelos
Base = declarative_base()

# Habilitar soporte de claves foráneas y modo WAL en SQLite de forma explícita
@event.listens_for(Engine, "connect")
def set_sqlite_pragma(dbapi_connection, connection_record):
    if settings.database_url.startswith("sqlite"):
        import unicodedata

        def remove_accents(s):
            if s is None:
                return ""
            return "".join(c for c in unicodedata.normalize('NFD', str(s)) if unicodedata.category(c) != 'Mn')

        dbapi_connection.create_function("remove_accents", 1, remove_accents)

        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-10000")
        cursor.execute("PRAGMA temp_store=MEMORY")
        cursor.close()

# Generador de sesión para dependencias de FastAPI (Session DI)
def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# TypeDecorator compatible para UUID entre SQLite y PostgreSQL
class GUID(types.TypeDecorator):
    """
    UUID compatible de forma transparente.
    En PostgreSQL mapea a la columna UUID nativa.
    En SQLite mapea a CHAR(36) y gestiona los objetos UUID de Python.
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
