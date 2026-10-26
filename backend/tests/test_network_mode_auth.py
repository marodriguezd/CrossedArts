"""
P2.4 — El modo red no puede quedar abierto por accidente.

Antes: `ALLOW_NETWORK_ACCESS=true` exponía la API SIN autenticación y
`uvicorn.run(..., reload=True)` estaba fijado en el arranque.
Ahora: el modo red exige `API_TOKEN` (Bearer), aplica un límite por cliente y
`reload` está desactivado salvo petición explícita de desarrollo, y nunca en red.
"""
import pytest
from fastapi.testclient import TestClient

from backend.app.core import network_security as ns
from backend.app.core.settings import CrossedArtsSettings, settings
from backend.app.main import app


# ---------------------------------------------------------------------------
# Contrato puro
# ---------------------------------------------------------------------------

def test_loopback_never_needs_a_token():
    assert ns.is_network_mode("127.0.0.1", True) is False
    assert ns.validate_network_exposure("127.0.0.1", True, "") is None


def test_network_mode_requires_a_token():
    refusal = ns.validate_network_exposure("0.0.0.0", True, "")
    assert refusal is not None
    assert "API_TOKEN" in refusal

    assert ns.validate_network_exposure("0.0.0.0", True, "x" * 40) is None


def test_network_mode_rejects_a_short_token():
    refusal = ns.validate_network_exposure("0.0.0.0", True, "corto")
    assert refusal is not None
    assert "16" in refusal


def test_reload_is_forced_off_in_network_mode():
    assert ns.resolve_reload(True, "0.0.0.0", True) is False
    assert ns.resolve_reload(True, "127.0.0.1", False) is True
    assert ns.resolve_reload(False, "127.0.0.1", False) is False


def test_uvicorn_reload_defaults_to_false():
    assert CrossedArtsSettings.model_fields["uvicorn_reload"].default is False
    assert CrossedArtsSettings.model_fields["api_token"].default == ""


@pytest.mark.parametrize(
    "header,expected",
    [
        (None, False),
        ("", False),
        ("Bearer", False),
        ("Basic abc", False),
        ("Bearer  secreto-de-prueba-largo", True),
    ],
)
def test_bearer_parsing_and_comparison(header, expected):
    assert ns.is_token_valid(header, "secreto-de-prueba-largo") is expected


def test_rate_limiter_blocks_after_the_quota():
    limiter = ns.RateLimiter(max_requests=2, window_seconds=60)
    assert limiter.check("cliente", now=0.0) is True
    assert limiter.check("cliente", now=1.0) is True
    assert limiter.check("cliente", now=2.0) is False
    # Otra ventana temporal vuelve a permitir.
    assert limiter.check("cliente", now=120.0) is True
    # Otro cliente tiene su propia cuota.
    assert limiter.check("otro", now=2.0) is True


# ---------------------------------------------------------------------------
# Comportamiento HTTP real (middleware)
# ---------------------------------------------------------------------------

@pytest.fixture
def network_mode(monkeypatch):
    """Activa el modo red con un token conocido y restaura la configuración."""
    monkeypatch.setattr(settings, "host", "0.0.0.0")
    monkeypatch.setattr(settings, "allow_network_access", True)
    monkeypatch.setattr(settings, "api_token", "token-secreto-de-prueba")
    # Cuota amplia para que el test de auth no choque con el limitador.
    import backend.app.main as main_module

    monkeypatch.setattr(
        main_module,
        "_rate_limiter",
        ns.RateLimiter(max_requests=100, window_seconds=60),
    )
    return settings


def test_network_mode_without_authorization_returns_401(network_mode):
    client = TestClient(app)
    response = client.get("/api/v1/resources")
    assert response.status_code == 401
    assert "Bearer" in response.headers.get("www-authenticate", "")


def test_network_mode_with_wrong_token_returns_403(network_mode):
    client = TestClient(app)
    response = client.get("/api/v1/resources", headers={"Authorization": "Bearer incorrecto"})
    assert response.status_code == 403


