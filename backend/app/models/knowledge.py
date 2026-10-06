import uuid
from datetime import datetime
from typing import Optional
from sqlalchemy import String, Float
from sqlalchemy.orm import Mapped, mapped_column

from backend.app.core.database import Base, GUID
from backend.app.models.base import TimestampMixin

class Concept(Base, TimestampMixin):
    __tablename__ = "concept"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

class KnowledgeConnection(Base, TimestampMixin):
    __tablename__ = "knowledge_connection"

    id: Mapped[uuid.UUID] = mapped_column(GUID, primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True) # "concept", "note", "resource", "lesson"
    target_id: Mapped[uuid.UUID] = mapped_column(GUID, nullable=False, index=True)
    target_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True) # "concept", "note", "resource", "lesson"
    connection_type: Mapped[str] = mapped_column(String(100), default="related_to", nullable=False) # "references", "contains", "related_to", "requires", "tags"
    weight: Mapped[float] = mapped_column(Float, default=1.0, nullable=False)
