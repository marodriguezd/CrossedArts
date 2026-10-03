"""
Embedding Service using LangChain.
Provides embedding generation with Mock, Ollama, and OpenAI providers.
"""
import hashlib
import json
import uuid
from typing import List, Optional
from sqlalchemy.orm import Session
from langchain_core.embeddings import Embeddings
from backend.app.core.settings import settings
from backend.app.models.content import EmbeddingRecord


class MockEmbeddingProvider(Embeddings):
    """Mock embedding provider for development/testing."""
    
    def __init__(self, dimension: int = 384):
        self.dimension = dimension
        self._model_name = "mock-minilm-l6-v2"
    
    @property
    def model_name(self) -> str:
        return self._model_name
    
    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return [self._hash_embed(t) for t in texts]
    
    def embed_query(self, text: str) -> List[float]:
        return self._hash_embed(text)
    
    def _hash_embed(self, text: str) -> List[float]:
        h = hashlib.md5(text.lower().strip().encode()).hexdigest()
        vec = [float(int(h[i:i+2], 16)) / 255.0 for i in range(0, min(len(h), self.dimension * 2), 2)]
        while len(vec) < self.dimension:
            vec.append(0.0)
        vec = vec[:self.dimension]
        norm = sum(x*x for x in vec) ** 0.5
        return [x/norm for x in vec] if norm > 0 else vec


