import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, model_validator
from backend.app.schemas.common import BaseResponse

class LearningSessionResponse(BaseResponse):
    id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    started_at: datetime
    ended_at: Optional[datetime] = None
    duration_minutes: int

class StartSessionRequest(BaseModel):
    """
    Solicitud de inicio de sesión de estudio.

    Contrato de dominio: la sesión debe quedar acotada a un recurso, a una
    lección o a ambos. Nunca existe una sesión sin ámbito.
    """
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None

    @model_validator(mode="after")
    def require_scope(self) -> "StartSessionRequest":
        if self.resource_id is None and self.lesson_id is None:
            raise ValueError(
                "La sesión de estudio debe estar acotada a un recurso o a una lección."
            )
        return self
