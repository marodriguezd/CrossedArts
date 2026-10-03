from backend.app.schemas.common import BaseResponse, ErrorResponse, ErrorDetail
from backend.app.schemas.resource import ResourceBaseResponse, CourseBaseResponse, BookBaseResponse, MediaAssetResponse
from backend.app.schemas.course import TaskResponse, LessonResponse, ToggleLessonRequest, ModuleResponse, CourseDetailResponse
from backend.app.schemas.book import UpdateBookProgressRequest, BookDetailResponse
from backend.app.schemas.note import NoteResponse, CreateNoteRequest, UpdateNoteRequest
from backend.app.schemas.session import LearningSessionResponse, StartSessionRequest
from backend.app.schemas.dashboard import DashboardSummaryResponse, RecentActivityItem, StudyTimeReportResponse, StudyTimeDayReport
from backend.app.schemas.search import SearchResultResponse
from backend.app.schemas.ingestion import ImportResourceRequest, ImportResultResponse, DirectoryValidationResponse
from backend.app.schemas.ai import QuizQuestion, TutorResponse, ConceptCheck, SummaryResponse, FlashcardSet, Flashcard


__all__ = [
    "BaseResponse",
    "ErrorResponse",
    "ErrorDetail",
    "ResourceBaseResponse",
    "CourseBaseResponse",
    "BookBaseResponse",
    "MediaAssetResponse",
    "TaskResponse",
    "LessonResponse",
    "ToggleLessonRequest",
    "ModuleResponse",
    "CourseDetailResponse",
    "UpdateBookProgressRequest",
    "BookDetailResponse",
    "NoteResponse",
    "CreateNoteRequest",
    "UpdateNoteRequest",
    "LearningSessionResponse",
    "StartSessionRequest",
    "DashboardSummaryResponse",
    "RecentActivityItem",
    "StudyTimeReportResponse",
    "StudyTimeDayReport",
    "SearchResultResponse",
    "ImportResourceRequest",
    "ImportResultResponse",
    "DirectoryValidationResponse",
    "QuizQuestion",
    "TutorResponse",
    "ConceptCheck",
    "SummaryResponse",
    "FlashcardSet",
    "Flashcard",
]

