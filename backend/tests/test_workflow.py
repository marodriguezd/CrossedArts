import uuid
from datetime import timedelta
from backend.app.core.utils import utc_now_naive
from sqlalchemy.orm import Session

from backend.app.models.resource import Book
from backend.app.models.activity import Note
from backend.app.services.workflow import WorkflowService

def test_learning_paths(db: Session):
    # 1. Crear un path
    path = WorkflowService.create_learning_path(db, "Backend Mastery", "Ruta para dominar Python y FastAPI")
    assert path.title == "Backend Mastery"
    
    # 2. Agregar un item
    book = Book(id=uuid.uuid4(), title="Python Deep Dive")
    db.add(book)
    db.commit()
    
    item = WorkflowService.add_item_to_path(db, path.id, resource_id=book.id, sequence_order=1)
    assert item.resource_id == book.id
    assert item.sequence_order == 1
    assert not item.is_completed

    # 3. Marcar completado
    updated_item = WorkflowService.toggle_item_completion(db, item.id)
    assert updated_item.is_completed
    assert updated_item.completed_at is not None

    # 4. Listar paths
    paths = WorkflowService.get_learning_paths(db)
    assert len(paths) >= 1
    
    # 5. Eliminar item y path
    assert WorkflowService.delete_item_from_path(db, item.id)
    assert WorkflowService.delete_learning_path(db, path.id)


def test_study_plans(db: Session):
    plan = WorkflowService.create_study_plan(
        db, "Plan 30 mins", "Estudiar 30 minutos al día", 30, 150
    )
    assert plan.daily_goal_minutes == 30
    assert plan.weekly_goal_minutes == 150

    plans = WorkflowService.get_study_plans(db)
    assert len(plans) >= 1

    assert WorkflowService.delete_study_plan(db, plan.id)


def test_goals_and_trigger_updates(db: Session):
    book = Book(id=uuid.uuid4(), title="El Kybalion")
    db.add(book)
    db.commit()

    # 1. Crear meta
    goal = WorkflowService.create_goal(
        db, "Terminar Kybalion", "finish_book", 100.0, resource_id=book.id
    )
    assert goal.current_value == 0.0
    assert not goal.is_completed

    # 2. Actualización manual de progreso
    WorkflowService.update_goal_progress(db, goal.id, 45.0, "Leído hasta la mitad")
    assert goal.current_value == 45.0
    assert not goal.is_completed

    # 3. Disparador automático
    WorkflowService.trigger_goal_update_from_activity(db, "finish_book", resource_id=book.id, change_amount=60.0)
    assert goal.current_value == 100.0
    assert goal.is_completed


def test_habits_and_streaks(db: Session):
    habit = WorkflowService.create_habit(db, "Meditar", "10 minutos diarios", "daily", 5)
    assert habit.name == "Meditar"

    # Registrar el hábito para ayer y hoy
    yesterday = utc_now_naive() - timedelta(days=1)
    today = utc_now_naive()
    
    WorkflowService.record_habit_completion(db, habit.id, yesterday)
    WorkflowService.record_habit_completion(db, habit.id, today)

    stats = WorkflowService.get_habit_stats(db, habit.id)
    assert stats["streak_days"] == 2
    assert stats["weekly_count"] == 2


def test_spaced_repetition_sm2(db: Session):
    # 1. Crear item de repaso (Nota)
    book = Book(id=uuid.uuid4(), title="Sistemas Operativos")
    db.add(book)
    db.commit()
    
    note = Note(id=uuid.uuid4(), resource_id=book.id, content="El planificador CFS es de tiempo compartido justo.")
    db.add(note)
    db.commit()

    item = WorkflowService.create_review_item(db, note_id=note.id)
    assert item.note_id == note.id
    assert item.repetitions == 0
    assert item.interval_days == 1
    assert item.easiness_factor == 2.5

    # 2. Primera revisión excelente (quality = 5)
    item = WorkflowService.submit_review(db, item.id, 5)
    assert item.repetitions == 1
    assert item.interval_days == 1
    assert item.easiness_factor > 2.5

    # 3. Segunda revisión buena (quality = 4)
    item = WorkflowService.submit_review(db, item.id, 4)
    assert item.repetitions == 2
    assert item.interval_days == 6

    # 4. Tercera revisión incorrecta (quality = 1)
    item = WorkflowService.submit_review(db, item.id, 1)
    assert item.repetitions == 0
    assert item.interval_days == 1
