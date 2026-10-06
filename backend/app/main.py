import os
import httpx
from fastapi import FastAPI
from backend.app.core.database import engine, Base
from backend.app.core.settings import settings
from backend.app.core.logging import get_logger
from backend.app.api.router import api_router
# Importar modelos para que SQLAlchemy los registre en Base.metadata
from backend.app.models import *

from contextlib import asynccontextmanager

logger = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # En producción las migraciones deben aplicarse vía Alembic (PYTHONPATH=. alembic -c backend/alembic.ini upgrade head).
    # La creación automática solo se habilita explícitamente en desarrollo/test mediante AUTO_CREATE_TABLES=1
    auto_create = os.getenv("AUTO_CREATE_TABLES", "0").lower() in ("1", "true", "yes")
    if auto_create:
        Base.metadata.create_all(bind=engine)
        logger.info("Base de datos SQLite inicializada (modo AUTO_CREATE_TABLES).")
    elif not os.getenv("SKIP_MIGRATION_VALIDATION", "0").lower() in ("1", "true", "yes"):
        # Validación del estado de migraciones: detectar de forma temprana
        # una base sin aplicar o con un esquema que no corresponde al historial.
        # Es de solo lectura y NO repara nada por su cuenta.
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

    # Inicializar proveedores de IA según variables de entorno
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

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="CrossedArts API",
    description="Learning Operating System autohospedable y local-first",
    version="1.0.0",
    lifespan=lifespan
)

# Configuración de CORS.
#
# Antes se usaba allow_origins=["*"] junto a allow_credentials=True, una
# combinación innecesariamente amplia que los navegadores rechazan para
# peticiones con credenciales. CrossedArts es local-first: solo se permiten los
# orígenes locales reales desde los que corre el frontend (Vite en 5173 y el
# propio backend en el puerto configurado). La lista es configurable mediante
# CORS_ORIGINS (separada por comas) para despliegues concretos.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept", "X-Requested-With"],
)

# Registrar el router global de la API con versión /api/v1
app.include_router(api_router)

@app.get("/api/health")
def health_check():
    return {"status": "healthy", "service": "CrossedArts API"}

# Configuración de archivos estáticos y datos
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
            "version": "1.0.0",
            "description": "Learning Operating System API (Backend)",
            "docs": "/docs",
            "health": "/api/health"
        }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=settings.host, port=settings.port, reload=True)
