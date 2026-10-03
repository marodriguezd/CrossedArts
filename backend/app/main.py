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
    print("[DomestiK] Base de datos SQLite inicializada correctamente.")

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
    print(f"[DomestiK] Proveedor de LLM inicializado: {LLMService.get_provider_name()}")
    print(f"[DomestiK] Proveedor de Embedding inicializado: {EmbeddingService.get_model_name()}")

    yield

    # Clean up shared HTTP clients
    await app.state.http_client.aclose()
    app.state.http_client_sync.close()

app = FastAPI(
    title="DomestiK API",
    description="Learning Operating System autohospedable y local-first",
    version="0.1.0",
    lifespan=lifespan
)

# Registrar el router global de la API con versión /api/v1
app.include_router(api_router)

@app.get("/api/health")
def health_check():
    return {"status": "healthy"}

# ==========================================
# INTEGRACIÓN DE FRONTEND (NICEGUI)
# ==========================================
from nicegui import ui
from frontend.app.dashboard import DashboardPage
from frontend.app.library import LibraryPage
from frontend.app.course_detail import CourseDetailPage
from frontend.app.book_detail import BookDetailPage
from frontend.app.notes_list import NotesListPage
from frontend.app.search_results import SearchResultsPage
from frontend.app.semantic_search import SemanticSearchPage
from frontend.app.pages.learning_paths import LearningPathsPage
from frontend.app.pages.study_plans import StudyPlansPage
from frontend.app.pages.goals import GoalsPage
from frontend.app.pages.habits import HabitsPage
from frontend.app.pages.review_center import ReviewCenterPage
from frontend.app.pages.knowledge_graph import KnowledgeGraphPage
from frontend.app.pages.settings import SettingsPage
from frontend.app.pages.about import AboutPage


@ui.page('/')
def show_dashboard():
    page = DashboardPage()
    page.draw()


@ui.page('/library')
def show_library():
    page = LibraryPage()
    page.draw()

@ui.page('/course/{course_id}')
def show_course_detail(course_id: str):
    page = CourseDetailPage(course_id)
    page.draw()

@ui.page('/book/{book_id}')
def show_book_detail(book_id: str):
    page = BookDetailPage(book_id)
    page.draw()

@ui.page('/notes-list')
def show_notes_list():
    page = NotesListPage()
    page.draw()

@ui.page('/search-results')
def show_search_results(q: str = ''):
    page = SearchResultsPage(q)
    page.draw()

@ui.page('/semantic-search')
def show_semantic_search():
    page = SemanticSearchPage()
    page.draw()

@ui.page('/learning-paths')
def show_learning_paths():
    page = LearningPathsPage()
    page.draw()

@ui.page('/study-plans')
def show_study_plans():
    page = StudyPlansPage()
    page.draw()

@ui.page('/goals')
def show_goals():
    page = GoalsPage()
    page.draw()

@ui.page('/habits')
def show_habits():
    page = HabitsPage()
    page.draw()

@ui.page('/review-center')
def show_review_center():
    page = ReviewCenterPage()
    page.draw()

@ui.page('/knowledge-graph')
def show_knowledge_graph():
    page = KnowledgeGraphPage()
    page.draw()


@ui.page('/settings')
def show_settings():
    page = SettingsPage()
    page.draw()


@ui.page('/about')
def show_about():
    page = AboutPage()
    page.draw()



# Montar NiceGUI sobre FastAPI
from nicegui import app as nicegui_app
static_dir = str(settings.static_dir)
settings.ensure_dirs()
nicegui_app.add_static_files("/static", static_dir)

ui.run_with(app, mount_path="/", title="DomestiK")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host="127.0.0.1", port=settings.port, reload=True)
