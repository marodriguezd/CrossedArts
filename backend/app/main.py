import httpx
from fastapi import FastAPI
from backend.app.core.database import engine, Base
from backend.app.core.settings import settings
from backend.app.api.router import api_router
# Importar modelos para que SQLAlchemy los registre en Base.metadata
from backend.app.models import *

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Creación automática de tablas si no existen
    Base.metadata.create_all(bind=engine)
    print("[CrossedArts] Base de datos SQLite inicializada correctamente.")

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
    print(f"[CrossedArts] Proveedor de LLM inicializado: {LLMService.get_provider_name()}")
    print(f"[CrossedArts] Proveedor de Embedding inicializado: {EmbeddingService.get_model_name()}")

    yield

    # Clean up shared HTTP clients
    await app.state.http_client.aclose()
    app.state.http_client_sync.close()

app = FastAPI(
    title="CrossedArts API",
    description="Learning Operating System autohospedable y local-first",
    version="1.0.0",
    lifespan=lifespan
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

