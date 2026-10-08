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
