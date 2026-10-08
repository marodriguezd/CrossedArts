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
    Inicializa una sesión de estudio en uno de los tres ámbitos canónicos:
    lección, recurso o global (repaso transversal de la biblioteca).

    El ámbito se deriva de las anclas y puede declararse explícitamente; un
    ámbito declarado incoherente produce un 422 de validación. No existe una
    sesión "sin ámbito": la sesión global ES el ámbito transversal.
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
    Recibe el latido HTTP periódico (cada 10s) del cliente y recalcula el tiempo transcurrido.
    """
    try:
        session = SessionService.update_session_heartbeat(db, session_id)
        return session
    except ValueError as e:
        raise get_http_exception("SESSION_NOT_FOUND", str(e))


@router.post("/{session_id}/end", response_model=LearningSessionResponse)
def end_session(session_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Finaliza formalmente una sesión de estudio calculando la duración final en
    minutos netos.

    Idempotente: repetir la llamada devuelve el resultado ya persistido y no
    vuelve a aplicar la actualización de metas.
    """
    try:
        session = SessionService.end_session(db, session_id)
        return session
    except ValueError as e:
        raise get_http_exception("SESSION_NOT_FOUND", str(e))
