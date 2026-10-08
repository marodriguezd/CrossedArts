from fastapi import APIRouter
from backend.app.api.resources import router as resources_router
from backend.app.api.courses import router as courses_router
from backend.app.api.books import router as books_router
from backend.app.api.notes import router as notes_router
from backend.app.api.sessions import router as sessions_router
from backend.app.api.dashboard import router as dashboard_router
from backend.app.api.media import router as media_router
from backend.app.api.search import router as search_router
from backend.app.api.semantic import router as semantic_router
from backend.app.api.ai import router as ai_router
from backend.app.api.workflow import router as workflow_router
from backend.app.api.knowledge import router as knowledge_router
from backend.app.api.ingestion import router as ingestion_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(resources_router)
api_router.include_router(courses_router)
api_router.include_router(books_router)
api_router.include_router(notes_router)
api_router.include_router(sessions_router)
api_router.include_router(dashboard_router)
api_router.include_router(media_router)
api_router.include_router(search_router)
api_router.include_router(semantic_router)
api_router.include_router(ai_router)
api_router.include_router(workflow_router)
api_router.include_router(knowledge_router)
api_router.include_router(ingestion_router)




