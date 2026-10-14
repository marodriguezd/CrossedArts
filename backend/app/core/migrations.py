"""
Alembic migration-state validation at application startup.

Goal: fail early on a database whose schema does not match the migration
 history, with an actionable message, instead of letting the app boot and fail
later on an ALTER TABLE or a query.

Design decisions:
- The expected revision is read from Alembic's OWN history
  (`ScriptDirectory.get_heads()`), never from a hand-coded version.
- Validation is read-only: it never modifies the database, runs migrations,
  or deletes data.
- Explicit dev modes with automatic table creation (`AUTO_CREATE_TABLES=1`)
  skip this validation.
- `SKIP_MIGRATION_VALIDATION=1` disables it (tests/development).
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# Canonical project alembic.ini path (backend/alembic.ini).
ALEMBIC_INI_PATH = Path(__file__).resolve().parent.parent.parent / "alembic.ini"

# Tables that only exist once the app schema was created somehow (migration or
# create_all). They tell a "fresh" database apart from one with a schema but
# no migration record.
_APPLICATION_TABLES = {
    "learning_resource",
    "course",
    "book",
    "module",
    "lesson",
    "learning_session",
    "note",
    "flashcard",
    "concept",
    "knowledge_connection",
    "media_asset",
    "transcript",
    "embedding_record",
}

_UPGRADE_COMMAND = "PYTHONPATH=. alembic -c backend/alembic.ini upgrade head"


@dataclass(frozen=True)
class MigrationStateReport:
    """Migration-state validation result."""

    # 'ok' | 'fresh' | 'missing-version' | 'behind-head' | 'divergent' | 'multiple-heads'
    status: str
    current_revision: Optional[str]
    head_revision: Optional[str]
    message: str

    @property
    def is_valid(self) -> bool:
        return self.status == "ok"


def get_script_directory(ini_path: Optional[Path] = None):
    """Return Alembic's ScriptDirectory by reading the real history."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(ini_path or ALEMBIC_INI_PATH))
    return ScriptDirectory.from_config(config)


def read_database_revision(engine: Engine) -> Optional[str]:
    """Read the applied revision from `alembic_version`, if present."""
    inspector = inspect(engine)
    if "alembic_version" not in inspector.get_table_names():
        return None
    with engine.connect() as connection:
        row = connection.execute(text("SELECT version_num FROM alembic_version")).first()
        return str(row[0]) if row and row[0] else None


def has_application_tables(engine: Engine) -> bool:
    """Does the database contain any app-schema table?"""
    inspector = inspect(engine)
    return bool(set(inspector.get_table_names()) & _APPLICATION_TABLES)


def validate_migration_state(engine: Engine, ini_path: Optional[Path] = None) -> MigrationStateReport:
    """
    Compare the applied database revision against the real history head.

    Changes nothing. Returns a report with an actionable Spanish-language
    message when the state is invalid.
    """
    script = get_script_directory(ini_path)
    heads = script.get_heads()

    if len(heads) > 1:
        return MigrationStateReport(
            status="multiple-heads",
            current_revision=read_database_revision(engine),
            head_revision=None,
            message=(
                "El historial de migraciones de Alembic tiene varias cabezas "
                f"({', '.join(heads)}). Repara el historial antes de iniciar el servidor."
            ),
        )

    head = heads[0] if heads else None
    current = read_database_revision(engine)

    if current is None:
        if not has_application_tables(engine):
            return MigrationStateReport(
                status="fresh",
                current_revision=None,
                head_revision=head,
                message=(
                    "La base de datos todavía no tiene el esquema de CrossedArts aplicado. "
                    f"Ejecuta las migraciones antes de iniciar el servidor: {_UPGRADE_COMMAND}"
                ),
            )
        return MigrationStateReport(
            status="missing-version",
            current_revision=None,
            head_revision=head,
            message=(
                "La base de datos contiene tablas de CrossedArts pero no tiene registro de "
                "migraciones Alembic (falta la tabla alembic_version). Este estado es el que "
                "producía el antiguo fixture de pruebas al crear el esquema directamente. "
                "No se ha modificado ningún dato. Para repararlo, verifica que el esquema "
                "coincide con el esperado y registra la revisión con "
                f"`PYTHONPATH=. alembic -c backend/alembic.ini stamp {head or 'head'}`; "
                "no ejecutes `upgrade head` a ciegas porque fallaría con 'table already exists'. "
                "Si dudas del estado real, restaura una copia de seguridad antes de continuar."
            ),
        )

    if head is None:
        return MigrationStateReport(
            status="divergent",
            current_revision=current,
            head_revision=None,
            message=(
                "El historial de migraciones está vacío pero la base de datos tiene una "
                "revisión aplicada. Restaura el historial o una copia de seguridad."
            ),
        )

    if current == head:
        return MigrationStateReport(
            status="ok",
            current_revision=current,
            head_revision=head,
            message=f"Base de datos en la última revisión de Alembic ({head}).",
        )

    # Is the applied revision part of the current history?
    try:
        known_revisions = {rev.revision for rev in script.iterate_revisions(head, "base")}
    except Exception:
        known_revisions = set()

    if current in known_revisions:
        return MigrationStateReport(
            status="behind-head",
            current_revision=current,
            head_revision=head,
            message=(
                f"La base de datos está en la revisión {current} pero el código espera {head}. "
                f"Aplica las migraciones pendientes: {_UPGRADE_COMMAND}"
            ),
        )

    return MigrationStateReport(
        status="divergent",
        current_revision=current,
        head_revision=head,
        message=(
            f"La revisión aplicada ({current}) no pertenece al historial de migraciones "
            f"actual (cabeza: {head}). Puede que la base provenga de otra versión del "
            "proyecto. Restaura una copia de seguridad o repara el historial antes de "
            "continuar; no se ha modificado ningún dato."
        ),
    )


def is_migration_validation_skipped() -> bool:
    """Was validation explicitly disabled via environment?"""
    import os

    return os.getenv("SKIP_MIGRATION_VALIDATION", "0").lower() in ("1", "true", "yes")


def is_auto_create_enabled() -> bool:
    """Is automatic table creation enabled (dev mode)?"""
    import os

    return os.getenv("AUTO_CREATE_TABLES", "0").lower() in ("1", "true", "yes")
