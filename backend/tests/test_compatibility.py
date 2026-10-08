from pathlib import Path
from backend.app.core.compatibility import (
    resolve_legacy_env_file,
    resolve_legacy_data_dir,
    resolve_legacy_db_path,
    is_legacy_allowed_path_part,
)


def test_compatibility_resolve_env_file(tmp_path, monkeypatch):
    test_home = tmp_path / "userhome"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)

    # When neither exists, returns ~/.domestik/.env fallback path
    assert resolve_legacy_env_file() == test_home / ".domestik" / ".env"

    # When crossedarts .env exists, returns it
    ca_dir = test_home / ".crossedarts"
    ca_dir.mkdir()
    ca_env = ca_dir / ".env"
    ca_env.write_text("TEST=1")
    assert resolve_legacy_env_file() == ca_env


def test_compatibility_resolve_data_dir(tmp_path, monkeypatch):
    test_home = tmp_path / "userhome"
    test_home.mkdir()
    monkeypatch.setattr(Path, "home", lambda: test_home)

    # When neither exists, defaults to ~/.crossedarts
    assert resolve_legacy_data_dir() == test_home / ".crossedarts"

    # When legacy ~/.domestik exists but ~/.crossedarts doesn't, resolves legacy
    legacy_dir = test_home / ".domestik"
    legacy_dir.mkdir()
    assert resolve_legacy_data_dir() == legacy_dir

    # When primary ~/.crossedarts exists, prefers primary even if legacy exists
    primary_dir = test_home / ".crossedarts"
    primary_dir.mkdir()
    assert resolve_legacy_data_dir() == primary_dir


def test_compatibility_resolve_db_path(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()

    # When neither exists, defaults to crossedarts.db
    assert resolve_legacy_db_path(data_dir) == data_dir / "crossedarts.db"

    # When only domestik.db exists, resolves legacy
    legacy_db = data_dir / "domestik.db"
    legacy_db.touch()
    assert resolve_legacy_db_path(data_dir) == legacy_db

    # When crossedarts.db exists, prefers primary
    primary_db = data_dir / "crossedarts.db"
    primary_db.touch()
    assert resolve_legacy_db_path(data_dir) == primary_db


def test_is_legacy_allowed_path_part():
    assert is_legacy_allowed_path_part(".domestik") is True
    assert is_legacy_allowed_path_part(".crossedarts") is True
    assert is_legacy_allowed_path_part(".git") is False
    assert is_legacy_allowed_path_part(".env") is False
