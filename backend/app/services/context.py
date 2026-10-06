import uuid
from sqlalchemy.orm import Session
from backend.app.services.semantic_search import SemanticSearchService

class ContextRetrievalService:
    @staticmethod
    def get_context_for_resource(db: Session, resource_id: uuid.UUID, query: str, limit: int = 5) -> str:
        """
        Recupera y formatea fragmentos relevantes indexados (páginas, transcripciones, notas)
        asociados a un recurso de aprendizaje específico, sirviendo como grounding para el LLM.
        """
        # Realizar búsqueda semántica filtrando por el recurso a nivel de BD
        resource_matches = SemanticSearchService.search(db, query=query, limit=limit, resource_id=resource_id)
        
        if not resource_matches:
            return "No se encontró contexto local específico en la base de conocimientos para este recurso."

        context_packages = []
        for idx, m in enumerate(resource_matches, start=1):
            context_packages.append(
                f"[Fragmento {idx}] (Origen: {m['match_type'].upper()} - {m['match_reason']})\n"
                f"{m['snippet']}"
            )
            
        return "\n\n---\n\n".join(context_packages)
