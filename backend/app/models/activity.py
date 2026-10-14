import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import CheckConstraint, ForeignKey, String, Integer, DateTime, Boolean, Float, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive
from backend.app.models.base import TimestampMixin

#: Canonical study-session scopes. Match the frontend (SQLite WASM):
#: `frontend/src/services/sessionScope.ts`. SINGLE domain rule shared by both layers.
SESSION_SCOPES = ("global", "resource", "lesson")


def resolve_session_scope(
    resource_id: Optional[uuid.UUID] = None,
    lesson_id: Optional[uuid.UUID] = None,
) -> str:
    """
    Derive a session's scope from its present anchors.

    - `lesson`   -> session started on a lesson (resource optional).
    - `resource` -> session started on a resource, not on a lesson.
    - `global`   -> cross-library review: NO anchors.

    Scope is explicit and first-class: a global session is not a session
    "without scope", and no session may declare `global` while carrying
    anchors. Never inferred from missing data: always derived from anchors.
    """
    if lesson_id is not None:
        return "lesson"
    if resource_id is not None:
        return "resource"
    return "global"


class LearningSession(Base):
    __tablename__ = "learning_session"

    # Domain contract (mirrors the frontend SQLite WASM): a session is scoped to
    # a LESSON, a RESOURCE, or is GLOBAL (cross-cutting review without anchors).
    # Scope is persisted explicitly in `scope`.
    #
    # The DB only enforces the value domain and that a `global` scope never
    # carries an anchor, because `ON DELETE SET NULL` can unlink the lesson of
    # an ALREADY-FINALIZED lesson session: history is preserved and the effective
    # scope is re-derived from anchors on read.
    __table_args__ = (
        CheckConstraint(
            "scope IN ('global', 'resource', 'lesson')",
            name="ck_learning_session_scope_values",
        ),
        CheckConstraint(
            "scope <> 'global' OR (resource_id IS NULL AND lesson_id IS NULL)",
            name="ck_learning_session_scope",
        ),
        CheckConstraint(
            "scope <> 'resource' OR resource_id IS NOT NULL",
            name="ck_learning_session_resource_scope",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    lesson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("lesson.id", ondelete="CASCADE"),
        nullable=True,
        index=True
    )
    # Scope is derived by `before_insert`/`before_update` from the real anchors
    # (see below): no Python `default` can see sibling columns.
    scope: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
        server_default="global",
    )
    mode: Mapped[str] = mapped_column(String(20), default="flashcards", nullable=False)
    started_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=utc_now_naive,
        nullable=False
    )
    ended_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    #: FORMAL session finalization. `ended_at` is also touched by the heartbeat
    #: as a last-activity stamp, so `SessionService.end_session` idempotency
    #: relies on this explicit flag: repeating finalization neither rewrites
    #: duration nor re-applies goals.
    finalized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inactive_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource", back_populates="sessions")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson")


@event.listens_for(LearningSession, "before_insert", propagate=True)
@event.listens_for(LearningSession, "before_update", propagate=True)
def _derive_session_scope(mapper, connection, target: "LearningSession") -> None:
    """Keep `scope` consistent with the row's real anchors.

    Deriving scope in the model itself avoids relying on every caller
    remembering to write it, and guarantees a global scope never declares anchors.
    """
    if target.scope not in SESSION_SCOPES or (
        target.scope == "global" and (target.resource_id is not None or target.lesson_id is not None)
    ) or (target.scope == "resource" and target.resource_id is None):
        target.scope = resolve_session_scope(target.resource_id, target.lesson_id)


class Note(Base, TimestampMixin):
    """
    User note.

    DOMAIN CONTRACT (mirrors the frontend SQLite WASM): a note can be
    STANDALONE, linked to a resource, or to a lesson. `resource_id` is nullable
    because a standalone note is a first-class concept (`note.resource_id IS
    NULL` in the browser schema), not invalid data. No placeholder resources
    are created to "fix" the link.

    Deleting a resource or lesson never destroys the note: it unlinks it
    (`ON DELETE SET NULL`), same as the frontend. User work always survives
    library reorganization.
    """

    __tablename__ = "note"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    resource_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("learning_resource.id", ondelete="SET NULL"),
        nullable=True
    )
    lesson_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        GUID,
        ForeignKey("lesson.id", ondelete="SET NULL"),
        nullable=True
    )
    content: Mapped[str] = mapped_column(String(5000), nullable=False)

    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource", back_populates="notes")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson", back_populates="notes")


class MediaProgress(Base, TimestampMixin):
    __tablename__ = "media_progress"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    media_asset_id: Mapped[uuid.UUID] = mapped_column(
        GUID,
        ForeignKey("media_asset.id", ondelete="CASCADE"),
        nullable=False,
        unique=True
    )
    last_position: Mapped[float] = mapped_column(Float, default=0.0)  # Seconds or page number
    duration: Mapped[float] = mapped_column(Float, default=0.0)  # Seconds or total pages
    is_watched: Mapped[bool] = mapped_column(Boolean, default=False)

    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset", back_populates="progress")
