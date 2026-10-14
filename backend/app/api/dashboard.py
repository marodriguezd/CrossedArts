from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import select, func, desc

from backend.app.core.database import get_db
from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.course_structure import Task
from backend.app.models.activity import LearningSession, Note
from backend.app.schemas.dashboard import (
    DashboardSummaryResponse, RecentActivityItem, StudyTimeReportResponse, StudyTimeDayReport
)
from backend.app.services.session import SessionService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])

@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(db: Session = Depends(get_db)):
    """
    Return global-progress KPIs and aggregate metrics for the main dashboard.
    """
    # 1. Totales de recursos
    total_resources = db.query(func.count(LearningResource.id)).scalar() or 0
    courses_count = db.query(func.count(Course.id)).scalar() or 0
    books_count = db.query(func.count(Book.id)).scalar() or 0

    # 2. Estados de completado
    completed_resources = db.query(func.count(LearningResource.id)).where(LearningResource.status == "COMPLETED").scalar() or 0
    in_progress_resources = db.query(func.count(LearningResource.id)).where(LearningResource.status == "IN_PROGRESS").scalar() or 0

    # 3. Tareas pendientes
    pending_tasks_count = db.query(func.count(Task.id)).where(Task.is_completed == False).scalar() or 0

    # 4. Minutos totales estudiados
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


@router.get("/recent-activity", response_model=List[RecentActivityItem])
def get_recent_activity(db: Session = Depends(get_db)):
    """
    Return the unified recent-activity list (finalized study sessions plus created notes).
    """
    recent_activity: List[RecentActivityItem] = []

    # 1. Latest 5 FINALIZED study sessions. `finalized` (not `ended_at`) is the
    # formal close marker: the heartbeat also writes `ended_at` as a last-activity
    # stamp, so an in-progress session must not show up as closed activity yet.
    # A session can be lesson-scoped (null resource_id) or global (cross-cutting
    # review): the visible title then resolves from the lesson, or the real scope
    # is described without inventing a destination.
    stmt_sessions = (
        select(LearningSession)
        .where(LearningSession.finalized.is_(True))
        .order_by(desc(LearningSession.ended_at))
        .limit(5)
    )
    sessions = db.scalars(stmt_sessions).all()
    for s in sessions:
        if s.resource is not None:
            resource_id = s.resource.id
            resource_title = s.resource.title
            resource_type = s.resource.type
            description = f"Sesión de estudio finalizada ({s.duration_minutes} min)."
        else:
            resource_id = s.id  # The session's own id as the stable key.
            resource_title = s.lesson.title if s.lesson else "Repaso general"
            resource_type = "lesson" if s.lesson else "global"
            description = (
                f"Sesión de lección finalizada ({s.duration_minutes} min)."
                if s.lesson
                else f"Repaso general finalizado ({s.duration_minutes} min)."
            )
        recent_activity.append(
            RecentActivityItem(
                id=s.id,
                resource_id=resource_id,
                resource_title=resource_title,
                resource_type=resource_type,
                activity_type="session",
                timestamp=s.ended_at,
                duration_minutes=s.duration_minutes,
                description=description
            )
        )

    # 2. Latest 5 written notes.
    stmt_notes = (
        select(Note)
        .order_by(desc(Note.created_at))
        .limit(5)
    )
    notes = db.scalars(stmt_notes).all()
    for n in notes:
        recent_activity.append(
            RecentActivityItem(
                id=n.id,
                resource_id=n.resource_id,
                resource_title=n.resource.title,
                resource_type=n.resource.type,
                activity_type="note",
                timestamp=n.created_at,
                description=f"Nota redactada en {n.resource.title}."
            )
        )

    # Sort by timestamp, newest first.
    recent_activity.sort(key=lambda x: x.timestamp, reverse=True)

    # Return the 5 most recent activities.
    return recent_activity[:5]


@router.get("/study-time", response_model=StudyTimeReportResponse)
def get_study_time_report(db: Session = Depends(get_db)):
    """
    Return the daily study-minutes history for stats charts.
    """
    report = SessionService.get_study_minutes_by_day(db)
    day_reports = [StudyTimeDayReport(date=row[0], minutes=row[1]) for row in report]
    return StudyTimeReportResponse(history=day_reports)
