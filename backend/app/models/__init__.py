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

from sqlalchemy import event, or_, and_

# Listener de eventos para limpiar automáticamente EmbeddingRecord y KnowledgeConnection al eliminar registros
def clean_polymorphic_orphans(mapper, connection, target):
    target_id = target.id
    class_name = target.__class__.__name__

    # Mapear el nombre de la clase al tipo polimórfico correspondiente
    entity_type = None
    if class_name == "Note":
        entity_type = "note"
    elif class_name == "TranscriptSegment":
        entity_type = "transcript_segment"
    elif class_name == "ContentIndex":
        entity_type = "content_index"
    elif class_name == "Lesson":
        entity_type = "lesson"
    elif class_name == "MediaAsset":
        entity_type = "media_asset"
    elif class_name == "Concept":
        entity_type = "concept"
    elif class_name in ("LearningResource", "Course", "Book"):
        entity_type = "resource"

    if entity_type:
        # Eliminar registros de embedding huérfanos
        connection.execute(
            EmbeddingRecord.__table__.delete().where(
                and_(
                    EmbeddingRecord.entity_id == target_id,
                    EmbeddingRecord.entity_type == entity_type
                )
            )
        )
        # Eliminar conexiones conceptuales huérfanas
        connection.execute(
            KnowledgeConnection.__table__.delete().where(
                or_(
                    and_(KnowledgeConnection.source_id == target_id, KnowledgeConnection.source_type == entity_type),
                    and_(KnowledgeConnection.target_id == target_id, KnowledgeConnection.target_type == entity_type)
                )
            )
        )

# Registrar listeners en las clases correspondientes
event.listen(Note, "after_delete", clean_polymorphic_orphans)
event.listen(Lesson, "after_delete", clean_polymorphic_orphans)
event.listen(MediaAsset, "after_delete", clean_polymorphic_orphans)
event.listen(ContentIndex, "after_delete", clean_polymorphic_orphans)
event.listen(TranscriptSegment, "after_delete", clean_polymorphic_orphans)
event.listen(Concept, "after_delete", clean_polymorphic_orphans)
event.listen(LearningResource, "after_delete", clean_polymorphic_orphans)
event.listen(Course, "after_delete", clean_polymorphic_orphans)
event.listen(Book, "after_delete", clean_polymorphic_orphans)





