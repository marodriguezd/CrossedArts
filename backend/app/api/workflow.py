import uuid
from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.app.core.database import get_db
from backend.app.services.workflow import WorkflowService
from backend.app.services.llm import LLMService
from backend.app.schemas.workflow import (
    LearningPathResponse, CreateLearningPathRequest,
    LearningPathItemResponse, CreateLearningPathItemRequest,
    StudyPlanResponse, CreateStudyPlanRequest,
    GoalResponse, CreateGoalRequest, UpdateGoalProgressRequest,
    LearningHabitResponse, CreateLearningHabitRequest, HabitStatsResponse,
    ReviewItemResponse, CreateReviewItemRequest, SubmitReviewRequest
)
from backend.app.models.workflow import ReviewItem

router = APIRouter(prefix="/workflow", tags=["Learning Workflow Engine"])

# ----------------- LEARNING PATHS -----------------

@router.post("/paths", response_model=LearningPathResponse, status_code=status.HTTP_201_CREATED)
def create_learning_path(payload: CreateLearningPathRequest, db: Session = Depends(get_db)):
    return WorkflowService.create_learning_path(db, payload.title, payload.description)

@router.get("/paths", response_model=List[LearningPathResponse])
def get_learning_paths(db: Session = Depends(get_db)):
    return WorkflowService.get_learning_paths(db)

@router.get("/paths/{path_id}", response_model=LearningPathResponse)
def get_learning_path(path_id: uuid.UUID, db: Session = Depends(get_db)):
    path = WorkflowService.get_learning_path(db, path_id)
    if not path:
        raise HTTPException(status_code=404, detail="Learning path no encontrado.")
    return path

@router.delete("/paths/{path_id}")
def delete_learning_path(path_id: uuid.UUID, db: Session = Depends(get_db)):
    success = WorkflowService.delete_learning_path(db, path_id)
    if not success:
        raise HTTPException(status_code=404, detail="Learning path no encontrado.")
    return {"detail": "Learning path eliminado correctamente."}

@router.post("/paths/{path_id}/items", response_model=LearningPathItemResponse, status_code=status.HTTP_201_CREATED)
def add_item_to_path(path_id: uuid.UUID, payload: CreateLearningPathItemRequest, db: Session = Depends(get_db)):
    return WorkflowService.add_item_to_path(
        db, path_id, payload.resource_id, payload.lesson_id, payload.task_id, payload.sequence_order
    )

@router.delete("/items/{item_id}")
def delete_item_from_path(item_id: uuid.UUID, db: Session = Depends(get_db)):
    success = WorkflowService.delete_item_from_path(db, item_id)
    if not success:
        raise HTTPException(status_code=404, detail="Item no encontrado.")
    return {"detail": "Item eliminado de la ruta de aprendizaje."}

