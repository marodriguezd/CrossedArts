import httpx
import pytest


def test_health_check(client):
    """Health endpoint must return healthy status."""
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "CrossedArts API"


def test_lifespan_startup_shutdown():
    """Ensure the FastAPI lifespan context starts and shuts down correctly."""
    from fastapi.testclient import TestClient
    from backend.app.main import app
    
    with TestClient(app) as client:
        response = client.get("/api/health")
        assert response.status_code == 200


@pytest.mark.asyncio
async def test_async_client_lifecycle():
    """AsyncClient must support create and close lifecycle."""
    client = httpx.AsyncClient(timeout=60.0)
    assert not client.is_closed
    await client.aclose()
    assert client.is_closed


def test_sync_client_lifecycle():
    """Sync Client must support create and close lifecycle."""
    client = httpx.Client(timeout=60.0)
    assert not client.is_closed
    client.close()
    assert client.is_closed


def test_startup_migration_mode(monkeypatch, tmp_path):
    """Verify that lifespan respects AUTO_CREATE_TABLES setting without throwing.

    A-1: AUTO_CREATE_TABLES=1 ejecuta `Base.metadata.create_all` sobre el engine
    referenciado por el módulo. Para que esta prueba nunca toque la base real
    del usuario, el engine del módulo `main` se sustituye por uno temporal.
    """
    from fastapi.testclient import TestClient
    from sqlalchemy import create_engine
    from backend.app.core.database import Base
    import backend.app.main as main_module

    isolated_engine = create_engine(f"sqlite:///{tmp_path / 'lifespan_isolated.db'}")
    monkeypatch.setattr(main_module, "engine", isolated_engine)

    monkeypatch.setenv("AUTO_CREATE_TABLES", "0")
    monkeypatch.setenv("SKIP_MIGRATION_VALIDATION", "1")
    with TestClient(main_module.app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200

    monkeypatch.setenv("AUTO_CREATE_TABLES", "1")
    with TestClient(main_module.app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
    # Las tablas se crearon en el engine aislado, no en la base real.
    from sqlalchemy import inspect
    assert "learning_resource" in inspect(isolated_engine).get_table_names()
    isolated_engine.dispose()
    _ = Base  # mantiene la importación usada por el contexto del parche
