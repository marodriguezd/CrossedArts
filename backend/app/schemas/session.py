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
    #: Canonical explicit session scope: `lesson`, `resource`, or `global`
    #: (cross-cutting review without anchors).
    scope: str = "global"
    started_at: datetime
    ended_at: Optional[datetime] = None
    #: `True` once the session is formally finalized (see idempotent
    #: `SessionService.end_session`).
    finalized: bool = False
    duration_minutes: int


class StartSessionRequest(BaseModel):
    """
    Study-session start request.

    Domain contract (mirrors the frontend SQLite WASM): the session is scoped to
    a LESSON, a RESOURCE, or is GLOBAL (cross-library review). Scope derives
    from anchors and may be declared explicitly to remove ambiguity; a declared
    scope inconsistent with the anchors is a validation error, never a silently
    reinterpreted row.
    """
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    scope: Optional[str] = None

    @model_validator(mode="after")
    def validate_scope(self) -> "StartSessionRequest":
        derived = resolve_session_scope(self.resource_id, self.lesson_id)
        if self.scope is None:
            # Scope derives from anchors: no anchor is required because global
            # review is a legitimate first-class scope.
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