class EmbeddingService:
    """Service for embedding operations using LangChain."""
    
    _embeddings: Optional[Embeddings] = None
    _initialized: bool = False

    @classmethod
    def initialize(cls) -> None:
        """Initialize the embedding provider based on settings."""
        if cls._initialized:
            return
            
        provider = settings.embedding_provider
        
        if provider == "openai" and settings.openai_api_key:
            try:
                from langchain_openai import OpenAIEmbeddings
                cls._embeddings = OpenAIEmbeddings(
                    model=settings.openai_embed_model,
                    api_key=settings.openai_api_key,
                    openai_api_base=settings.openai_api_base,
                )
            except ImportError:
                print("[CrossedArts] langchain-openai not installed. Using mock embeddings.")
                cls._embeddings = MockEmbeddingProvider()
        elif provider == "ollama":
            try:
                try:
                    from langchain_ollama import OllamaEmbeddings
                except ImportError:
                    from langchain_community.embeddings import OllamaEmbeddings
                base_url = settings.ollama_embed_url.replace("/api/embeddings", "")
                cls._embeddings = OllamaEmbeddings(
                    model=settings.ollama_embed_model,
                    base_url=base_url,
                )
            except ImportError:
                print("[CrossedArts] langchain-ollama/langchain-community not installed. Using mock embeddings.")
                cls._embeddings = MockEmbeddingProvider()
        elif provider == "huggingface":
            try:
                try:
                    from langchain_huggingface import HuggingFaceEmbeddings
                except ImportError:
                    from langchain_community.embeddings import HuggingFaceEmbeddings
                cls._embeddings = HuggingFaceEmbeddings(
                    model_name=settings.huggingface_embed_model,
                )
            except Exception as e:
                print(f"[CrossedArts] Error initializing HuggingFace embeddings: {e}. Using mock embeddings.")
                cls._embeddings = MockEmbeddingProvider()
        else:
            cls._embeddings = MockEmbeddingProvider()
            
        cls._initialized = True
        mode = provider if not isinstance(cls._embeddings, MockEmbeddingProvider) else "mock"
        print(f"[CrossedArts] Embedding Service initialized: {mode}")

    @classmethod
    def initialize_from_env(cls, client=None) -> None:
        """Initialize from environment settings (backward compatibility).
        
        The client parameter is ignored in LangChain implementation as LangChain
        manages its own HTTP clients.
        """
        cls.initialize()

    @classmethod
    def get_embeddings(cls, texts: List[str]) -> List[List[float]]:
        """Get embeddings for a list of texts."""
        if not cls._initialized:
            cls.initialize()
        return cls._embeddings.embed_documents(texts)

    @classmethod
    def get_embedding(cls, text: str) -> List[float]:
        """Get embedding for a single text."""
        if not cls._initialized:
            cls.initialize()
        return cls._embeddings.embed_query(text)

    @classmethod
    def compute_hash(cls, text: str) -> str:
        """Compute a hash of the text content for change detection."""
        return hashlib.sha256(text.strip().encode()).hexdigest()

    @classmethod
    def get_model_name(cls) -> str:
        """Get the name of the current embedding model."""
        if not cls._initialized:
            cls.initialize()
        if isinstance(cls._embeddings, MockEmbeddingProvider):
            return "mock-minilm-l6-v2"
        if settings.embedding_provider == "openai":
            return settings.openai_embed_model
        elif settings.embedding_provider == "huggingface":
            return settings.huggingface_embed_model
        return settings.ollama_embed_model

    @classmethod
    def index_entity(cls, db: Session, entity_id: uuid.UUID, entity_type: str, text: str, commit: bool = True) -> None:
        """Compute and store embedding for an entity if content has changed."""
        if not text or not text.strip():
            return

        clean_text = text.strip()
        text_hash = cls.compute_hash(clean_text)
        model = cls.get_model_name()

        existing = db.query(EmbeddingRecord).filter(
            EmbeddingRecord.entity_id == entity_id,
            EmbeddingRecord.entity_type == entity_type
        ).first()

        if existing and existing.hash_content == text_hash and existing.model == model:
            return

        try:
            vector = cls.get_embedding(clean_text)
            vector_json = json.dumps(vector)
        except Exception as e:
            print(f"[CrossedArts] Embedding error for {entity_type}:{entity_id}: {e}")
            return

        if existing:
            existing.vector = vector_json
            existing.model = model
            existing.hash_content = text_hash
        else:
            record = EmbeddingRecord(
                entity_id=entity_id,
                entity_type=entity_type,
                vector=vector_json,
                model=model,
                hash_content=text_hash,
            )
            db.add(record)

        if commit:
            db.commit()

    @classmethod
    def index_entities_batch(cls, db: Session, items: list, commit: bool = True) -> None:
        """Batch index multiple entities."""
        for entity_id, entity_type, text in items:
            cls.index_entity(db, entity_id, entity_type, text, commit=False)
        if commit:
            db.commit()

    @classmethod
    def index_all_unindexed(cls, db: Session) -> None:
        """Index all supported text entities missing for the ACTIVE embedding model."""
        from backend.app.models.activity import Note
        from backend.app.models.content import TranscriptSegment, ContentIndex

        model = cls.get_model_name()
        BATCH_SIZE = 50

        def index_missing(items, entity_type: str, text_getter) -> None:
            for i in range(0, len(items), BATCH_SIZE):
                for entity in items[i:i + BATCH_SIZE]:
                    try:
                        cls.index_entity(db, entity.id, entity_type, text_getter(entity), commit=False)
                    except Exception as e:
                        print(f"[CrossedArts] Error indexing {entity_type}:{entity.id}: {e}")
                db.commit()

        indexed_pairs = {
            (str(record.entity_id), record.entity_type)
            for record in db.query(EmbeddingRecord.entity_id, EmbeddingRecord.entity_type)
            .filter(EmbeddingRecord.model == model)
            .all()
        }

        notes = [n for n in db.query(Note).all() if (str(n.id), 'note') not in indexed_pairs]
        segments = [s for s in db.query(TranscriptSegment).all() if (str(s.id), 'transcript_segment') not in indexed_pairs]
        contents = [c for c in db.query(ContentIndex).all() if (str(c.id), 'content_index') not in indexed_pairs]

        index_missing(notes, 'note', lambda n: n.content)
        index_missing(segments, 'transcript_segment', lambda s: s.text)
        index_missing(contents, 'content_index', lambda item: item.content)



class CosineSimilarityCalculator:
    """Utility for computing cosine similarity between vectors."""

    @staticmethod
    def cosine_similarity(a: list, b: list) -> float:
        """Compute cosine similarity between two vectors."""
        if len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)
