import os
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from backend.app.core.database import engine, Base
from backend.app.core.settings import settings
from backend.app.core.logging import get_logger
from backend.app.core.network_security import (
    RateLimiter,
    is_loopback_host,
    is_token_valid,
    network_auth_required,
    requires_network_token,
    resolve_reload,
    validate_network_exposure,
)
from backend.app.api.router import api_router
# Import models so SQLAlchemy registers them in Base.metadata.
import backend.app.models  # noqa: F401

logger = get_logger("main")

# `is_loopback_host` lives in core.network_security (one list, imported here).


def resolve_binding(host: str, allow_network_access: bool) -> tuple[str, str | None]:
    """
    Resolve the server listen interface.

    Returns `(host, rejection_reason)`. `rejection_reason` is `None` when the
    binding is safe: loopback, or a non-local interface with explicit opt-in.
    Otherwise it is an actionable message for unauthorized network exposure.

    Pure function, testable without booting the server.
    """
    normalized = (host or "127.0.0.1").strip()
    if is_loopback_host(normalized) or allow_network_access:
        return normalized, None
    return normalized, (
        f"Se pidió enlazar CrossedArts en '{normalized}', accesible desde la red. En local "
        "la API no pide credenciales, pero exponerla exige autorización explícita: define "
        "ALLOW_NETWORK_ACCESS=true y un API_TOKEN de al menos 16 caracteres (todas las "
        "rutas /api/* lo exigirán). Vuelve a HOST=127.0.0.1 si no es lo que quieres."
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # In production apply migrations via Alembic (PYTHONPATH=. alembic -c backend/alembic.ini upgrade head).
    # Auto-creation is only enabled explicitly in dev/test via AUTO_CREATE_TABLES=1.
    auto_create = os.getenv("AUTO_CREATE_TABLES", "0").lower() in ("1", "true", "yes")
    if auto_create:
        Base.metadata.create_all(bind=engine)
        logger.info("Base de datos SQLite inicializada (modo AUTO_CREATE_TABLES).")
    elif os.getenv("SKIP_MIGRATION_VALIDATION", "0").lower() not in ("1", "true", "yes"):
        # Migration-state validation: fail early on an unapplied database or a
        # schema that does not match the history. Read-only; it never repairs
        # anything on its own.
        from backend.app.core.migrations import validate_migration_state

        report = validate_migration_state(engine)
        if report.is_valid:
            logger.info(report.message)
        else:
            logger.error("Estado de migraciones inválido (%s): %s", report.status, report.message)
            raise RuntimeError(
                "CrossedArts no puede arrancar: el estado de migraciones de la base de "
                f"datos no es válido ({report.status}). {report.message}"
            )
    else:
        logger.info("Inicio en modo migración Alembic (validación desactivada por entorno).")

    # Initialize shared HTTP client pool (async for LLM calls)
    limits = httpx.Limits(max_keepalive_connections=20, max_connections=100)
    app.state.http_client = httpx.AsyncClient(limits=limits, timeout=60.0)

    # Initialize shared HTTP client pool (sync for embedding calls)
    sync_limits = httpx.Limits(max_keepalive_connections=10, max_connections=50)
    app.state.http_client_sync = httpx.Client(limits=sync_limits, timeout=60.0)

    # Init AI providers from environment.
    from backend.app.services.llm import LLMService
    from backend.app.services.embedding import EmbeddingService
    LLMService.initialize_from_env(client=app.state.http_client)
    EmbeddingService.initialize_from_env(client=app.state.http_client_sync)
    logger.info("Proveedor de LLM inicializado: %s", LLMService.get_provider_name())
    logger.info("Proveedor de Embedding inicializado: %s", EmbeddingService.get_model_name())

    yield

    # Clean up shared HTTP clients
    await app.state.http_client.aclose()
    app.state.http_client_sync.close()


app = FastAPI(
    title="CrossedArts API",
    description="Self-hosted local-first Learning Operating System",
    version="1.0.1",
    lifespan=lifespan
)

# NETWORK MODE GUARD.
#
# The API serves local study data and, in loopback, deliberately needs no
# credentials. Every other case is unsafe, so a `/api/*` request needs the
# configured Bearer token and stays inside a basic per-client rate limit. The
# static shell and the documentation stay public (they hold no user data, and a
# browser cannot send an `Authorization` header on a navigation).
#
# The decision reads the CONNECTING client address, not the configured host: a
# server started outside `__main__` (e.g. `uvicorn backend.app.main:app --host
# 0.0.0.0`) keeps the loopback default in settings, so trusting settings alone
# left the API open. The configured network mode is still sufficient on its own,
# which keeps a local reverse proxy protected even when it connects from
# 127.0.0.1.
_rate_limiter = RateLimiter(max_requests=settings.network_rate_limit_per_minute, window_seconds=60.0)


@app.middleware("http")
async def network_mode_guard(request: Request, call_next):
    # Evaluated per request (not at import time) so the guard always reflects the
    # live configuration instead of whatever was set when the module loaded.
    if request.method == "OPTIONS" or not requires_network_token(request.url.path):
        return await call_next(request)

    client_key = request.client.host if request.client else "desconocido"
    if not network_auth_required(client_key, settings.host, settings.allow_network_access):
        return await call_next(request)

    if not _rate_limiter.check(client_key):
        retry_after = _rate_limiter.retry_after_seconds(client_key)
        return JSONResponse(
            status_code=429,
            content={"detail": "Demasiadas peticiones: espera antes de reintentar."},
            headers={"Retry-After": str(retry_after)},
        )

    authorization = request.headers.get("authorization")
    if not authorization:
        return JSONResponse(
            status_code=401,
            content={"detail": "Falta el token Bearer para usar la API fuera de loopback."},
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not is_token_valid(authorization, settings.api_token):
        return JSONResponse(
            status_code=403,
            content={"detail": "Token Bearer no válido para la API fuera de loopback."},
            headers={"WWW-Authenticate": "Bearer"},
        )

    return await call_next(request)


# CORS setup.
#
# It used to be allow_origins=["*"] with allow_credentials=True, an overly broad
# combination browsers reject for credentialed requests. CrossedArts is
# local-first: only the real local origins running the frontend are allowed
# (Vite on 5173 and the backend itself on its configured port). The list is
# configurable via CORS_ORIGINS (comma-separated) for concrete deployments.
#
# Registered AFTER the guard on purpose: Starlette applies middleware in reverse
# registration order, so the last one added is the OUTERMOST. CORS therefore sees
# the guard's short-circuit responses and decorates the 401/403/429 too; added
# first, the browser got a CORS error instead of the real status and the UI
# could not tell "falta el token" from a network failure.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)


# Register the global versioned API router (/api/v1).
app.include_router(api_router)

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "CrossedArts API"}

# Static files and data setup.
settings.ensure_dirs()
static_dir = settings.static_dir
if static_dir.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# Montar frontend compilado (dist) si existe
frontend_dist = settings.static_dir.parent / "frontend" / "dist"
if frontend_dist.exists() and (frontend_dist / "index.html").exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")
else:
    @app.get("/")
    def root():
        return {
            "name": "CrossedArts API",
            "version": "1.0.1",
            "description": "Learning Operating System API (Backend)",
            "docs": "/docs",
            "health": "/api/health"
        }

if __name__ == "__main__":
    import uvicorn

    host, refusal = resolve_binding(settings.host, settings.allow_network_access)
    if refusal:
        logger.error(refusal)
        raise SystemExit(1)

    # Network exposure without a token used to start an unauthenticated API.
    exposure_refusal = validate_network_exposure(host, settings.allow_network_access, settings.api_token)
    if exposure_refusal:
        logger.error(exposure_refusal)
        raise SystemExit(1)

    if not is_loopback_host(host):
        logger.warning(
            "MODO RED ACTIVADO: la API escucha en %s:%s y exige Authorization: Bearer <API_TOKEN> "
            "en cada petición, con un límite de %s peticiones por minuto y cliente. Si usas "
            "Ollama define OLLAMA_ORIGINS con tu origen exacto (p. ej. http://localhost:5173) "
            "en lugar de \"*\".",
            host,
            settings.port,
            settings.network_rate_limit_per_minute,
        )

    # `reload` is a development convenience: it rewrites code while serving and is
    # forced off whenever the API is reachable from the network.
    reload_enabled = resolve_reload(settings.uvicorn_reload, host, settings.allow_network_access)
    uvicorn.run("backend.app.main:app", host=host, port=settings.port, reload=reload_enabled)
