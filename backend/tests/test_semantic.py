import json
import pytest
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import select
from fastapi.testclient import TestClient

from backend.app.models.resource import Course
from backend.app.models.activity import Note
from backend.app.models.content import EmbeddingRecord
from backend.app.models.base import ResourceStatus
from backend.app.services.embedding import EmbeddingService, CosineSimilarityCalculator
from backend.app.services.semantic_search import SemanticSearchService


def test_cosine_similarity():
    # Vectores ortogonales
    v1 = [1.0, 0.0, 0.0]
    v2 = [0.0, 1.0, 0.0]
    assert CosineSimilarityCalculator.cosine_similarity(v1, v2) == 0.0

    # Vectores idénticos
    v3 = [1.0, 2.0, 3.0]
    assert pytest.approx(CosineSimilarityCalculator.cosine_similarity(v3, v3)) == 1.0

    # Vectores opuestos
    v4 = [-1.0, -2.0, -3.0]
    assert pytest.approx(CosineSimilarityCalculator.cosine_similarity(v3, v4)) == -1.0


def test_embedding_generation_and_caching(db: Session):
    note_id = uuid.uuid4()
    content = "Aprender Rust y WebAssembly para construir widgets rápidos."
    
    # 1. Generar e indexar
    EmbeddingService.index_entity(db, note_id, "note", content)

    record = db.scalars(select(EmbeddingRecord).where(
        EmbeddingRecord.entity_id == note_id,
        EmbeddingRecord.entity_type == "note"
    )).first()

    assert record is not None
    assert record.model == "mock-minilm-l6-v2"
    assert record.hash_content == EmbeddingService.compute_hash(content)
    assert len(json.loads(record.vector)) == 384

    # 2. Intentar indexar de nuevo con idéntico contenido (debe usar caché)
    created_at_before = record.created_at
    EmbeddingService.index_entity(db, note_id, "note", content)
    
    db.refresh(record)
    assert record.created_at == created_at_before


def test_semantic_search_retrieval(db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Rust", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    
    note_rust = Note(id=uuid.uuid4(), resource_id=course.id, content="Programación concurrente y segura con el lenguaje de programación Rust.")
    note_unrelated = Note(id=uuid.uuid4(), resource_id=course.id, content="Aprender técnicas de cocina al vacío en casa.")
    
    db.add(note_rust)
    db.add(note_unrelated)
    db.commit()

    # Indexar embeddings
    EmbeddingService.index_entity(db, note_rust.id, "note", note_rust.content)
    EmbeddingService.index_entity(db, note_unrelated.id, "note", note_unrelated.content)

    # Buscar "programación de software"
    results = SemanticSearchService.search(db, "programación de software")
    
    # Debe clasificar más alto a Rust
    assert len(results) > 0
    assert results[0]["resource_id"] == course.id
    assert results[0]["match_type"] == "note"


def test_semantic_related_resources(db: Session):
    course1 = Course(id=uuid.uuid4(), title="Aprender Rust Avanzado", status=ResourceStatus.NOT_STARTED)
    course2 = Course(id=uuid.uuid4(), title="Desarrollo de Sistemas Seguros", status=ResourceStatus.NOT_STARTED)
    course3 = Course(id=uuid.uuid4(), title="Curso de Repostería Creativa", status=ResourceStatus.NOT_STARTED)

    db.add(course1)
    db.add(course2)
    db.add(course3)
    db.commit()

    # Agregar notas que simulen contenido conceptual
    note1 = Note(id=uuid.uuid4(), resource_id=course1.id, content="Seguridad de memoria, compilador y punteros inteligentes en Rust.")
    note2 = Note(id=uuid.uuid4(), resource_id=course2.id, content="Desarrollo seguro, mitigar exploits de memoria con Rust y compiladores modernos.")
    note3 = Note(id=uuid.uuid4(), resource_id=course3.id, content="Decoración de pasteles de boda con fondant y glaseado real.")

    db.add(note1)
    db.add(note2)
    db.add(note3)
    db.commit()

    # Indexar
    EmbeddingService.index_entity(db, note1.id, "note", note1.content)
    EmbeddingService.index_entity(db, note2.id, "note", note2.content)
    EmbeddingService.index_entity(db, note3.id, "note", note3.content)

    # Obtener relacionados de course1 (Rust Avanzado)
    related = SemanticSearchService.get_related_resources(db, course1.id)

    assert len(related) > 0
    # El primer relacionado debe ser Sistemas Seguros, no Repostería
    assert related[0]["id"] == course2.id
    assert related[0]["type"] == "course"


def test_semantic_api_endpoints(client: TestClient, db: Session):
    course = Course(id=uuid.uuid4(), title="Curso Fotografia", status=ResourceStatus.NOT_STARTED)
    db.add(course)
    
    note = Note(id=uuid.uuid4(), resource_id=course.id, content="Exposición y balance de blancos en cámaras réflex.")
    db.add(note)
    db.commit()

    EmbeddingService.index_entity(db, note.id, "note", note.content)

    # GET /api/v1/semantic/search
    response = client.get("/api/v1/semantic/search?q=cámaras")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 1
    assert data[0]["resource_title"] == "Curso Fotografia"

    # GET /api/v1/resources/{id}/related
    response_rel = client.get(f"/api/v1/resources/{course.id}/related")
    assert response_rel.status_code == 200
    assert isinstance(response_rel.json(), list)
