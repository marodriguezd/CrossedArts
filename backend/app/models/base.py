import enum
from datetime import datetime
from sqlalchemy import DateTime, func
from sqlalchemy.orm import Mapped, mapped_column

class ResourceStatus(str, enum.Enum):
    NOT_STARTED = "NOT_STARTED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"

class CourseDifficulty(str, enum.Enum):
    BEGINNER = "BEGINNER"
    INTERMEDIATE = "INTERMEDIATE"
    ADVANCED = "ADVANCED"

class LessonType(str, enum.Enum):
    VIDEO = "VIDEO"
    PDF = "PDF"
    EPUB = "EPUB"
    ARTICLE = "ARTICLE"
    PROJECT = "PROJECT"

class TimestampMixin:
    """Mixin para inyectar automáticamente marcas de tiempo de auditoría."""
    created_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=func.now(), 
        server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, 
        default=func.now(), 
        onupdate=func.now(),
        server_default=func.now()
    )
