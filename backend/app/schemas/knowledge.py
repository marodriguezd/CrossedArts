import uuid
from typing import Optional
from pydantic import BaseModel


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