@router.post("/items/{item_id}/toggle", response_model=LearningPathItemResponse)
def toggle_item_completion(item_id: uuid.UUID, db: Session = Depends(get_db)):
    item = WorkflowService.toggle_item_completion(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item no encontrado.")
    return item


# ----------------- STUDY PLANS -----------------

@router.post("/plans", response_model=StudyPlanResponse, status_code=status.HTTP_201_CREATED)
def create_study_plan(payload: CreateStudyPlanRequest, db: Session = Depends(get_db)):
    return WorkflowService.create_study_plan(
        db, payload.title, payload.description,
        payload.daily_goal_minutes, payload.weekly_goal_minutes,
        payload.target_completion_date, payload.recommended_workload
    )

@router.get("/plans", response_model=List[StudyPlanResponse])
def get_study_plans(db: Session = Depends(get_db)):
    return WorkflowService.get_study_plans(db)

@router.get("/plans/{plan_id}", response_model=StudyPlanResponse)
def get_study_plan(plan_id: uuid.UUID, db: Session = Depends(get_db)):
    plan = WorkflowService.get_study_plan(db, plan_id)
    if not plan:
        raise HTTPException(status_code=404, detail="Plan de estudio no encontrado.")
    return plan

@router.delete("/plans/{plan_id}")
def delete_study_plan(plan_id: uuid.UUID, db: Session = Depends(get_db)):
    success = WorkflowService.delete_study_plan(db, plan_id)
    if not success:
        raise HTTPException(status_code=404, detail="Plan de estudio no encontrado.")
    return {"detail": "Plan de estudio eliminado correctamente."}


# ----------------- GOALS -----------------

@router.post("/goals", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(payload: CreateGoalRequest, db: Session = Depends(get_db)):
    return WorkflowService.create_goal(
        db, payload.title, payload.target_type, payload.target_value, payload.resource_id, payload.deadline
    )

@router.get("/goals", response_model=List[GoalResponse])
def get_goals(db: Session = Depends(get_db)):
    return WorkflowService.get_goals(db)

@router.get("/goals/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: uuid.UUID, db: Session = Depends(get_db)):
    goal = WorkflowService.get_goal(db, goal_id)
    if not goal:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    return goal

@router.delete("/goals/{goal_id}")
def delete_goal(goal_id: uuid.UUID, db: Session = Depends(get_db)):
    success = WorkflowService.delete_goal(db, goal_id)
    if not success:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    return {"detail": "Meta eliminada correctamente."}

@router.post("/goals/{goal_id}/progress", response_model=GoalResponse)
def update_goal_progress(goal_id: uuid.UUID, payload: UpdateGoalProgressRequest, db: Session = Depends(get_db)):
    goal = WorkflowService.update_goal_progress(db, goal_id, payload.value_change, payload.notes)
    if not goal:
        raise HTTPException(status_code=404, detail="Meta no encontrada.")
    return goal


# ----------------- HABIT TRACKING -----------------

@router.post("/habits", response_model=LearningHabitResponse, status_code=status.HTTP_201_CREATED)
def create_habit(payload: CreateLearningHabitRequest, db: Session = Depends(get_db)):
    return WorkflowService.create_habit(
        db, payload.name, payload.description, payload.frequency, payload.target_days_per_week
    )

@router.get("/habits", response_model=List[LearningHabitResponse])
def get_habits(db: Session = Depends(get_db)):
    return WorkflowService.get_habits(db)

@router.post("/habits/{habit_id}/record", status_code=status.HTTP_200_OK)
def record_habit_completion(habit_id: uuid.UUID, db: Session = Depends(get_db)):
    WorkflowService.record_habit_completion(db, habit_id)
    return {"detail": "Hábito registrado correctamente para el día de hoy."}

@router.get("/habits/{habit_id}/stats", response_model=HabitStatsResponse)
def get_habit_stats(habit_id: uuid.UUID, db: Session = Depends(get_db)):
    stats = WorkflowService.get_habit_stats(db, habit_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Hábito no encontrado.")
    return stats


# ----------------- SPACED REPETITION -----------------

@router.post("/reviews", response_model=ReviewItemResponse, status_code=status.HTTP_201_CREATED)
def create_review_item(payload: CreateReviewItemRequest, db: Session = Depends(get_db)):
    return WorkflowService.create_review_item(
        db, payload.note_id, payload.quiz_id, payload.question_index, payload.flashcard_front, payload.flashcard_back
    )

@router.get("/reviews", response_model=List[ReviewItemResponse])
def get_review_items(due_only: bool = False, db: Session = Depends(get_db)):
    return WorkflowService.get_review_items(db, due_only)

@router.post("/reviews/{item_id}/submit", response_model=ReviewItemResponse)
def submit_review(item_id: uuid.UUID, payload: SubmitReviewRequest, db: Session = Depends(get_db)):
    item = WorkflowService.submit_review(db, item_id, payload.quality)
    if not item:
        raise HTTPException(status_code=404, detail="Elemento de repaso no encontrado.")
    return item

@router.get("/reviews/due", response_model=List[ReviewItemResponse])
def get_due_reviews(db: Session = Depends(get_db)):
    return WorkflowService.get_review_items(db, due_only=True)


# ----------------- AI-ASSISTED REVIEW ENHANCEMENTS -----------------

@router.post("/reviews/{item_id}/ai-concept-check")
async def generate_ai_concept_check(item_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Usa LLM para generar una pregunta o prompt de verificación conceptual dinámico
    basado en el contenido del ítem de repaso (Nota o Quiz).
    """
    item = db.get(ReviewItem, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Elemento de repaso no encontrado.")

    content = ""
    if item.note:
        content = f"Nota del usuario: {item.note.content}"
    elif item.quiz and item.question_index is not None:
        try:
            q_info = item.quiz.questions[item.question_index]
            content = f"Pregunta del quiz: {q_info.get('question')} - Respuesta esperada: {q_info.get('answer')}"
        except IndexError:
            content = "Detalle de pregunta de quiz no encontrado."
    elif item.flashcard_front:
        content = f"Tarjeta Flashcard - Anverso: {item.flashcard_front} - Reverso: {item.flashcard_back}"
    else:
        content = "Material de repaso no estructurado."

    prompt = (
        f"Basándote en el siguiente contenido, formula una única pregunta de verificación conceptual de alta calidad "
        f"para ayudar al usuario a repasar este tema de manera activa. No incluyas opciones de respuesta ni explicaciones largas, "
        f"solo la pregunta y una guía de respuesta corta entre corchetes.\n\nContenido: {content}"
    )

    response = await LLMService.generate_response("tutor_chat", context=content, question=prompt)
    return {"concept_check_question": response}
