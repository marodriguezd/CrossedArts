import uuid
from typing import Optional
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.app.core.database import get_db
from backend.app.services.knowledge_service import KnowledgeService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/knowledge", tags=["Knowledge Graph"])

class ConceptCreatePayload(BaseModel):
    name: str
    description: Optional[str] = None

class ConnectionCreatePayload(BaseModel):
    source_id: uuid.UUID
    source_type: str
    target_id: uuid.UUID
    target_type: str
    connection_type: str = "related_to"
    weight: float = 1.0

@router.get("/concepts")
def list_concepts(db: Session = Depends(get_db)):
    """Retorna la lista de conceptos existentes."""
    return KnowledgeService.list_concepts(db)

@router.post("/concepts", status_code=status.HTTP_201_CREATED)
def create_concept(payload: ConceptCreatePayload, db: Session = Depends(get_db)):
    """Crea un nuevo concepto."""
    return KnowledgeService.create_concept(db, payload.name, payload.description)

@router.delete("/concepts/{concept_id}")
def delete_concept(concept_id: uuid.UUID, db: Session = Depends(get_db)):
    """Elimina un concepto y sus relaciones asociadas."""
    success = KnowledgeService.delete_concept(db, concept_id)
    if not success:
        raise get_http_exception("CONCEPT_NOT_FOUND", "El concepto no existe.")
    return {"status": "success", "message": "Concepto eliminado."}

@router.post("/connections", status_code=status.HTTP_201_CREATED)
def create_connection(payload: ConnectionCreatePayload, db: Session = Depends(get_db)):
    """Establece una nueva arista/relación semántica."""
    return KnowledgeService.create_connection(
        db,
        source_id=payload.source_id,
        source_type=payload.source_type,
        target_id=payload.target_id,
        target_type=payload.target_type,
        connection_type=payload.connection_type,
        weight=payload.weight
    )

@router.get("/graph")
def get_graph(db: Session = Depends(get_db)):
    """Retorna el grafo de conocimiento completo (nodos y aristas)."""
    return KnowledgeService.get_knowledge_graph(db)

@router.get("/related/{entity_type}/{entity_id}")
def get_related(entity_type: str, entity_id: uuid.UUID, db: Session = Depends(get_db)):
    """Retorna todas las conexiones directas de una entidad."""
    return KnowledgeService.get_related_entities(db, entity_id, entity_type)
