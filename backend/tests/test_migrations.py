import os


def test_alembic_inactive_seconds_has_default():
    """Verify the migration fix: inactive_seconds column has server_default='0'."""
    versions_dir = os.path.join(
        os.path.dirname(__file__), "..", "alembic", "versions"
    )
    migration_file = None
    for fname in os.listdir(versions_dir):
        if fname.startswith("9bd4577cf6f2"):
            migration_file = os.path.join(versions_dir, fname)
            break

    assert migration_file is not None, "Migration file 9bd4577cf6f2 not found"

    with open(migration_file) as f:
        content = f.read()

    assert "server_default='0'" in content or 'server_default="0"' in content, (
        "Migration 9bd4577cf6f2 must have server_default='0' for inactive_seconds"
    )


def test_all_migrations_exist():
    """Verify all expected migration files are present."""
    versions_dir = os.path.join(
        os.path.dirname(__file__), "..", "alembic", "versions"
    )
    files = [f for f in os.listdir(versions_dir) if f.endswith(".py") and not f.startswith("__")]

    # At least the initial migration and the inactive_seconds migration
    assert len(files) >= 2
    names = " ".join(files)
    assert "initial" in names.lower() or "dc7034d6ba93" in names
    assert "9bd4577cf6f2" in names


def test_alembic_ini_exists():
    """Verify alembic.ini is present and configured."""
    assert os.path.exists("backend/alembic.ini")

    with open("backend/alembic.ini") as f:
        content = f.read()

    assert "script_location" in content
    assert "sqlalchemy.url" in content


def test_alembic_upgrade_head_clean_database(tmp_path):
    """Verify alembic upgrade head runs cleanly from scratch without duplicate index errors."""
    import subprocess
    import sys
    test_db = tmp_path / "test_fresh_migration.db"
    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{test_db}"
    res = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
        cwd=os.getcwd()
    )
    assert res.returncode == 0, f"Alembic upgrade head failed: {res.stderr}"
    assert test_db.exists()


def test_fresh_create_all_and_migrated_schema_agree_on_indexes(tmp_path):
    """`create_all()` and `alembic upgrade head` must build the SAME indexes.

    A fresh install that lacks the indexes the migration chain creates queries
    without them (`f3a9c2d41b57` claims the two paths converge). This compares
    both schemas index by index instead of trusting the docstring.
    """
    import subprocess
    import sys

    from sqlalchemy import create_engine, inspect

    import backend.app.models  # noqa: F401 - registers every table on the metadata
    from backend.app.core.database import Base

    created_path = tmp_path / "created.db"
    migrated_path = tmp_path / "migrated.db"

    created_engine = create_engine(f"sqlite:///{created_path}")
    Base.metadata.create_all(bind=created_engine)
    created_engine.dispose()

    env = os.environ.copy()
    env["DATABASE_URL"] = f"sqlite:///{migrated_path}"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"],
        env=env,
        capture_output=True,
        text=True,
        cwd=os.getcwd(),
    )
    assert result.returncode == 0, f"Alembic upgrade head failed: {result.stderr}"

    def indexes_per_table(path):
        engine = create_engine(f"sqlite:///{path}")
        inspector = inspect(engine)
        schema = {
            table: {index["name"] for index in inspector.get_indexes(table)}
            for table in inspector.get_table_names()
            if table != "alembic_version"
        }
        engine.dispose()
        return schema

    created = indexes_per_table(created_path)
    migrated = indexes_per_table(migrated_path)

    assert set(created) == set(migrated), (
        "Tablas sólo en create_all: "
        f"{sorted(set(created) - set(migrated))}; sólo en migraciones: "
        f"{sorted(set(migrated) - set(created))}"
    )

    divergent = {
        table: {
            "faltan_en_create_all": sorted(migrated[table] - created[table]),
            "faltan_en_migraciones": sorted(created[table] - migrated[table]),
        }
        for table in created
        if created[table] != migrated[table]
    }
    assert divergent == {}, f"Índices divergentes entre instalación fresca y migrada: {divergent}"
