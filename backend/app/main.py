import os
import httpx
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.core.database import engine, Base
from backend.app.core.settings import settings
from backend.app.core.logging import get_logger
from backend.app.api.router import api_router
# Import models so SQLAlchemy registers them in Base.metadata.
import backend.app.models  # noqa: F401

logger = get_logger("main")

# Loopback interfaces: binding here never exposes the API to the network.
LOCALHOST_BINDINGS = {"127.0.0.1", "localhost", "::1"}


def is_loopback_host(host: str) -> bool:
    """True when the host binds to the local interface only."""
    return (host or "").strip().lower() in LOCALHOST_BINDINGS


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
        f"Se pidió enlazar CrossedArts en '{normalized}', accesible desde la red, pero la "
        "API NO tiene autenticación y está pensada para uso local. Autoriza el modo red de "
        "forma explícita con ALLOW_NETWORK_ACCESS=true (asumiendo el riesgo) o vuelve a "
        "HOST=127.0.0.1."
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

# CORS setup.
#
# It used to be allow_origins=["*"] with allow_credentials=True, an overly broad
# combination browsers reject for credentialed requests. CrossedArts is
# local-first: only the real local origins running the frontend are allowed
# (Vite on 5173 and the backend itself on its configured port). The list is
# configurable via CORS_ORIGINS (comma-separated) for concrete deployments.
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

    if not is_loopback_host(host):
        logger.warning(
            "MODO RED ACTIVADO: la API escucha en %s:%s y es alcanzable desde la red SIN "
            "autenticación. Restringe el acceso con un cortafuegos o un reverse proxy, y si "
            "usas Ollama define OLLAMA_ORIGINS con tu origen exacto (p. ej. "
            "http://localhost:5173) en lugar de \"*\".",
            host,
            settings.port,
        )

    uvicorn.run("backend.app.main:app", host=host, port=settings.port, reload=True)
