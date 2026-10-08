import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, model_validator
from backend.app.schemas.common import BaseResponse
from backend.app.models.activity import resolve_session_scope


class LearningSessionResponse(BaseResponse):
    id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    #: Ámbito canónico y explícito de la sesión: `lesson`, `resource` o
    #: `global` (repaso transversal sin anclas).
    scope: str = "global"
    started_at: datetime
    ended_at: Optional[datetime] = None
    #: `True` cuando la sesión ya fue finalizada formalmente (ver
    #: `SessionService.end_session`, idempotente).
    finalized: bool = False
    duration_minutes: int


class StartSessionRequest(BaseModel):
    """
    Solicitud de inicio de sesión de estudio.

    Contrato de dominio (idéntico al del frontend SQLite WASM): la sesión queda
    acotada a una LECCIÓN, a un RECURSO o es GLOBAL (repaso transversal de la
    biblioteca). El ámbito se deriva de las anclas y puede declararse
    explícitamente para dejar de ser ambiguo; un ámbito declarado que no sea
    coherente con las anclas es un error de validación, nunca una fila
    reinterpretada en silencio.
    """
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    scope: Optional[str] = None

    @model_validator(mode="after")
    def validate_scope(self) -> "StartSessionRequest":
        derived = resolve_session_scope(self.resource_id, self.lesson_id)
        if self.scope is None:
            # El ámbito se deriva de las anclas: no se exige ningún ancla porque
            # el repaso global es un ámbito legítimo de primera clase.
            object.__setattr__(self, "scope", derived)
            return self

        if self.scope not in ("global", "resource", "lesson"):
            raise ValueError(
                "Ámbito de sesión inválido: debe ser 'lesson', 'resource' o 'global'."
            )

        if self.scope == "global" and (self.resource_id is not None or self.lesson_id is not None):
            raise ValueError(
                "Una sesión global no puede tener recurso ni lección: "
                "declara el ámbito 'resource' o 'lesson'."
            )

        if self.scope == "resource" and self.resource_id is None:
            raise ValueError("Una sesión de recurso necesita un resource_id.")

        if self.scope == "resource" and self.lesson_id is not None:
            raise ValueError(
                "Una sesión de recurso no puede tener lección: declara el ámbito 'lesson'."
            )

        if self.scope == "lesson" and self.lesson_id is None:
            raise ValueError("Una sesión de lección necesita un lesson_id.")

        return self
