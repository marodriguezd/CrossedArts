import uuid
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from backend.app.core.database import get_db
from backend.app.models.content import Quiz, ContentIndex
from backend.app.models.activity import Note

from backend.app.services.llm import LLMService
from backend.app.services.context import ContextRetrievalService
from backend.app.services.insights import LearningInsightsService
from backend.app.services.ai_validation import (
    StudyMaterialValidationError,
    strip_code_fences,
    validate_flashcards,
    validate_quiz_questions,
)

router = APIRouter(prefix="/ai", tags=["Learning AI"])

# Pydantic Schemas
class TutorQuestionRequest(BaseModel):
    resource_id: uuid.UUID
    question: str

class QuizGenerationRequest(BaseModel):
    resource_id: uuid.UUID
    title: Optional[str] = "Cuestionario de Repaso"

class NotesOperationRequest(BaseModel):
    note_ids: List[uuid.UUID]


@router.post("/tutor")
async def ask_tutor(payload: TutorQuestionRequest, db: Session = Depends(get_db)):
    """
    Realiza una consulta al tutor inteligente, extrayendo primero contexto local relevante (RAG).
    """
    context = ContextRetrievalService.get_context_for_resource(
        db, 
        payload.resource_id, 
        payload.question, 
        limit=4
    )
    response = await LLMService.generate_response(
        "tutor_chat", 
        context=context, 
        question=payload.question
    )
    return {"answer": response, "grounding_context_used": context}


@router.post("/quiz")
async def generate_quiz(payload: QuizGenerationRequest, db: Session = Depends(get_db)):
    """
    Genera un quiz de preguntas de opción múltiple y cortas a partir del contenido del recurso.
    El quiz generado es almacenado de forma persistente.
    """
    # Intentar obtener fragmentos de texto del recurso para alimentar el generador
    from sqlalchemy import select
    stmt = (
        select(ContentIndex.content)
        .join(ContentIndex.media_asset)
        .where(ContentIndex.media_asset.has(resource_id=payload.resource_id))
        .limit(10)
    )
    text_chunks = db.scalars(stmt).all()
    
    # Fallback si no hay texto de ContentIndex, buscar notas
    if not text_chunks:
        stmt_notes = select(Note.content).where(Note.resource_id == payload.resource_id)
        text_chunks = db.scalars(stmt_notes).all()

    context = "\n\n".join(text_chunks) if text_chunks else "No hay material físico indexado para este recurso."
    
    quiz_json_str = await LLMService.generate_response("generate_quiz", context=context)

    # Validación estructural estricta: JSON válido NO es suficiente. Material
    # malformado, vacío o con tipos de pregunta inválidos devuelve un error
    # controlado; nunca se persiste ni se fabrica contenido genérico disfrazado
    # de generación exitosa.
    try:
        questions = validate_quiz_questions(json.loads(strip_code_fences(quiz_json_str)))
    except (json.JSONDecodeError, StudyMaterialValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"El material generado por el modelo no superó la validación: {exc}"
        )

    # Guardar en BD
    quiz = Quiz(
        id=uuid.uuid4(),
        resource_id=payload.resource_id,
        title=payload.title,
        questions=questions
    )
    db.add(quiz)
    db.commit()

    return {
        "id": quiz.id,
        "title": quiz.title,
        "questions": quiz.questions,
        "created_at": quiz.created_at
    }


@router.get("/quizzes/{resource_id}")
def list_resource_quizzes(resource_id: uuid.UUID, db: Session = Depends(get_db)):
    """
    Lista todos los cuestionarios generados previamente para un recurso.
    """
    from sqlalchemy import select
    stmt = select(Quiz).where(Quiz.resource_id == resource_id).order_by(Quiz.created_at.desc())
    quizzes = db.scalars(stmt).all()
    return [
        {
            "id": q.id,
            "title": q.title,
            "questions": q.questions,
            "created_at": q.created_at
        }
        for q in quizzes
    ]


@router.post("/notes/summarize")
async def summarize_notes(payload: NotesOperationRequest, db: Session = Depends(get_db)):
    """
    Agrupa y resume una selección de notas en un informe estructurado Markdown.
    """
    from sqlalchemy import select
    stmt = select(Note.content).where(Note.id.in_(payload.note_ids))
    contents = db.scalars(stmt).all()
    
    if not contents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontraron notas válidas.")

    context = "\n---\n".join(contents)
    summary = await LLMService.generate_response("summarize_notes", context=context)
    return {"summary": summary}


@router.post("/notes/flashcards")
async def generate_flashcards(payload: NotesOperationRequest, db: Session = Depends(get_db)):
    """
    Genera tarjetas flashcards a partir del contenido de notas seleccionadas.
    """
    from sqlalchemy import select
    stmt = select(Note.content).where(Note.id.in_(payload.note_ids))
    contents = db.scalars(stmt).all()
    
    if not contents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No se encontraron notas válidas.")

    context = "\n---\n".join(contents)
    flashcard_json_str = await LLMService.generate_response("generate_flashcards", context=context)

    # Misma validación estricta que el quiz: sin fallback fabricado. Un fallo de
    # generación o de validación se comunica como tal (HTTP 502).
    try:
        flashcards = validate_flashcards(json.loads(strip_code_fences(flashcard_json_str)))
    except (json.JSONDecodeError, StudyMaterialValidationError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"El material generado por el modelo no superó la validación: {exc}"
        )

    return {"flashcards": flashcards}


@router.get("/insights")
def get_study_insights(db: Session = Depends(get_db)):
    """
    Informe analítico con recomendaciones, patrones de estudio y recursos olvidados.
    """
    return LearningInsightsService.generate_insights(db)
