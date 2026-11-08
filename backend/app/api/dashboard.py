from typing import List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import select, func, desc

from backend.app.core.database import get_db
from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.course_structure import Task
from backend.app.models.activity import LearningSession, Note, resolve_effective_session_scope
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
    # `ended_at IS NOT NULL` is required as well: a legal legacy row can be
    # finalized with no end stamp, and the response model needs a real timestamp.
    # A session can be lesson-scoped (null resource_id) or global (cross-cutting
    # review): the visible title then resolves from the lesson, or the real scope
    # is described without inventing a destination.
    stmt_sessions = (
        select(LearningSession)
        .where(LearningSession.finalized.is_(True), LearningSession.ended_at.is_not(None))
        .options(
            selectinload(LearningSession.resource),
            selectinload(LearningSession.lesson),
        )
        .order_by(desc(LearningSession.ended_at))
        .limit(5)
    )
    sessions = db.scalars(stmt_sessions).all()
    for s in sessions:
        # `resource_id` carries a REAL resource or nothing: it is never the
        # session's own id. An anchorless (or unlinked) session is presented
        # through its own `title` and its EFFECTIVE scope, which re-derives from
        # the anchors that still exist after `ON DELETE SET NULL`.
        #
        # The WHERE clause already excludes sessions without an end stamp; the
        # guard restates it so the item's required `timestamp` is proven at the
        # type level instead of asserted away.
        ended_at = s.ended_at
        if ended_at is None:
            continue
        resource = s.resource
        lesson_title = s.lesson.title if s.lesson else None
        # The headline names the anchor its EFFECTIVE scope points at: a
        # lesson-scoped session inside a course must not be titled with the
        # course, or `scope` and `title` would describe two different anchors.
        if s.lesson is not None:
            title = lesson_title or "Lección"
            description = f"Sesi\u00f3n de lecci\u00f3n finalizada ({s.duration_minutes} min)."
        elif resource is not None:
            title = resource.title
            description = f"Sesi\u00f3n de estudio finalizada ({s.duration_minutes} min)."
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

    # 2. Latest 5 written notes. Both anchors are eager-loaded: the feed shows a
    # title per row and lazy loading would fire up to four SELECTs per note.
    stmt_notes = (
        select(Note)
        .options(selectinload(Note.resource), selectinload(Note.lesson))
        .order_by(desc(Note.created_at))
        .limit(5)
    )
    notes = db.scalars(stmt_notes).all()
    for n in notes:
        # A standalone note is valid state (note.resource_id IS NULL): its
        # anchors stay NULL and its OWN title is the headline — no placeholder
        # resource and no invented `resource_type` are needed to show it.
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

    # Sort by timestamp, newest first. Entries without a timestamp sort last
    # instead of raising: both queries above already exclude them, and a
    # comparator that trusts the data would turn one bad row into a 500.
    recent_activity.sort(key=lambda x: (x.timestamp is not None, x.timestamp), reverse=True)

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
