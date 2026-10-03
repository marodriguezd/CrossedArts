import os
from pathlib import Path


def test_data_dir_property():
    from backend.app.core.settings import settings
    assert settings.data_dir == Path.home() / ".domestik"


def test_db_path_property():
    from backend.app.core.settings import settings
    assert settings.db_path == settings.data_dir / "domestik.db"


def test_media_dir_property():
    from backend.app.core.settings import settings
    assert settings.media_dir == settings.data_dir / "content"


def test_covers_dir_property():
    from backend.app.core.settings import settings
    assert settings.covers_dir == settings.data_dir / "covers"


def test_static_dir_property():
    from backend.app.core.settings import settings
    # static_dir should point to the project's static/ folder
    assert settings.static_dir.name == "static"
    assert settings.static_dir.exists()


def test_ensure_dirs_creates_directories(tmp_path, monkeypatch):
    from backend.app.core.settings import DomestiKSettings
    test_data = tmp_path / "test_data"
    monkeypatch.setattr(Path, "home", lambda: test_data)

    s = DomestiKSettings()
    s.ensure_dirs()

    assert s.data_dir.exists()
    assert s.media_dir.exists()
    assert s.covers_dir.exists()


def test_default_port():
    from backend.app.core.settings import DomestiKSettings
    s = DomestiKSettings(_env_file=None)
    assert s.port == 8080


def test_default_host():
    from backend.app.core.settings import DomestiKSettings
    s = DomestiKSettings(_env_file=None)
    assert s.host == "127.0.0.1"


def test_database_url_auto_computed():
    from backend.app.core.settings import settings
    assert "sqlite:///" in settings.database_url
    assert "domestik.db" in settings.database_url


def test_api_base_url_auto_computed():
    from backend.app.core.settings import settings
    assert settings.api_base_url == f"http://127.0.0.1:{settings.port}/api/v1"


def test_default_providers():
    from backend.app.core.settings import DomestiKSettings
    s = DomestiKSettings(_env_file=None)
    assert s.llm_provider == "mock"
    assert s.embedding_provider == "mock"
