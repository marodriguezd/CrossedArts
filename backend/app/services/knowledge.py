from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional

class EmbeddingGenerator(ABC):
    """
    Interface para futuros generadores de embeddings vectoriales.
    Permitirá traducir textos (lecciones, páginas de libros) en vectores numéricos.
    """
    @abstractmethod
    async def generate_embedding(self, text: str) -> List[float]:
        """Genera un vector embedding de punto flotante para el texto provisto."""
        pass

    @abstractmethod
    async def generate_embeddings_batch(self, texts: List[str]) -> List[List[float]]:
        """Genera un lote de vectores embedding para optimizar latencia de red/procesamiento."""
        pass


class VectorStore(ABC):
    """
    Interface para bases de datos vectoriales (por ejemplo, Qdrant, ChromaDB, pgvector).
    Crucial para soportar las búsquedas semánticas del MVP en la Fase 3.
    """
    @abstractmethod
    async def add_vectors(self, ids: List[str], vectors: List[List[float]], payloads: List[Dict[str, Any]]) -> None:
        """Almacena vectores asociados a sus metadatos en la base de datos vectorial."""
        pass

    @abstractmethod
    async def query_similar(self, vector: List[float], limit: int = 5) -> List[Dict[str, Any]]:
        """Recupera los elementos más similares en distancia coseno u otra métrica."""
        pass

    @abstractmethod
    async def delete_vectors(self, ids: List[str]) -> None:
        """Remueve vectores de la base de datos."""
        pass


class SemanticSearchService(ABC):
    """
    Interface para buscar de forma semántica contenido relacionado a partir de lenguaje natural.
    """
    @abstractmethod
    async def search_resources(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Realiza una consulta utilizando embeddings y vector store."""
        pass

    @abstractmethod
    async def find_related_notes(self, note_id: str, limit: int = 5) -> List[Dict[str, Any]]:
        """Encuentra notas conceptualmente similares para construir grafos de conocimiento."""
        pass


class AITutorService(ABC):
    """
    Interface para tutores virtuales integrados en la UI que interactúan con el conocimiento extraído.
    """
    @abstractmethod
    async def ask_question(self, question: str, resource_id: str, context: Optional[str] = None) -> str:
        """Responde una duda del usuario basándose en el contexto del recurso (RAG)."""
        pass
