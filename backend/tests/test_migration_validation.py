"""
A-2 — Regresión: validación del estado de migraciones Alembic al arrancar.

Cubre:
  - Base fresca (sin esquema): estado accionable "ejecuta alembic upgrade head".
  - Base con esquema pero sin alembic_version: el estado dañado que producía el
    antiguo fixture de pruebas; debe detectarse y explicarse.
  - Base migrada con Alembic (upgrade head real sobre un archivo temporal): ok.
  - Base detrás de la cabeza: behind-head.
  - Revisión desconocida: divergent.
  - El arranque (lifespan) falla de forma temprana y accionable.
  - AUTO_CREATE_TABLES y SKIP_MIGRATION_VALIDATION siguen funcionando.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

import backend.app.models  # noqa: F401 — registra los modelos en Base.metadata

from backend.app.core.migrations import (
    ALEMBIC_INI_PATH,
    MigrationStateReport,
    has_application_tables,
    read_database_revision,
    validate_migration_state,
)


def _make_schema_without_version(target_engine):
    """Crea el esquema de la aplicación directamente (sin alembic_version)."""
    from backend.app.core.database import Base

    Base.metadata.create_all(bind=target_engine)


def test_fresh_database_reported_with_actionable_message():
    engine = create_engine("sqlite:///:memory:")
    report = validate_migration_state(engine)
    assert report.status == "fresh"
    assert not report.is_valid
    assert "alembic" in report.message.lower()
    assert "upgrade head" in report.message
    engine.dispose()


def test_schema_without_alembic_version_is_detected():
    """El daño real reproducido por el antiguo fixture: esquema sin revisión."""
    engine = create_engine("sqlite:///:memory:")
    _make_schema_without_version(engine)
    assert has_application_tables(engine)
    assert read_database_revision(engine) is None

    report = validate_migration_state(engine)
    assert report.status == "missing-version"
    assert not report.is_valid
    assert "alembic_version" in report.message
    assert "stamp" in report.message, "Debe sugerir la reparación segura (stamp), no upgrade a ciegas"
    assert "already exists" in report.message
    engine.dispose()


def test_migrated_database_reports_ok(tmp_path, monkeypatch):
    """
    `alembic upgrade head` sobre un archivo temporal produce estado válido.

    Esta prueba usa la MISMA ruta de migración que producción (env.py lee
    settings.database_url, que se parchea al archivo temporal).
    """
    import alembic.command
    from alembic.config import Config

    test_db = tmp_path / "migrated.db"
    monkeypatch.setattr(
        "backend.app.core.settings.settings.database_url", f"sqlite:///{test_db}"
    )

    config = Config(str(ALEMBIC_INI_PATH))
    alembic.command.upgrade(config, "head")

    engine = create_engine(f"sqlite:///{test_db}")
    report = validate_migration_state(engine)
    assert report.status == "ok"
    assert report.is_valid
    assert report.current_revision == report.head_revision
    engine.dispose()


def test_database_behind_head_is_detected(tmp_path, monkeypatch):
    import alembic.command
    from alembic.config import Config

    test_db = tmp_path / "behind.db"
    monkeypatch.setattr(
        "backend.app.core.settings.settings.database_url", f"sqlite:///{test_db}"
    )

    config = Config(str(ALEMBIC_INI_PATH))
    alembic.command.upgrade(config, "head")

    # Rebobinar la revisión registrada a la primera del historial real.
    from backend.app.core.migrations import get_script_directory

    script = get_script_directory()
    revisions = [rev.revision for rev in script.walk_revisions()]
    first_revision = revisions[-1]  # walk_revisions recorre de cabeza a base

    engine = create_engine(f"sqlite:///{test_db}")
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE alembic_version SET version_num = :rev"),
            {"rev": first_revision},
        )

    report = validate_migration_state(engine)
    assert report.status == "behind-head"
    assert not report.is_valid
    assert "upgrade head" in report.message
    engine.dispose()


def test_unknown_revision_is_divergent(tmp_path):
    engine = create_engine("sqlite:///:memory:")
    _make_schema_without_version(engine)
    with engine.begin() as conn:
        conn.execute(
            text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)")
        )
        conn.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:rev)"),
            {"rev": "deadbeefdead"},
        )

    report = validate_migration_state(engine)
    assert report.status == "divergent"
    assert not report.is_valid
    assert "no pertenece al historial" in report.message
    engine.dispose()


def test_lifespan_blocks_startup_on_invalid_migration_state(tmp_path, monkeypatch):
    """El arranque debe fallar temprano con un mensaje accionable."""
    from backend.app.core.database import Base
    import backend.app.main as main_module

    broken_db = tmp_path / "broken.db"
    broken_engine = create_engine(f"sqlite:///{broken_db}")
    Base.metadata.create_all(bind=broken_engine)  # esquema sin alembic_version

    monkeypatch.setattr(main_module, "engine", broken_engine)
    # La fixture autouse del conftest desactiva la validación: aquí se reactiva
    # expresamente para probar el comportamiento de producción.
    monkeypatch.delenv("SKIP_MIGRATION_VALIDATION", raising=False)
    monkeypatch.delenv("AUTO_CREATE_TABLES", raising=False)

    with pytest.raises(RuntimeError) as excinfo:
        with TestClient(main_module.app):
            pass

    message = str(excinfo.value)
    assert "migraciones" in message
    assert "missing-version" in message
    assert "stamp" in message
    broken_engine.dispose()


def test_lifespan_starts_normally_when_validation_skipped(tmp_path, monkeypatch):
    """SKIP_MIGRATION_VALIDATION=1 conserva el modo desarrollo/pruebas."""
    import backend.app.main as main_module

    broken_engine = create_engine("sqlite:///:memory:")
    monkeypatch.setattr(main_module, "engine", broken_engine)
    monkeypatch.setenv("SKIP_MIGRATION_VALIDATION", "1")
    monkeypatch.delenv("AUTO_CREATE_TABLES", raising=False)

    with TestClient(main_module.app) as client:
        assert client.get("/api/health").status_code == 200
    broken_engine.dispose()


def test_auto_create_mode_does_not_run_validation(tmp_path, monkeypatch):
    """AUTO_CREATE_TABLES=1 (desarrollo explícito) no pasa por la validación."""
    from backend.app.core.database import Base
    import backend.app.main as main_module

    # Archivo temporal (no :memory:): TestClient arranca el lifespan en otro
    # hilo y una base en memoria sería distinta por hilo.
    dev_engine = create_engine(f"sqlite:///{tmp_path / 'auto_create.db'}")
    monkeypatch.setattr(main_module, "engine", dev_engine)
    monkeypatch.delenv("SKIP_MIGRATION_VALIDATION", raising=False)
    monkeypatch.setenv("AUTO_CREATE_TABLES", "1")

    # Sin esquema ni revisión: la validación habría bloqueado el arranque.
    with TestClient(main_module.app) as client:
        assert client.get("/api/health").status_code == 200
    assert "learning_resource" in inspect(dev_engine).get_table_names()
    dev_engine.dispose()


def test_report_is_immutable():
    report = MigrationStateReport(
        status="ok", current_revision="a", head_revision="a", message="ok"
    )
    with pytest.raises(Exception):
        report.status = "behind-head"  # type: ignore[misc]
