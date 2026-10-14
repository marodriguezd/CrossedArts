import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.schemas.session import LearningSessionResponse, StartSessionRequest
from backend.app.services.session import SessionService
from backend.app.api.dependencies import get_http_exception

router = APIRouter(prefix="/sessions", tags=["Sessions"])

@router.post("/start", response_model=LearningSessionResponse, status_code=status.HTTP_201_CREATED)
def start_session(payload: StartSessionRequest, db: Session = Depends(get_db)):
    """
    Start a study session in one of the three canonical scopes: lesson,
    resource, or global (cross-library review). Scope derives from anchors and
    may be declared explicitly; an incoherent declared scope yields a 422. There
    is no "scopeless" session: the global session IS the cross-cutting scope.
    """
    try:
        session = SessionService.start_session(
            db,
            resource_id=payload.resource_id,
            lesson_id=payload.lesson_id,
            scope=payload.scope
        )
        return session
    except ValueError as e:
        raise get_http_exception("RESOURCE_NOT_FOUND", str(e), status_code=status.HTTP_400_BAD_REQUEST)


@router.post("/{session_id}/heartbeat", response_model=LearningSessionResponse)
def update_session_heartbeat(session_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Receive the client's periodic HTTP heartbeat (every 10s) and recompute elapsed time.
    """
    try:
        session = SessionService.update_session_heartbeat(db, session_id)
        return session
    except ValueError as e:
        raise get_http_exception("SESSION_NOT_FOUND", str(e))


@router.post("/{session_id}/end", response_model=LearningSessionResponse)
def end_session(session_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Formally end a study session, computing the final net-minutes duration.
    Idempotent: repeats return the persisted result without re-applying the
    goal update.
    """
    try:
        session = SessionService.end_session(db, session_id)
        return session
    except ValueError as e:
        raise get_http_exception("SESSION_NOT_FOUND", str(e))