def test_network_mode_with_valid_token_is_allowed(network_mode):
    client = TestClient(app)
    response = client.get(
        "/api/v1/resources",
        headers={"Authorization": "Bearer token-secreto-de-prueba"},
    )
    assert response.status_code == 200


def test_health_probe_stays_public_in_network_mode(network_mode):
    client = TestClient(app)
    assert client.get("/api/health").status_code == 200


@pytest.mark.parametrize(
    "path,requires_token",
    [
        ("/api", True),
        ("/api/v1/resources", True),
        ("/api/v1/ai/chat", True),
        ("/api/health", False),
        ("/", False),
        ("/index.html", False),
        ("/assets/index-abc.js", False),
        ("/manifest.json", False),
        ("/sw.js", False),
        ("/docs", False),
        ("/openapi.json", False),
        # Un prefijo parecido no es la API.
        ("/apix/v1/resources", False),
    ],
)
def test_network_token_scope_is_the_api_only(path, requires_token):
    assert ns.requires_network_token(path) is requires_token


def test_static_shell_and_docs_are_reachable_without_a_token(network_mode):
    """El shell y Swagger no llevan datos de usuario: en red siguen públicos.

    Antes el guard los cerraba con 401 y un navegador de otra máquina no podía
    abrir la app servida desde `dist/` (ni usar `/docs`), porque una navegación
    no puede adjuntar `Authorization`.
    """
    client = TestClient(app)
    for path in ("/", "/docs", "/openapi.json"):
        response = client.get(path)
        assert response.status_code == 200, f"{path} -> {response.status_code}"


def test_api_still_requires_a_token_in_network_mode(network_mode):
    """El shell público no abre la API: los datos siguen detrás del token."""
    client = TestClient(app)
    assert client.get("/api/v1/resources").status_code == 401
    assert client.get("/api").status_code == 401


def test_cors_middleware_wraps_the_guard():
    """El orden estructural: CORS por fuera del guard (el primero de la lista)."""
    order = [mw.cls.__name__ for mw in app.user_middleware if hasattr(mw, "cls")]
    assert order.index("CORSMiddleware") < order.index("BaseHTTPMiddleware")


def test_guard_rejections_carry_cors_headers(network_mode):
    """401/403/429 deben pasar por CORSMiddleware.

    Antes el guard era el middleware más externo, así que sus `JSONResponse`
    salían sin `Access-Control-Allow-Origin`: el navegador veía un error CORS
    opaco en vez del 401 real y la UI no podía distinguir "falta el token" de
    una caída de red.
    """
    import backend.app.main as main_module

    client = TestClient(app)
    origin = settings.cors_origin_list[0]

    unauthorized = client.get("/api/v1/resources", headers={"Origin": origin})
    assert unauthorized.status_code == 401
    assert unauthorized.headers.get("access-control-allow-origin") == origin

    forbidden = client.get(
        "/api/v1/resources",
        headers={"Origin": origin, "Authorization": "Bearer incorrecto"},
    )
    assert forbidden.status_code == 403
    assert forbidden.headers.get("access-control-allow-origin") == origin

    # Cuota de una sola petición: la primera pasa (y da 401), la segunda da 429.
    import backend.app.core.network_security as ns_module

    previous = main_module._rate_limiter
    main_module._rate_limiter = ns_module.RateLimiter(max_requests=1, window_seconds=60)
    try:
        assert client.get("/api/v1/resources", headers={"Origin": origin}).status_code == 401
        throttled = client.get("/api/v1/resources", headers={"Origin": origin})
        assert throttled.status_code == 429
        assert throttled.headers.get("access-control-allow-origin") == origin
    finally:
        main_module._rate_limiter = previous


def test_cors_preflight_still_answers_without_a_token(network_mode):
    client = TestClient(app)
    origin = settings.cors_origin_list[0]
    response = client.options(
        "/api/v1/resources",
        headers={
            "Origin": origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == origin


def test_loopback_requests_need_no_token(client: TestClient):
    # `settings.host` sigue en loopback en este test: uso local intacto.
    response = client.get("/api/v1/resources")
    assert response.status_code == 200
