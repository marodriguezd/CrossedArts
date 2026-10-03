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


def test_startup_migration_mode(monkeypatch):
    """Verify that lifespan respects AUTO_CREATE_TABLES setting without throwing."""
    from fastapi.testclient import TestClient
    from backend.app.main import app
    monkeypatch.setenv("AUTO_CREATE_TABLES", "0")
    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200

    monkeypatch.setenv("AUTO_CREATE_TABLES", "1")
    with TestClient(app) as client:
        resp = client.get("/api/health")
        assert resp.status_code == 200
