import json
import uuid
from sqlalchemy.orm import Session


def test_mock_embedding_dimension():
    from backend.app.services.embedding import MockEmbeddingProvider
    provider = MockEmbeddingProvider(dimension=384)
    vec = provider.embed_query("test text")
    assert len(vec) == 384


def test_mock_embedding_normalized():
    from backend.app.services.embedding import MockEmbeddingProvider
    provider = MockEmbeddingProvider(dimension=384)
    vec = provider.embed_query("test text")
    norm = sum(x*x for x in vec) ** 0.5
    assert abs(norm - 1.0) < 1e-6


def test_mock_embedding_deterministic():
    from backend.app.services.embedding import MockEmbeddingProvider
    provider = MockEmbeddingProvider(dimension=384)
    v1 = provider.embed_query("hello world")
    v2 = provider.embed_query("hello world")
    assert v1 == v2


def test_mock_embedding_batch():
    from backend.app.services.embedding import MockEmbeddingProvider
    provider = MockEmbeddingProvider(dimension=384)
    texts = ["hello", "world", "test"]
    vectors = provider.embed_documents(texts)
    assert len(vectors) == 3
    for v in vectors:
        assert len(v) == 384


def test_embedding_service_get_embedding():
    from backend.app.services.embedding import EmbeddingService
    EmbeddingService._initialized = False
    EmbeddingService._embeddings = None
    vec = EmbeddingService.get_embedding("test query")
    assert len(vec) == 384


def test_embedding_service_get_embeddings_batch():
    from backend.app.services.embedding import EmbeddingService
    EmbeddingService._initialized = False
    EmbeddingService._embeddings = None
    vectors = EmbeddingService.get_embeddings(["text1", "text2", "text3"])
    assert len(vectors) == 3
    for v in vectors:
        assert len(v) == 384


def test_embedding_service_compute_hash():
    from backend.app.services.embedding import EmbeddingService
    h1 = EmbeddingService.compute_hash("  hello  ")
    h2 = EmbeddingService.compute_hash("hello")
    assert h1 == h2  # strip is applied

    h3 = EmbeddingService.compute_hash("hello")
    h4 = EmbeddingService.compute_hash("world")
    assert h3 != h4


def test_embedding_service_model_name():
    from backend.app.services.embedding import EmbeddingService
    EmbeddingService._initialized = False
    EmbeddingService._embeddings = None
    name = EmbeddingService.get_model_name()
    assert name == "mock-minilm-l6-v2"


def test_embedding_service_index_entity_creates_record(db: Session):
    from backend.app.services.embedding import EmbeddingService
    from sqlalchemy import select
    from backend.app.models.content import EmbeddingRecord

    entity_id = uuid.uuid4()
    text = "Aprender programación en Python es divertido."

    EmbeddingService.index_entity(db, entity_id, "note", text)

    record = db.scalars(select(EmbeddingRecord).where(
        EmbeddingRecord.entity_id == entity_id,
        EmbeddingRecord.entity_type == "note"
    )).first()

    assert record is not None
    assert record.model == "mock-minilm-l6-v2"
    assert record.hash_content == EmbeddingService.compute_hash(text)
    vector = json.loads(record.vector)
    assert len(vector) == 384


def test_embedding_service_index_entity_caching(db: Session):
    from backend.app.services.embedding import EmbeddingService
    from sqlalchemy import select
    from backend.app.models.content import EmbeddingRecord

    entity_id = uuid.uuid4()
    text = "Contenido para caching de embeddings."

    EmbeddingService.index_entity(db, entity_id, "note", text)
    record1 = db.scalars(select(EmbeddingRecord).where(
        EmbeddingRecord.entity_id == entity_id
    )).first()
    ts1 = record1.created_at

    # Re-index same content — should use cache
    EmbeddingService.index_entity(db, entity_id, "note", text)
    db.refresh(record1)
    assert record1.created_at == ts1  # Not updated


def test_embedding_service_index_entity_updates_on_change(db: Session):
    from backend.app.services.embedding import EmbeddingService
    from sqlalchemy import select
    from backend.app.models.content import EmbeddingRecord

    entity_id = uuid.uuid4()

    EmbeddingService.index_entity(db, entity_id, "note", "Original content")
    record = db.scalars(select(EmbeddingRecord).where(
        EmbeddingRecord.entity_id == entity_id
    )).first()
    old_hash = record.hash_content

    # Update with different content
    EmbeddingService.index_entity(db, entity_id, "note", "Updated content")
    db.refresh(record)
    assert record.hash_content != old_hash


def test_embedding_service_index_entity_empty_text(db: Session):
    from backend.app.services.embedding import EmbeddingService
    from sqlalchemy import select
    from backend.app.models.content import EmbeddingRecord

    entity_id = uuid.uuid4()
    EmbeddingService.index_entity(db, entity_id, "note", "")
    EmbeddingService.index_entity(db, entity_id, "note", "   ")

    count = db.query(EmbeddingRecord).filter(EmbeddingRecord.entity_id == entity_id).count()
    assert count == 0


def test_cosine_similarity_identical():
    from backend.app.services.embedding import CosineSimilarityCalculator
    v = [1.0, 2.0, 3.0]
    assert abs(CosineSimilarityCalculator.cosine_similarity(v, v) - 1.0) < 1e-6


def test_cosine_similarity_orthogonal():
    from backend.app.services.embedding import CosineSimilarityCalculator
    assert CosineSimilarityCalculator.cosine_similarity([1, 0, 0], [0, 1, 0]) == 0.0


def test_cosine_similarity_different_lengths():
    from backend.app.services.embedding import CosineSimilarityCalculator
    assert CosineSimilarityCalculator.cosine_similarity([1, 2], [1, 2, 3]) == 0.0


def test_huggingface_embedding_provider():
    from backend.app.core.settings import settings
    from backend.app.services.embedding import EmbeddingService
    
    orig_provider = settings.embedding_provider
    orig_model = settings.huggingface_embed_model
    
    try:
        settings.embedding_provider = "huggingface"
        settings.huggingface_embed_model = "sentence-transformers/all-MiniLM-L6-v2"
        
        EmbeddingService._initialized = False
        EmbeddingService._embeddings = None
        
        EmbeddingService.initialize()
        
        vec = EmbeddingService.get_embedding("hello world")
        assert len(vec) == 384
        assert EmbeddingService.get_model_name() == "sentence-transformers/all-MiniLM-L6-v2"
        
    finally:
        settings.embedding_provider = orig_provider
        settings.huggingface_embed_model = orig_model
        EmbeddingService._initialized = False
        EmbeddingService._embeddings = None

