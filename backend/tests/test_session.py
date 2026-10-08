import uuid
import time
from datetime import datetime, timedelta, date, time
from backend.app.core.utils import utc_now_naive
from sqlalchemy.orm import Session

from backend.app.models.resource import Book
from backend.app.services.session import SessionService

def test_session_lifecycle_and_duration(db: Session):
    # 1. Crear un recurso para asociarle la sesión
    book = Book(
        id=uuid.uuid4(),
        title="Libro de Estudio",
        reading_percentage=0.0
    )
    db.add(book)
    db.commit()

    # 2. Iniciar sesión
    session = SessionService.start_session(db, book.id)
    assert session.ended_at is None
    assert session.duration_minutes == 0

    # 3. Forzar cambio de tiempo de inicio para simular transcurso de 15 minutos
    session.started_at = utc_now_naive() - timedelta(minutes=15)
    db.add(session)
    db.commit()

    # 4. Registrar heartbeat (debe calcular aproximadamente 15 mins)
    SessionService.update_session_heartbeat(db, session.id)
    assert session.duration_minutes == 15

    # 5. Finalizar sesión
    SessionService.end_session(db, session.id)
    assert session.ended_at is not None
    assert session.duration_minutes >= 15


def test_session_aggregations(db: Session):
    r1_id = uuid.uuid4()
    r2_id = uuid.uuid4()
    
    # Crear dos recursos
    b1 = Book(id=r1_id, title="Libro A")
    b2 = Book(id=r2_id, title="Libro B")
    db.add_all([b1, b2])
    db.commit()

    # Crear sesiones ficticias de distintas duraciones y días.
    # Usamos fechas ancladas a mediodía para que el test no cambie de resultado
    # cuando CI se ejecuta cerca de medianoche.
    now = utc_now_naive()
    today = now.date()
    yesterday = today - timedelta(days=1)

    s1 = SessionService.start_session(db, r1_id)
    s1.started_at = datetime.combine(today, time(12, 0))
    s1.ended_at = s1.started_at + timedelta(minutes=20)
    s1.duration_minutes = 20
    db.add(s1)

    s2 = SessionService.start_session(db, r1_id)
    s2.started_at = datetime.combine(yesterday, time(12, 0))
    s2.ended_at = s2.started_at + timedelta(minutes=30)
    s2.duration_minutes = 30
    db.add(s2)

    s3 = SessionService.start_session(db, r2_id)
    s3.started_at = datetime.combine(today, time(13, 0))
    s3.ended_at = s3.started_at + timedelta(minutes=10)
    s3.duration_minutes = 10
    db.add(s3)

    db.commit()

    # Verificar agregaciones
    total_time = SessionService.get_total_study_minutes(db)
    assert total_time == (20 + 30 + 10)

    resource_time = SessionService.get_study_minutes_by_resource(db, r1_id)
    assert resource_time == (20 + 30)

    daily_report = SessionService.get_study_minutes_by_day(db)
    # Deben haber 2 días diferentes registrados
    assert len(daily_report) == 2
