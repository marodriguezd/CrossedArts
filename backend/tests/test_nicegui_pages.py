import pytest
import httpx
import uuid
from pathlib import Path
from sqlalchemy.orm import Session

from backend.app.main import app
from frontend.app.api_client import APIClient
from nicegui.testing import user_simulation

# Import all pages
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


@pytest.fixture(autouse=True)
def setup_api_client_asgi():
    """Configura el cliente API para usar transporte ASGI en memoria apuntando a FastAPI."""
    original_base = APIClient.BASE_URL
    original_client = APIClient._client
    
    APIClient.BASE_URL = "http://test/api/v1"
    APIClient._client = httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://test")
    
    yield
    
    APIClient.BASE_URL = original_base
    APIClient._client = original_client


@pytest.fixture(autouse=True)
def _patch_session_local(db: Session, monkeypatch):
    """Patch SessionLocal so services_direct uses the in-memory test DB."""
    class _NoCloseSession:
        def __init__(self, session):
            self._session = session
        def __getattr__(self, name):
            if name == 'close':
                return lambda: None
            return getattr(self._session, name)
        def __bool__(self):
            return True

    import frontend.app.services_direct as sd
    monkeypatch.setattr(sd, "_get_session", lambda: _NoCloseSession(db))


@pytest.mark.asyncio
async def test_dashboard_page(db: Session):
    def draw():
        DashboardPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Biblioteca")
        await user.should_see("Tiempo de Estudio", retries=50)


@pytest.mark.asyncio
async def test_library_page(db: Session):
    def draw():
        LibraryPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Biblioteca")
        await user.should_see("Tu Biblioteca")
        await user.should_see("Añadir Recurso")


@pytest.mark.asyncio
async def test_notes_list_page(db: Session):
    def draw():
        NotesListPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Notas de Estudio")
        await user.should_see("Mis Notas de Estudio", retries=50)


@pytest.mark.asyncio
async def test_semantic_search_page(db: Session):
    def draw():
        SemanticSearchPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Búsqueda Semántica")
        await user.should_see("Introduce tu consulta y presiona Descubrir")


@pytest.mark.asyncio
async def test_search_results_page(db: Session):
    def draw():
        SearchResultsPage("iluminacion").draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Resultados de Búsqueda")


@pytest.mark.asyncio
async def test_learning_paths_page(db: Session):
    def draw():
        LearningPathsPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Rutas de Aprendizaje")


@pytest.mark.asyncio
async def test_study_plans_page(db: Session):
    def draw():
        StudyPlansPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Planes de Estudio")


@pytest.mark.asyncio
async def test_goals_page(db: Session):
    def draw():
        GoalsPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Fijar Meta")


@pytest.mark.asyncio
async def test_habits_page(db: Session):
    def draw():
        HabitsPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Crear Hábito")


@pytest.mark.asyncio
async def test_review_center_page(db: Session):
    def draw():
        ReviewCenterPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Retención y Memoria")


@pytest.mark.asyncio
async def test_knowledge_graph_page(db: Session):
    def draw():
        KnowledgeGraphPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Grafo de Conocimiento")


@pytest.mark.asyncio
async def test_settings_page(db: Session):
    def draw():
        SettingsPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Ajustes del Sistema")


@pytest.mark.asyncio
async def test_about_page(db: Session):
    def draw():
        AboutPage().draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Acerca de DomestiK")


@pytest.mark.asyncio
async def test_course_detail_page_missing(db: Session):
    course_id = str(uuid.uuid4())
    def draw():
        CourseDetailPage(course_id).draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Biblioteca")


@pytest.mark.asyncio
async def test_book_detail_page_missing(db: Session):
    book_id = str(uuid.uuid4())
    def draw():
        BookDetailPage(book_id).draw()

    async with user_simulation(root=draw) as user:
        await user.open("/")
        await user.should_see("Biblioteca")
