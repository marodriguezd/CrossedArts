import uuid
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from backend.app.models.resource import Course, Book, MediaAsset
from backend.app.models.activity import LearningSession
from backend.app.models.content import ContentIndex
from backend.app.models.base import ResourceStatus
from backend.app.services.llm import PromptTemplateRegistry
from backend.app.services.context import ContextRetrievalService
from backend.app.services.insights import LearningInsightsService
from backend.app.services.embedding import EmbeddingService


def test_prompt_template_registry():
    prompt = PromptTemplateRegistry.get_prompt("tutor_chat", context="Rust compiler features", question="What are smart pointers?")
    assert "Rust compiler features" in prompt["user"]
    assert "smart pointers" in prompt["user"]
    assert "tutor académico" in prompt["system"]


def test_context_retrieval(db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Rust", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    asset = MediaAsset(id=uuid.uuid4(), resource_id=course.id, media_type="video", file_path="/dummy/video.mp4", file_name="video.mp4", mime_type="video/mp4")
    db.add(asset)
    db.commit()

    idx = ContentIndex(id=uuid.uuid4(), media_asset_id=asset.id, section_identifier="page_1", content="Rust language has zero cost abstractions and safety.")
    db.add(idx)
    db.commit()

    # Indexar embedding
    EmbeddingService.index_entity(db, idx.id, "content_index", idx.content)

    # Recuperar contexto
    context = ContextRetrievalService.get_context_for_resource(db, course.id, "Rust language safety")
    assert "zero cost abstractions" in context


def test_learning_insights(db: Session):
    # Crear un curso e iniciar sesión para simular actividad
    course = Course(id=uuid.uuid4(), title="Aprender Swift", category="Desarrollo Mobile", status=ResourceStatus.IN_PROGRESS)
    db.add(course)
    db.commit()

    from backend.app.core.utils import utc_now_naive
    session = LearningSession(id=uuid.uuid4(), resource_id=course.id, started_at=utc_now_naive(), duration_minutes=10)
    db.add(session)
    db.commit()


    # Generar reportes
    insights = LearningInsightsService.generate_insights(db)
    assert len(insights["top_categories"]) > 0
    assert insights["top_categories"][0]["category"] == "Desarrollo Mobile"
    assert insights["recent_weekly_study_minutes"] == 10


def test_ai_api_tutor(client: TestClient, db: Session):
    course = Course(id=uuid.uuid4(), title="Conceptos Docker", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    # Preguntar al tutor via API
    response = client.post("/api/v1/ai/tutor", json={
        "resource_id": str(course.id),
        "question": "¿Qué son los contenedores?"
    })
    assert response.status_code == 200
    assert "Tutor" in response.json()["answer"]


def test_ai_api_quiz_generation(client: TestClient, db: Session):
    course = Course(id=uuid.uuid4(), title="Conceptos K8s", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    db.commit()

    # Generar cuestionario via API
    response = client.post("/api/v1/ai/quiz", json={
        "resource_id": str(course.id),
        "title": "Evaluacion K8s"
    })
    assert response.status_code == 200
    data = response.json()
    assert data["title"] == "Evaluacion K8s"
    assert len(data["questions"]) > 0

    # Obtener cuestionarios guardados
    response_list = client.get(f"/api/v1/ai/quizzes/{course.id}")
    assert response_list.status_code == 200
    assert len(response_list.json()) == 1

def test_concept_mastery_and_gaps_insights(db: Session):
    from backend.app.services.note import NoteService
    
    # 1. Crear concepto y nota para activar el parser
    book = Book(id=uuid.uuid4(), title="Fotografía Básica")
    db.add(book)
    db.commit()
    
    note = NoteService.create_note(db, book.id, "Estudiando la regla de los tercios en #composición.")
    
    # 2. Generar insights
    insights = LearningInsightsService.generate_insights(db)
    
    assert "concept_mastery" in insights
    assert "knowledge_gaps" in insights
    assert "detailed_recommendations" in insights
    
    # Debe clasificar como "never_reviewed" porque hay nota pero no repaso
    gaps = insights["knowledge_gaps"]
    assert len(gaps["never_reviewed"]) > 0
    assert gaps["never_reviewed"][0]["name"] == "composición"

