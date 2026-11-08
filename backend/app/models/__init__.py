from backend.app.models.base import ResourceStatus, CourseDifficulty, LessonType
from backend.app.models.resource import LearningResource, Course, Book, MediaAsset
from backend.app.models.course_structure import Module, Lesson, Task
from backend.app.models.activity import LearningSession, Note, MediaProgress
from backend.app.models.content import ExtractedMetadata, Transcript, TranscriptSegment, ContentIndex, EmbeddingRecord, Quiz
from backend.app.models.workflow import (
    LearningPath, LearningPathItem, StudyPlan, Goal, GoalProgress,
    LearningHabit, HabitRecord, ReviewItem, ReviewHistory
)
from backend.app.models.knowledge import Concept, KnowledgeConnection

__all__ = [
    "ResourceStatus",
    "CourseDifficulty",
    "LessonType",
    "LearningResource",
    "Course",
    "Book",
    "Module",
    "Lesson",
    "Task",
    "LearningSession",
    "Note",
    "MediaAsset",
    "MediaProgress",
    "ExtractedMetadata",
    "Transcript",
    "TranscriptSegment",
    "ContentIndex",
    "EmbeddingRecord",
    "Quiz",
    "LearningPath",
    "LearningPathItem",
    "StudyPlan",
    "Goal",
    "GoalProgress",
    "LearningHabit",
    "HabitRecord",
    "ReviewItem",
    "ReviewHistory",
    "Concept",
    "KnowledgeConnection",
]

from typing import Any
from sqlalchemy import event, or_, and_

#: Mapping from model class to its polymorphic entity type for cleanup.
POLYMORPHIC_MODEL_TO_ENTITY: dict[type, str] = {
    Note: "note",
    TranscriptSegment: "transcript_segment",
    ContentIndex: "content_index",
    Lesson: "lesson",
    MediaAsset: "media_asset",
    Concept: "concept",
    LearningResource: "resource",
    Course: "resource",
    Book: "resource",
}

POLYMORPHIC_ENTITY_NAME_MAP: dict[str, str] = {
    cls.__name__: entity_type
    for cls, entity_type in POLYMORPHIC_MODEL_TO_ENTITY.items()
}


# Event listener: auto-clean EmbeddingRecord and KnowledgeConnection rows on delete.
def clean_polymorphic_orphans(mapper: Any, connection: Any, target: Any) -> None:
    target_id = target.id
    target_class = target.__class__
    entity_type = (
        POLYMORPHIC_MODEL_TO_ENTITY.get(target_class)
        or POLYMORPHIC_ENTITY_NAME_MAP.get(target_class.__name__)
    )

    if entity_type:
        # Delete orphan embedding rows.
        connection.execute(
            EmbeddingRecord.__table__.delete().where(
                and_(
                    EmbeddingRecord.entity_id == target_id,
                    EmbeddingRecord.entity_type == entity_type,
                )
            )
        )
        # Delete orphan concept connections.
        connection.execute(
            KnowledgeConnection.__table__.delete().where(
                or_(
                    and_(KnowledgeConnection.source_id == target_id, KnowledgeConnection.source_type == entity_type),
                    and_(KnowledgeConnection.target_id == target_id, KnowledgeConnection.target_type == entity_type),
                )
            )
        )


# Register after_delete event listeners across polymorphic models
for model_cls in POLYMORPHIC_MODEL_TO_ENTITY:
    event.listen(model_cls, "after_delete", clean_polymorphic_orphans)
