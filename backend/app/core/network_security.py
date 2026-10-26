"""
Protección del modo red del backend.

CrossedArts es local-first: la API escucha en loopback y no pide credenciales
porque nadie más puede alcanzarla. Exponerla a la red es una decisión explícita
(`ALLOW_NETWORK_ACCESS=true`) y, en ese caso, la API exige un token Bearer
(`API_TOKEN`) además de un límite de peticiones básico.

Este módulo contiene sólo funciones puras y un limitador en memoria, para poder
verificar el contrato sin arrancar el servidor.
"""
from __future__ import annotations

import secrets
import time
from collections import deque

LOOPBACK_BINDINGS = {"127.0.0.1", "localhost", "::1"}

#: Prefijo de la API con datos. Es el ÚNICO espacio que se protege en red.
API_PREFIX = "/api"

#: Rutas de la API que nunca requieren token ni consumen cuota (sonda de vida).
PUBLIC_PATHS = {"/api/health"}


def is_loopback_host(host: str) -> bool:
    """True cuando el host enlaza únicamente la interfaz local."""
    return (host or "").strip().lower() in LOOPBACK_BINDINGS


def is_network_mode(host: str, allow_network_access: bool) -> bool:
    """
    True cuando la API es alcanzable desde la red.

    Es la ÚNICA condición que activa autenticación y limitación de peticiones:
    en loopback el uso local sigue funcionando sin configurar nada.
    """
    return bool(allow_network_access) and not is_loopback_host(host)


def validate_network_exposure(host: str, allow_network_access: bool, api_token: str) -> str | None:
    """
    Returns a refusal message when the requested exposure is unsafe.

    Modo red sin token era una API abierta: ahora se rechaza el arranque con un
    mensaje accionable en vez de servir datos locales a cualquiera.
    """
    if not is_network_mode(host, allow_network_access):
        return None
    if not (api_token or "").strip():
        return (
            "Modo red sin autenticación: define API_TOKEN (un secreto largo y aleatorio) "
            "antes de exponer CrossedArts en la red, o vuelve a HOST=127.0.0.1. La API "
            "sirve datos locales de estudio y no debe quedar abierta."
        )
    if len(api_token.strip()) < 16:
        return (
            "API_TOKEN es demasiado corto para el modo red (mínimo 16 caracteres). "
            "Usa un secreto aleatorio largo o vuelve a HOST=127.0.0.1."
        )
    return None


def resolve_reload(requested: bool, host: str, allow_network_access: bool) -> bool:
    """
    `--reload` reescribe código en vivo y no debe usarse fuera de desarrollo.

    Se desactiva siempre en modo red: un reinicio del vigilante durante una
    petición deja el servicio a medias y complica la auditoría.
    """
    if is_network_mode(host, allow_network_access):
        return False
    return bool(requested)


def extract_bearer_token(authorization: str | None) -> str | None:
    """Bearer token de la cabecera `Authorization`, o None si no lo hay."""
    if not authorization:
        return None
    parts = authorization.strip().split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def is_token_valid(authorization: str | None, expected_token: str) -> bool:
    """
    Compara el token en tiempo constante.

    Un `==` filtraba el secreto por temporización; `secrets.compare_digest` no.
    """
    provided = extract_bearer_token(authorization)
    expected = (expected_token or "").strip()
    if not provided or not expected:
        return False
    return secrets.compare_digest(provided, expected)


def requires_network_token(path: str) -> bool:
    """
    True sólo para las rutas de la API que sirven datos (en modo red).

    El shell estático (`/`, `/assets/*`, `/manifest.json`), la documentación
    (`/docs`, `/openapi.json`) y la sonda de salud no lo requieren: no contienen
    datos de usuario y un navegador no puede adjuntar `Authorization` a una
    navegación, así que cerrarlos dejaba la app inabrible desde otra máquina.
    Los datos de estudio se sirven exclusivamente bajo `/api/*`.
    """
    normalized = path or "/"
    if normalized in PUBLIC_PATHS:
        return False
    return normalized == API_PREFIX or normalized.startswith(f"{API_PREFIX}/")


class RateLimiter:
    """
    Límite deslizante en memoria por cliente.

    No pretende ser un WAF: evita que un cliente accidental (o un script) agote
    la API en red. Cada proceso mantiene su propia ventana, que es suficiente
    para el uso previsto (un servidor local con acceso explícito).
    """

    def __init__(self, max_requests: int = 60, window_seconds: float = 60.0) -> None:
        self.max_requests = max(1, int(max_requests))
        self.window_seconds = max(1.0, float(window_seconds))
        self._hits: dict[str, deque[float]] = {}

    def check(self, key: str, now: float | None = None) -> bool:
        """Registra una petición y devuelve False si supera la cuota."""
        current = time.monotonic() if now is None else now
        hits = self._hits.setdefault(key, deque())
        cutoff = current - self.window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= self.max_requests:
            return False
        hits.append(current)
        # Clientes que dejan de aparecer no se acumulan para siempre.
        if len(self._hits) > 1024:
            for client, window in list(self._hits.items()):
                if not window or window[-1] <= cutoff:
                    self._hits.pop(client, None)
        return True

    def retry_after_seconds(self, key: str, now: float | None = None) -> int:
        """Segundos hasta que el cliente recupera cuota (para `Retry-After`)."""
        current = time.monotonic() if now is None else now
        hits = self._hits.get(key)
        if not hits:
            return 0
        return max(1, int(round(self.window_seconds - (current - hits[0]))))
