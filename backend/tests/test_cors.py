"""
A-3 — Regresión: la política CORS debe estar restringida a los orígenes
locales reales del frontend, nunca `*` junto a credenciales.
"""
import pytest

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]


def _app_middleware_config():
    from backend.app.main import app

    cors_middleware = next(
        (m for m in app.user_middleware if m.cls.__name__ == "CORSMiddleware"),
        None,
    )
    assert cors_middleware is not None, "La aplicación debe montar CORSMiddleware"
    return cors_middleware.kwargs


def test_cors_uses_explicit_origins_never_wildcard():
    kwargs = _app_middleware_config()
    origins = kwargs.get("allow_origins")
    assert isinstance(origins, list)
    assert origins, "La lista de orígenes no puede estar vacía"
    assert "*" not in origins, "CORS no debe permitir todos los orígenes"
    assert kwargs.get("allow_credentials") is True


def test_cors_configured_origins_match_local_development():
    kwargs = _app_middleware_config()
    assert set(kwargs.get("allow_origins")) == set(ALLOWED_ORIGINS)
    # Métodos y cabeceras explícitos en lugar de comodines innecesarios.
    assert set(kwargs.get("allow_methods")) <= {
        "GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"
    }


def test_preflight_from_allowed_origin_is_accepted(client):
    response = client.options(
        "/api/v1/resources",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "Content-Type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert response.headers["access-control-allow-credentials"] == "true"


@pytest.mark.parametrize("origin", ALLOWED_ORIGINS)
def test_simple_request_from_allowed_origin_exposes_cors_headers(client, origin):
    response = client.get("/api/health", headers={"Origin": origin})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin


def test_preflight_from_foreign_origin_is_rejected(client):
    response = client.options(
        "/api/v1/resources",
        headers={
            "Origin": "https://malicious.example",
            "Access-Control-Request-Method": "GET",
        },
    )
    # CORSMiddleware responde 400 a la preflight de un origen no permitido y
    # nunca expone cabeceras CORS para él.
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


def test_simple_request_from_foreign_origin_has_no_cors_headers(client):
    response = client.get("/api/health", headers={"Origin": "https://malicious.example"})
    assert response.status_code == 200  # la API responde, pero sin cabeceras CORS
    assert "access-control-allow-origin" not in response.headers


def test_cors_origins_are_configurable_via_settings():
    from backend.app.core.settings import CrossedArtsSettings

    custom = CrossedArtsSettings(
        cors_origins="http://a.local:9000, http://b.local:9001 ,"
    )
    assert custom.cors_origin_list == ["http://a.local:9000", "http://b.local:9001"]

    default = CrossedArtsSettings()
    assert "http://localhost:5173" in default.cors_origin_list
