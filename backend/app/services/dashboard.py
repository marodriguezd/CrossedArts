from typing import List
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, func, desc

from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.course_structure import Task
from backend.app.models.activity import LearningSession, Note, resolve_effective_session_scope
from backend.app.schemas.dashboard import (
    DashboardSummaryResponse, RecentActivityItem, StudyTimeReportResponse, StudyTimeDayReport
)
from backend.app.services.session import SessionService


class DashboardService:
    @staticmethod
    def get_summary(db: Session) -> DashboardSummaryResponse:
        """Return global-progress KPIs and aggregate metrics for the main dashboard."""
        total_resources = db.query(func.count(LearningResource.id)).scalar() or 0
        courses_count = db.query(func.count(Course.id)).scalar() or 0
        books_count = db.query(func.count(Book.id)).scalar() or 0

        completed_resources = (
            db.query(func.count(LearningResource.id))
            .where(LearningResource.status == "COMPLETED")
            .scalar() or 0
        )
        in_progress_resources = (
            db.query(func.count(LearningResource.id))
            .where(LearningResource.status == "IN_PROGRESS")
            .scalar() or 0
        )

        pending_tasks_count = (
            db.query(func.count(Task.id))
            .where(Task.is_completed.is_(False))
            .scalar() or 0
        )

        total_study_time_minutes = SessionService.get_total_study_minutes(db)

        return DashboardSummaryResponse(
            total_resources=total_resources,
            courses_count=courses_count,
            books_count=books_count,
            completed_resources=completed_resources,
            in_progress_resources=in_progress_resources,
            pending_tasks_count=pending_tasks_count,
            total_study_time_minutes=total_study_time_minutes
        )

    @staticmethod
    def get_recent_activity(db: Session, limit: int = 5) -> List[RecentActivityItem]:
        """
        Return the unified recent-activity list (finalized study sessions plus created notes).
        """
        recent_activity: List[RecentActivityItem] = []

        # 1. Latest finalized study sessions.
        stmt_sessions = (
            select(LearningSession)
            .where(LearningSession.finalized.is_(True), LearningSession.ended_at.is_not(None))
            .options(
                selectinload(LearningSession.resource),
                selectinload(LearningSession.lesson),
            )
            .order_by(desc(LearningSession.ended_at))
            .limit(limit)
        )
        sessions = db.scalars(stmt_sessions).all()
        for s in sessions:
            ended_at = s.ended_at
            if ended_at is None:
                continue
            resource = s.resource
            lesson_title = s.lesson.title if s.lesson else None

            if s.lesson is not None:
                title = lesson_title or "Lección"
                description = f"Sesión de lección finalizada ({s.duration_minutes} min)."
            elif resource is not None:
                title = resource.title
                description = f"Sesión de estudio finalizada ({s.duration_minutes} min)."
            else:
                title = "Repaso general"
                description = f"Repaso general finalizado ({s.duration_minutes} min)."

            recent_activity.append(
                RecentActivityItem(
                    id=s.id,
                    activity_type="session",
                    timestamp=ended_at,
                    title=title,
                    description=description,
                    scope=resolve_effective_session_scope(s.scope, s.resource_id, s.lesson_id),
                    resource_id=resource.id if resource is not None else None,
                    resource_title=resource.title if resource is not None else None,
                    resource_type=resource.type if resource is not None else None,
                    lesson_id=s.lesson_id,
                    lesson_title=lesson_title,
                    duration_minutes=s.duration_minutes
                )
            )

        # 2. Latest written notes.
        stmt_notes = (
            select(Note)
            .options(selectinload(Note.resource), selectinload(Note.lesson))
            .order_by(desc(Note.created_at))
            .limit(limit)
        )
        notes = db.scalars(stmt_notes).all()
        for n in notes:
            resource = n.resource
            recent_activity.append(
                RecentActivityItem(
                    id=n.id,
                    activity_type="note",
                    timestamp=n.created_at,
                    title=n.title,
                    description=(
                        f"Nota redactada en {resource.title}."
                        if resource is not None
                        else "Nota redactada sin recurso asociado."
                    ),
                    scope=None,
                    resource_id=resource.id if resource is not None else None,
                    resource_title=resource.title if resource is not None else None,
                    resource_type=resource.type if resource is not None else None,
                    lesson_id=n.lesson_id,
                    lesson_title=n.lesson.title if n.lesson is not None else None
                )
            )

        # Sort by timestamp, newest first.
        recent_activity.sort(key=lambda x: (x.timestamp is not None, x.timestamp), reverse=True)

        return recent_activity[:limit]

    @staticmethod
    def get_study_time_report(db: Session) -> StudyTimeReportResponse:
        """Return the daily study-minutes history for stats charts."""
        report = SessionService.get_study_minutes_by_day(db)
        day_reports = [StudyTimeDayReport(date=row[0], minutes=row[1]) for row in report]
        return StudyTimeReportResponse(history=day_reports)
