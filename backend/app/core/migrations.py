"""
Validación del estado de migraciones Alembic al arrancar la aplicación.

Objetivo (hallazgo A-2): detectar de forma temprana una base de datos cuyo
esquema no corresponde al historial de migraciones, con un mensaje accionable,
en lugar de permitir que la aplicación arranque y falle más tarde en un
ALTER TABLE o una consulta.

Decisiones de diseño:
- La revisión esperada se lee del PROPIO historial de Alembic
  (`ScriptDirectory.get_heads()`), nunca de una versión codificada a mano.
- La validación es de solo lectura: no modifica la base de datos, no ejecuta
  migraciones y no elimina datos.
- Los modos explícitos de desarrollo con creación automática de tablas
  (`AUTO_CREATE_TABLES=1`) no pasan por esta validación.
- `SKIP_MIGRATION_VALIDATION=1` permite desactivarla (pruebas/desarrollo).
"""
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# Ruta canónica del alembic.ini del proyecto (backend/alembic.ini).
ALEMBIC_INI_PATH = Path(__file__).resolve().parent.parent.parent / "alembic.ini"

# Tablas que solo existen si el esquema de la aplicación se ha creado de alguna
# forma (migración o create_all). Sirven para distinguir una base "fresca" de
# una base con esquema pero sin registro de migraciones.
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
    """Resultado de la validación del estado de migraciones."""

    # 'ok' | 'fresh' | 'missing-version' | 'behind-head' | 'divergent' | 'multiple-heads'
    status: str
    current_revision: Optional[str]
    head_revision: Optional[str]
    message: str

    @property
    def is_valid(self) -> bool:
        return self.status == "ok"


def get_script_directory(ini_path: Optional[Path] = None):
    """Devuelve el ScriptDirectory de Alembic leyendo el historial real."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(ini_path or ALEMBIC_INI_PATH))
    return ScriptDirectory.from_config(config)


def read_database_revision(engine: Engine) -> Optional[str]:
    """Lee la revisión aplicada en `alembic_version`, si existe."""
    inspector = inspect(engine)
    if "alembic_version" not in inspector.get_table_names():
        return None
    with engine.connect() as connection:
        row = connection.execute(text("SELECT version_num FROM alembic_version")).first()
        return str(row[0]) if row and row[0] else None


def has_application_tables(engine: Engine) -> bool:
    """¿Contiene la base alguna tabla del esquema de la aplicación?"""
    inspector = inspect(engine)
    return bool(set(inspector.get_table_names()) & _APPLICATION_TABLES)


def validate_migration_state(engine: Engine, ini_path: Optional[Path] = None) -> MigrationStateReport:
    """
    Compara la revisión aplicada en la base con la cabeza real del historial.

    No modifica nada. Devuelve un informe con un mensaje accionable en español
    cuando el estado no es válido.
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

    # ¿La revisión aplicada forma parte del historial actual?
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
    """¿Se ha desactivado explícitamente la validación por entorno?"""
    import os

    return os.getenv("SKIP_MIGRATION_VALIDATION", "0").lower() in ("1", "true", "yes")


def is_auto_create_enabled() -> bool:
    """¿Está habilitada la creación automática de tablas (modo desarrollo)?"""
    import os

    return os.getenv("AUTO_CREATE_TABLES", "0").lower() in ("1", "true", "yes")
