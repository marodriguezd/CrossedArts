import uuid
from datetime import datetime, date, timedelta
from backend.app.core.utils import utc_now_naive
from typing import List, Optional, Tuple
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from backend.app.models.activity import LearningSession, resolve_session_scope, SESSION_SCOPES
from backend.app.models.resource import LearningResource
from backend.app.models.course_structure import Lesson

class SessionService:
    @staticmethod
    def start_session(
        db: Session,
        resource_id: Optional[uuid.UUID] = None,
        lesson_id: Optional[uuid.UUID] = None,
        mode: str = "flashcards",
        scope: Optional[str] = None
    ) -> LearningSession:
        """
        Create and initialize a new study session.

        Domain contract (mirrors the frontend SQLite WASM, single rule in
        `resolve_session_scope`): the session is scoped to a LESSON, a RESOURCE,
        or is GLOBAL (anchorless cross-library review). Scope derives from
        anchors and may be declared explicitly to remove ambiguity; an incoherent
        declared scope is a domain error. References are verified so no ghost
        sessions point at nonexistent IDs.
        """
        derived_scope = resolve_session_scope(resource_id, lesson_id)

        if scope is not None and scope != derived_scope:
            if scope not in SESSION_SCOPES:
                raise ValueError(
                    "Ámbito de sesión inválido: debe ser 'lesson', 'resource' o 'global'."
                )
            raise ValueError(
                f"Ámbito de sesión incoherente: '{scope}' no corresponde a las anclas "
                f"declaradas (ámbito derivado: '{derived_scope}')."
            )

        if resource_id is not None:
            resource = db.get(LearningResource, resource_id)
            if not resource:
                raise ValueError(f"Recurso de aprendizaje con ID {resource_id} no encontrado.")

        if lesson_id is not None:
            lesson = db.get(Lesson, lesson_id)
            if not lesson:
                raise ValueError(f"Lección con ID {lesson_id} no encontrada.")

        session = LearningSession(
            resource_id=resource_id,
            lesson_id=lesson_id,
            scope=derived_scope,
            mode=mode,
            started_at=utc_now_naive(),
            ended_at=None,
            finalized=False,
            duration_minutes=0
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def update_session_heartbeat(db: Session, session_id: uuid.UUID) -> LearningSession:
        """
        Record a heartbeat, updating elapsed duration dynamically while skipping
        idle time when the system was suspended. A post-finalization heartbeat
        neither reopens nor rewrites the session: a finalized session's end mark
        is immutable.
        """
        session = db.get(LearningSession, session_id)
        if not session:
            raise ValueError(f"Sesión con ID {session_id} no encontrada.")

        if session.finalized:
            return session

        now = utc_now_naive()
        if session.ended_at:
            delta_last_active = now - session.ended_at
            # Past 300 s (5 min) since the last heartbeat, assume the machine was
            # suspended/idle and discount that time.
            if delta_last_active.total_seconds() >= 300:
                inactive_time = delta_last_active - timedelta(seconds=10)
                session.inactive_seconds += int(inactive_time.total_seconds())

        delta = now - session.started_at
        active_seconds = delta.total_seconds() - session.inactive_seconds
        session.duration_minutes = max(0, int(active_seconds / 60))
        session.ended_at = now

        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def end_session(db: Session, session_id: uuid.UUID) -> LearningSession:
        """
        Finalize a study session, storing the end timestamp and net duration.

        IDEMPOTENT: ending an already-ended session changes neither its end mark
        nor its duration, and never re-applies the goal update. Retrying
        `POST /end` (network timeout, double click, client retry) is safe and
        returns exactly the same result.
        """
        session = db.get(LearningSession, session_id)
        if not session:
            raise ValueError(f"Sesión con ID {session_id} no encontrada.")

        if session.finalized:
            # Already finalized: return the persisted result without recomputing
            # duration or firing goal side effects again.
            return session

        session.ended_at = utc_now_naive()
        session.finalized = True
        delta = session.ended_at - session.started_at
        active_seconds = delta.total_seconds() - session.inactive_seconds
        session.duration_minutes = max(1, int(active_seconds / 60))  # Floor of 1 min on quick completion.

        db.add(session)
        db.flush()

        # Fire the goal update.
        from backend.app.services.workflow import WorkflowService
        WorkflowService.trigger_goal_update_from_activity(
            db,
            "study_minutes",
            resource_id=session.resource_id,
            change_amount=session.duration_minutes
        )

        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def get_total_study_minutes(db: Session) -> int:
        """
        Suma todos los minutos de estudio registrados.
        """
        stmt = select(func.sum(LearningSession.duration_minutes))
        result = db.execute(stmt).scalar()
        return result if result is not None else 0

    @staticmethod
    def get_study_minutes_by_resource(db: Session, resource_id: uuid.UUID) -> int:
        """
        Sum recorded study minutes for a specific resource.
        """
        stmt = (
            select(func.sum(LearningSession.duration_minutes))
            .where(LearningSession.resource_id == resource_id)
        )
        result = db.execute(stmt).scalar()
        return result if result is not None else 0

    @staticmethod
    def get_study_minutes_by_day(db: Session) -> List[Tuple[date, int]]:
        """
        Return study minutes aggregated by date (YYYY-MM-DD).
        """
        # On SQLite, func.date extracts the date from the started_at DateTime.
        stmt = (
            select(
                func.date(LearningSession.started_at).label("study_date"),
                func.sum(LearningSession.duration_minutes).label("total_mins")
            )
            .group_by("study_date")
            .order_by("study_date")
        )
        results = db.execute(stmt).all()
        # Convertir a objetos datetime.date para retornar una interfaz limpia
        study_dates = []
        for row in results:
            if row[0] is None:
                continue
            val = row[0]
            if isinstance(val, str):
                dt_val = datetime.strptime(val, "%Y-%m-%d").date()
            elif isinstance(val, datetime):
                dt_val = val.date()
            else:
                dt_val = val  # already a datetime.date object
            study_dates.append((dt_val, row[1]))
        return study_dates
