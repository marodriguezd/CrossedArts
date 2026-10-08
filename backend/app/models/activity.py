import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import CheckConstraint, ForeignKey, String, Integer, DateTime, Boolean, Float, event
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.app.core.database import Base, GUID
from backend.app.core.utils import utc_now_naive
from backend.app.models.base import TimestampMixin

#: Ámbitos canónicos de una sesión de estudio. Coinciden con los del frontend
#: (SQLite WASM): `frontend/src/services/sessionScope.ts`. Regla de dominio
#: ÚNICA, compartida por ambas capas.
SESSION_SCOPES = ("global", "resource", "lesson")


def resolve_session_scope(
    resource_id: Optional[uuid.UUID] = None,
    lesson_id: Optional[uuid.UUID] = None,
) -> str:
    """
    Deriva el ámbito de una sesión a partir de sus anclas presentes.

    - `lesson`   -> la sesión se inició en una lección (el recurso es opcional).
    - `resource` -> la sesión se inició en un recurso y no en una lección.
    - `global`   -> repaso transversal de la biblioteca: NINGUNA ancla.

    El ámbito es explícito y de primera clase: una sesión global no es una
    sesión "sin ámbito", y ninguna sesión puede declararse `global` llevando
    anclas. Nunca se infiere de la ausencia de datos: se deriva de las anclas.
    """
    if lesson_id is not None:
        return "lesson"
    if resource_id is not None:
        return "resource"
    return "global"


class LearningSession(Base):
    __tablename__ = "learning_session"

    # Contrato de dominio (idéntico al del frontend SQLite WASM): una sesión
    # está acotada a una LECCIÓN, a un RECURSO o es GLOBAL (repaso transversal
    # sin anclas). El ámbito se persiste explícitamente en `scope`.
    #
    # La base solo garantiza el dominio de valores y que un ámbito `global`
    # nunca lleve ancla, porque `ON DELETE SET NULL` puede desvincular la
    # lección de una sesión de lección YA FINALIZADA: el historial se conserva
    # y el ámbito efectivo se vuelve a derivar de las anclas al leerlo.
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
    # El ámbito lo deriva `before_insert`/`before_update` de las anclas reales
    # (ver abajo): no hay un `default` de Python que pueda ver otras columnas.
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
    #: Finalización FORMAL de la sesión. `ended_at` también lo toca el latido
    #: (heartbeat) como marca de última actividad, así que la idempotencia de
    #: `SessionService.end_session` se apoya en esta marca explícita: repetir
    #: la finalización no reescribe la duración ni vuelve a aplicar las metas.
    finalized: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    inactive_seconds: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relaciones
    resource: Mapped[Optional["LearningResource"]] = relationship("LearningResource", back_populates="sessions")
    lesson: Mapped[Optional["Lesson"]] = relationship("Lesson")


@event.listens_for(LearningSession, "before_insert", propagate=True)
@event.listens_for(LearningSession, "before_update", propagate=True)
def _derive_session_scope(mapper, connection, target: "LearningSession") -> None:
    """Mantiene `scope` coherente con las anclas reales de la fila.

    Derivar el ámbito en el propio modelo evita depender de que cada llamante
    recuerde escribirlo, y garantiza que un ámbito global jamás declare anclas.
    """
    if target.scope not in SESSION_SCOPES or (
        target.scope == "global" and (target.resource_id is not None or target.lesson_id is not None)
    ) or (target.scope == "resource" and target.resource_id is None):
        target.scope = resolve_session_scope(target.resource_id, target.lesson_id)


class Note(Base, TimestampMixin):
    """
    Anotación del usuario.

    CONTRATO DE DOMINIO (idéntico al del frontend SQLite WASM): una nota puede
    ser AUTÓNOMA, estar vinculada a un recurso o a una lección. `resource_id` es
    nullable porque la nota autónoma es un concepto de primera clase
    (`note.resource_id IS NULL` en el esquema del navegador), no un dato
    inválido. No se crean recursos de relleno para "arreglar" el vínculo.

    Al borrar un recurso o una lección la nota NO se destruye: se desvincula
    (`ON DELETE SET NULL`), igual que en el frontend. El trabajo del usuario
    sobrevive siempre a la reorganización de su biblioteca.
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

    # Relaciones
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
    last_position: Mapped[float] = mapped_column(Float, default=0.0) # Segundos o número de página
    duration: Mapped[float] = mapped_column(Float, default=0.0)      # Segundos o páginas totales
    is_watched: Mapped[bool] = mapped_column(Boolean, default=False)

    # Relaciones
    media_asset: Mapped["MediaAsset"] = relationship("MediaAsset", back_populates="progress")
