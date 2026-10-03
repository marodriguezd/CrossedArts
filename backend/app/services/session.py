import uuid
from datetime import datetime, date
from backend.app.core.utils import utc_now_naive
from typing import Dict, List, Tuple
from sqlalchemy import select, func
from sqlalchemy.orm import Session
from backend.app.models.activity import LearningSession
from backend.app.models.resource import LearningResource

class SessionService:
    @staticmethod
    def start_session(db: Session, resource_id: uuid.UUID) -> LearningSession:
        """
        Crea e inicializa una nueva sesión de aprendizaje para un recurso.
        """
        resource = db.get(LearningResource, resource_id)
        if not resource:
            raise ValueError(f"Recurso de aprendizaje con ID {resource_id} no encontrado.")

        session = LearningSession(
            resource_id=resource_id,
            started_at=utc_now_naive(),
            ended_at=None,
            duration_minutes=0
        )
        db.add(session)
        db.commit()
        db.refresh(session)
        return session

    @staticmethod
    def update_session_heartbeat(db: Session, session_id: uuid.UUID) -> LearningSession:
        """
        Registra un latido (heartbeat) actualizando la duración transcurrida de forma dinámica,
        evitando sumar tiempo inactivo si el sistema estuvo suspendido.
        """
        session = db.get(LearningSession, session_id)
        if not session:
            raise ValueError(f"Sesión con ID {session_id} no encontrada.")

        now = utc_now_naive()
        if session.ended_at:
            delta_last_active = now - session.ended_at
            # Si el tiempo transcurrido desde el último latido es mayor de 300 segundos (5 minutos),
            # asumimos que el equipo estuvo suspendido o inactivo y descontamos ese tiempo.
            if delta_last_active.total_seconds() >= 300:
                from datetime import timedelta
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
        Finaliza una sesión de estudio guardando el timestamp final y la duración neta.
        """
        session = db.get(LearningSession, session_id)
        if not session:
            raise ValueError(f"Sesión con ID {session_id} no encontrada.")

        session.ended_at = utc_now_naive()
        delta = session.ended_at - session.started_at
        active_seconds = delta.total_seconds() - session.inactive_seconds
        session.duration_minutes = max(1, int(active_seconds / 60))  # Mínimo 1 minuto si se completa rápido

        db.add(session)
        db.flush()
        
        # Disparar actualización de metas
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
        Suma los minutos de estudio registrados para un recurso específico.
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
        Retorna la agregación de minutos de estudio agrupados por fecha (YYYY-MM-DD).
        """
        # En SQLite, func.date extrae la fecha del DateTime started_at
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
