"""
P1-11 — Regresión: la API no debe volverse insegura solo por cambiar `host`.

El backend no tiene autenticación. Por defecto solo escucha en loopback; enlazar
una interfaz no local (p. ej. `0.0.0.0`) exige un opt-in explícito
(`ALLOW_NETWORK_ACCESS=true`) y nunca debe ocurrir en silencio.
"""
import pytest

from backend.app.core.settings import CrossedArtsSettings
from backend.app.main import is_loopback_host, resolve_binding


# ---------------------------------------------------------------------------
# Defaults declarados
# ---------------------------------------------------------------------------

def test_default_host_is_loopback_and_network_access_is_off():
    """Los valores por defecto no exponen la API: loopback y sin opt-in."""
    fields = CrossedArtsSettings.model_fields
    assert fields["host"].default == "127.0.0.1"
    assert fields["allow_network_access"].default is False


def test_default_cors_origins_never_use_wildcard():
    """CORS no debe permitir todos los orígenes bajo ninguna configuración base."""
    settings = CrossedArtsSettings()
    assert "*" not in settings.cors_origin_list
    assert settings.cors_origin_list, "La lista de orígenes no puede quedar vacía"


# ---------------------------------------------------------------------------
# Detección de loopback
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1", "  127.0.0.1  ", "LocalHost"])
def test_is_localhost_binding_true_for_loopback(host):
    assert CrossedArtsSettings(host=host).is_localhost_binding is True


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.10", "::", "example.internal"])
def test_is_localhost_binding_false_for_non_loopback(host):
    assert CrossedArtsSettings(host=host).is_localhost_binding is False


def test_is_loopback_host_normalizes_whitespace_and_case():
    assert is_loopback_host("  Localhost ") is True
    assert is_loopback_host("0.0.0.0") is False
    assert is_loopback_host("") is False


# ---------------------------------------------------------------------------
# resolve_binding: función pura y determinista
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("host", ["127.0.0.1", "localhost", "::1"])
@pytest.mark.parametrize("allow", [False, True])
def test_resolve_binding_always_allows_loopback(host, allow):
    resolved, refusal = resolve_binding(host, allow)
    assert resolved == host
    assert refusal is None


def test_resolve_binding_refuses_network_binding_without_opt_in():
    resolved, refusal = resolve_binding("0.0.0.0", allow_network_access=False)
    assert resolved == "0.0.0.0"
    assert refusal is not None
    assert "ALLOW_NETWORK_ACCESS=true" in refusal
    assert "no tiene autenticación" in refusal.lower()


def test_resolve_binding_allows_network_binding_with_explicit_opt_in():
    resolved, refusal = resolve_binding("0.0.0.0", allow_network_access=True)
    assert resolved == "0.0.0.0"
    assert refusal is None


def test_resolve_binding_is_deterministic():
    assert resolve_binding("0.0.0.0", False) == resolve_binding("0.0.0.0", False)
    assert resolve_binding("127.0.0.1", True) == resolve_binding("127.0.0.1", True)
