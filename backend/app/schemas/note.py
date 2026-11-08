import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator, model_validator
from backend.app.schemas.common import BaseResponse


class NoteResponse(BaseResponse):
    """Note response. `resource_id`/`lesson_id` may be null: a standalone note
    is a valid concept (same contract as the SQLite frontend). `title` mirrors
    `note.title NOT NULL` in the browser schema; `tags` is optional."""
    id: uuid.UUID
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    title: str
    content: str
    tags: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CreateNoteRequest(BaseModel):
    """Note creation. The resource is optional: a note can be born and stay
    standalone. When a lesson is given, its link is preserved. `title` is
    optional here only because the service derives it from the content when the
    caller does not provide one: the persisted note always has a real title."""
    resource_id: Optional[uuid.UUID] = None
    lesson_id: Optional[uuid.UUID] = None
    title: Optional[str] = Field(None, max_length=255)
    content: str = Field(..., min_length=1)
    tags: Optional[str] = None

    @field_validator("title")
    @classmethod
    def blank_title_means_derive(cls, value: Optional[str]) -> Optional[str]:
        """A blank title is the same as no title.

        The browser DAO treats a falsy title as "use the default", so sending
        `""` or whitespace must reach the same path: the service derives a real
        title from the content instead of storing an empty headline.
        """
        if value is None:
            return None
        return value.strip() or None


class UpdateNoteRequest(BaseModel):
    """Partial note update.

    Mirrors the frontend's `UPDATE ... SET title = COALESCE(?, title), content =
    COALESCE(?, content), tags = COALESCE(?, tags)`: a field that is not sent is
    left untouched. An empty string is a real value, so `tags=""` clears the
    tags; `title` can never become empty.
    """
    content: Optional[str] = Field(None, min_length=1)
    title: Optional[str] = Field(None, max_length=255)
    tags: Optional[str] = None

    @field_validator("title")
    @classmethod
    def title_cannot_be_blank(cls, value: Optional[str]) -> Optional[str]:
        """`title` can never become empty, not even with whitespace."""
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("El título no puede quedar vacío.")
        return stripped

    @model_validator(mode="after")
    def require_at_least_one_field(self) -> "UpdateNoteRequest":
        if self.content is None and self.title is None and self.tags is None:
            raise ValueError(
                "La actualización debe incluir al menos uno de content, title o tags."
            )
        return self
