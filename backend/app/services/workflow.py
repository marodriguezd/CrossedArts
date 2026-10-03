import uuid
import math
from datetime import datetime, timedelta, date
from backend.app.core.utils import utc_now_naive
from typing import List, Optional, Dict, Any
from sqlalchemy import select, func, desc, and_
from sqlalchemy.orm import Session

from backend.app.models.workflow import (
    LearningPath, LearningPathItem, StudyPlan, Goal, GoalProgress,
    LearningHabit, HabitRecord, ReviewItem, ReviewHistory
)
from backend.app.models.resource import LearningResource, Course, Book
from backend.app.models.course_structure import Lesson, Task
from backend.app.models.activity import Note, LearningSession

class WorkflowService:
    # ----------------- LEARNING PATHS -----------------
    @staticmethod
    def create_learning_path(db: Session, title: str, description: Optional[str] = None) -> LearningPath:
        path = LearningPath(id=uuid.uuid4(), title=title, description=description)
        db.add(path)
        db.commit()
        db.refresh(path)
        return path

    @staticmethod
    def get_learning_paths(db: Session) -> List[LearningPath]:
        return db.scalars(select(LearningPath).order_by(LearningPath.created_at.desc())).all()

    @staticmethod
    def get_learning_path(db: Session, path_id: uuid.UUID) -> Optional[LearningPath]:
        return db.get(LearningPath, path_id)

    @staticmethod
    def delete_learning_path(db: Session, path_id: uuid.UUID) -> bool:
        path = db.get(LearningPath, path_id)
        if not path:
            return False
        db.delete(path)
        db.commit()
        return True

    @staticmethod
    def add_item_to_path(
        db: Session,
        path_id: uuid.UUID,
        resource_id: Optional[uuid.UUID] = None,
        lesson_id: Optional[uuid.UUID] = None,
        task_id: Optional[uuid.UUID] = None,
        sequence_order: int = 0
    ) -> LearningPathItem:
        item = LearningPathItem(
            id=uuid.uuid4(),
            learning_path_id=path_id,
            resource_id=resource_id,
            lesson_id=lesson_id,
            task_id=task_id,
            sequence_order=sequence_order
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    @staticmethod
    def delete_item_from_path(db: Session, item_id: uuid.UUID) -> bool:
        item = db.get(LearningPathItem, item_id)
        if not item:
            return False
        db.delete(item)
        db.commit()
        return True

    @staticmethod
    def toggle_item_completion(db: Session, item_id: uuid.UUID) -> Optional[LearningPathItem]:
        item = db.get(LearningPathItem, item_id)
        if not item:
            return None
        item.is_completed = not item.is_completed
        item.completed_at = utc_now_naive() if item.is_completed else None
        db.commit()
        db.refresh(item)
        return item

    # ----------------- STUDY PLANS -----------------
    @staticmethod
    def create_study_plan(
        db: Session,
        title: str,
        description: Optional[str] = None,
        daily_goal_minutes: int = 30,
        weekly_goal_minutes: int = 150,
        target_completion_date: Optional[datetime] = None,
        recommended_workload: Optional[str] = None
    ) -> StudyPlan:
        plan = StudyPlan(
            id=uuid.uuid4(),
            title=title,
            description=description,
            daily_goal_minutes=daily_goal_minutes,
            weekly_goal_minutes=weekly_goal_minutes,
            target_completion_date=target_completion_date,
            recommended_workload=recommended_workload
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)
        return plan

    @staticmethod
    def get_study_plans(db: Session) -> List[StudyPlan]:
        return db.scalars(select(StudyPlan).order_by(StudyPlan.created_at.desc())).all()

    @staticmethod
    def get_study_plan(db: Session, plan_id: uuid.UUID) -> Optional[StudyPlan]:
        return db.get(StudyPlan, plan_id)

    @staticmethod
    def delete_study_plan(db: Session, plan_id: uuid.UUID) -> bool:
        plan = db.get(StudyPlan, plan_id)
        if not plan:
            return False
        db.delete(plan)
        db.commit()
        return True

    # ----------------- GOAL SYSTEM -----------------
    @staticmethod
    def create_goal(
        db: Session,
        title: str,
        target_type: str,
        target_value: float,
        resource_id: Optional[uuid.UUID] = None,
        deadline: Optional[datetime] = None
    ) -> Goal:
        goal = Goal(
            id=uuid.uuid4(),
            title=title,
            target_type=target_type,
            target_value=target_value,
            current_value=0.0,
            resource_id=resource_id,
            deadline=deadline
        )
        db.add(goal)
        db.commit()
        db.refresh(goal)
        return goal

    @staticmethod
    def get_goals(db: Session) -> List[Goal]:
        return db.scalars(select(Goal).order_by(Goal.created_at.desc())).all()

    @staticmethod
    def get_goal(db: Session, goal_id: uuid.UUID) -> Optional[Goal]:
        return db.get(Goal, goal_id)

    @staticmethod
    def delete_goal(db: Session, goal_id: uuid.UUID) -> bool:
        goal = db.get(Goal, goal_id)
        if not goal:
            return False
        db.delete(goal)
        db.commit()
        return True

    @staticmethod
    def update_goal_progress(db: Session, goal_id: uuid.UUID, value_change: float, notes: Optional[str] = None) -> Optional[Goal]:
        goal = db.get(Goal, goal_id)
        if not goal:
            return None
        goal.current_value = max(0.0, goal.current_value + value_change)
        if goal.current_value >= goal.target_value:
            goal.is_completed = True
        else:
            goal.is_completed = False
        
        progress = GoalProgress(
            id=uuid.uuid4(),
            goal_id=goal_id,
            value_change=value_change,
            new_value=goal.current_value,
            notes=notes
        )
        db.add(progress)
        db.commit()
        db.refresh(goal)
        return goal

    @staticmethod
    def trigger_goal_update_from_activity(
        db: Session,
        target_type: str,
        resource_id: Optional[uuid.UUID] = None,
        change_amount: float = 1.0
    ):
        """
        Escucha eventos del sistema (ej: sesión completada, lección terminada)
        e incrementa el valor de las metas que correspondan.
        """
        stmt = select(Goal).where(
            and_(
                Goal.target_type == target_type,
                Goal.is_completed == False
            )
        )
        if resource_id:
            stmt = stmt.where(Goal.resource_id == resource_id)
        
        goals = db.scalars(stmt).all()
        for goal in goals:
            goal.current_value = min(goal.target_value, goal.current_value + change_amount)
            if goal.current_value >= goal.target_value:
                goal.is_completed = True
            
            progress = GoalProgress(
                id=uuid.uuid4(),
                goal_id=goal.id,
                value_change=change_amount,
                new_value=goal.current_value,
                notes=f"Actualización automática por actividad en recurso."
            )
            db.add(progress)
        db.commit()

    # ----------------- HABIT TRACKING -----------------
    @staticmethod
    def create_habit(db: Session, name: str, description: Optional[str] = None, frequency: str = "daily", target_days_per_week: int = 5) -> LearningHabit:
        habit = LearningHabit(
            id=uuid.uuid4(),
            name=name,
            description=description,
            frequency=frequency,
            target_days_per_week=target_days_per_week
        )
        db.add(habit)
        db.commit()
        db.refresh(habit)
        return habit

    @staticmethod
    def get_habits(db: Session) -> List[LearningHabit]:
        habits = db.scalars(select(LearningHabit).order_by(LearningHabit.created_at.desc())).all()
        if not habits:
            return []

        habit_ids = [h.id for h in habits]
        sixty_days_ago = utc_now_naive() - timedelta(days=60)

        all_records = db.scalars(
            select(HabitRecord)
            .where(
                and_(
                    HabitRecord.habit_id.in_(habit_ids),
                    HabitRecord.date >= sixty_days_ago
                )
            )
            .order_by(HabitRecord.date.desc())
        ).all()

        records_by_habit = {}
        for r in all_records:
            records_by_habit.setdefault(r.habit_id, []).append(r)

        current_date = utc_now_naive().date()
        thirty_days_ago = utc_now_naive() - timedelta(days=30)
        seven_days_ago = utc_now_naive() - timedelta(days=7)

        for h in habits:
            records = records_by_habit.get(h.id, [])[:60]

            # Streak
            streak = 0
            recorded_dates = {r.date.date() for r in records}
            if current_date in recorded_dates:
                streak = 1
                check_date = current_date - timedelta(days=1)
                while check_date in recorded_dates:
                    streak += 1
                    check_date -= timedelta(days=1)
            elif (current_date - timedelta(days=1)) in recorded_dates:
                streak = 1
                check_date = current_date - timedelta(days=2)
                while check_date in recorded_dates:
                    streak += 1
                    check_date -= timedelta(days=1)

            # 30 days
            total_30_days = sum(1 for r in records if r.date >= thirty_days_ago)
            completion_rate = min(1.0, total_30_days / 30.0)

            # 7 days
            weekly_count = sum(1 for r in records if r.date >= seven_days_ago)

            h.stats = {
                "habit_id": h.id,
                "name": h.name,
                "streak_days": streak,
                "completion_rate": completion_rate,
                "weekly_count": weekly_count
            }
        return habits


    @staticmethod
    def record_habit_completion(db: Session, habit_id: uuid.UUID, target_date: Optional[datetime] = None) -> HabitRecord:
        if not target_date:
            target_date = utc_now_naive()
        # Verificar si ya existe registro para ese día (mismo año/mes/día)
        start_of_day = datetime(target_date.year, target_date.month, target_date.day)
        end_of_day = start_of_day + timedelta(days=1)
        
        stmt = select(HabitRecord).where(
            and_(
                HabitRecord.habit_id == habit_id,
                HabitRecord.date >= start_of_day,
                HabitRecord.date < end_of_day
            )
        )
        existing = db.scalars(stmt).first()
        if existing:
            return existing

        record = HabitRecord(
            id=uuid.uuid4(),
            habit_id=habit_id,
            date=target_date,
            is_completed=True
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    @staticmethod
    def get_habit_stats(db: Session, habit_id: uuid.UUID) -> Dict[str, Any]:
        habit = db.get(LearningHabit, habit_id)
        if not habit:
            return {}
        
        # Limitar la carga de registros en memoria a los últimos 60 días para optimizar
        records = db.scalars(
            select(HabitRecord)
            .where(HabitRecord.habit_id == habit_id)
            .order_by(HabitRecord.date.desc())
            .limit(60)
        ).all()

        # Streak calculation
        streak = 0
        current_date = utc_now_naive().date()
        recorded_dates = {r.date.date() for r in records}
        
        # Si el hábito fue completado hoy, empezamos desde hoy, sino desde ayer
        if current_date in recorded_dates:
            streak = 1
            check_date = current_date - timedelta(days=1)
            while check_date in recorded_dates:
                streak += 1
                check_date -= timedelta(days=1)
        elif (current_date - timedelta(days=1)) in recorded_dates:
            streak = 1
            check_date = current_date - timedelta(days=2)
            while check_date in recorded_dates:
                streak += 1
                check_date -= timedelta(days=1)
        
        # Tasa de completación de los últimos 30 días
        thirty_days_ago = utc_now_naive() - timedelta(days=30)
        stmt_count = select(func.count(HabitRecord.id)).where(
            and_(
                HabitRecord.habit_id == habit_id,
                HabitRecord.date >= thirty_days_ago
            )
        )
        total_30_days = db.scalar(stmt_count) or 0
        completion_rate = min(1.0, total_30_days / 30.0)

        # Completados esta semana (últimos 7 días)
        seven_days_ago = utc_now_naive() - timedelta(days=7)
        stmt_week = select(func.count(HabitRecord.id)).where(
            and_(
                HabitRecord.habit_id == habit_id,
                HabitRecord.date >= seven_days_ago
            )
        )
        weekly_count = db.scalar(stmt_week) or 0

        return {
            "habit_id": habit_id,
            "name": habit.name,
            "streak_days": streak,
            "completion_rate": completion_rate,
            "weekly_count": weekly_count
        }

    # ----------------- SPACED REPETITION (SM-2) -----------------
    @staticmethod
    def create_review_item(
        db: Session,
        note_id: Optional[uuid.UUID] = None,
        quiz_id: Optional[uuid.UUID] = None,
        question_index: Optional[int] = None,
        flashcard_front: Optional[str] = None,
        flashcard_back: Optional[str] = None
    ) -> ReviewItem:
        item = ReviewItem(
            id=uuid.uuid4(),
            note_id=note_id,
            quiz_id=quiz_id,
            question_index=question_index,
            flashcard_front=flashcard_front,
            flashcard_back=flashcard_back,
            interval_days=1,
            easiness_factor=2.5,
            repetitions=0,
            next_review=utc_now_naive()
        )
        db.add(item)
        db.commit()
        db.refresh(item)
        return item

    @staticmethod
    def get_review_items(db: Session, due_only: bool = False) -> List[ReviewItem]:
        stmt = select(ReviewItem)
        if due_only:
            stmt = stmt.where(ReviewItem.next_review <= utc_now_naive())
        return db.scalars(stmt.order_by(ReviewItem.next_review.asc())).all()

    @staticmethod
    def submit_review(db: Session, item_id: uuid.UUID, quality: int) -> Optional[ReviewItem]:
        """
        Actualiza el estado de repaso usando el algoritmo SM-2.
        quality: 0 a 5.
        """
        item = db.get(ReviewItem, item_id)
        if not item:
            return None

        # SM-2 Algorithm logic
        if quality < 3:
            # Mala respuesta: resetear intervalos
            item.repetitions = 0
            item.interval_days = 1
        else:
            # Respuesta correcta o aceptable
            if item.repetitions == 0:
                item.interval_days = 1
            elif item.repetitions == 1:
                item.interval_days = 6
            else:
                item.interval_days = math.ceil(item.interval_days * item.easiness_factor)
            item.repetitions += 1

        # Actualizar factor de facilidad (Easiness Factor)
        # EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
        item.easiness_factor = max(
            1.3,
            item.easiness_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        )

        item.last_reviewed = utc_now_naive()
        item.next_review = utc_now_naive() + timedelta(days=item.interval_days)

        # Historial
        history = ReviewHistory(
            id=uuid.uuid4(),
            review_item_id=item_id,
            quality=quality,
            next_review=item.next_review
        )
        db.add(history)
        db.commit()
        db.refresh(item)
        return item
