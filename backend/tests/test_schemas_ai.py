import pytest
from pydantic import ValidationError


def test_quiz_question_valid():
    from backend.app.schemas.ai import QuizQuestion
    q = QuizQuestion(
        id="q1",
        question="¿Qué es Python?",
        options=["Lenguaje", "Framework"],
        answer="Lenguaje",
        type="multiple_choice",
    )
    assert q.id == "q1"
    assert q.type == "multiple_choice"


def test_quiz_question_short_answer():
    from backend.app.schemas.ai import QuizQuestion
    q = QuizQuestion(
        id="q2",
        question="Explica qué es una variable",
        options=[],
        answer="Un contenedor de datos",
        type="short_answer",
    )
    assert q.type == "short_answer"
    assert q.options == []


def test_quiz_question_missing_required():
    from backend.app.schemas.ai import QuizQuestion
    with pytest.raises(ValidationError):
        QuizQuestion(id="q1", question="test")


def test_tutor_response():
    from backend.app.schemas.ai import TutorResponse
    r = TutorResponse(answer="Una respuesta", sources=["source1"])
    assert r.answer == "Una respuesta"
    assert len(r.sources) == 1


def test_tutor_response_defaults():
    from backend.app.schemas.ai import TutorResponse
    r = TutorResponse(answer="Solo respuesta")
    assert r.sources == []


def test_concept_check():
    from backend.app.schemas.ai import ConceptCheck
    c = ConceptCheck(question="¿Qué es X?", guide="[Es Y]")
    assert c.question == "¿Qué es X?"
    assert c.guide == "[Es Y]"


def test_summary_response():
    from backend.app.schemas.ai import SummaryResponse
    s = SummaryResponse(summary="## Resumen\nPuntos clave")
    assert "Resumen" in s.summary


def test_flashcard():
    from backend.app.schemas.ai import Flashcard
    f = Flashcard(front="Pregunta", back="Respuesta")
    assert f.front == "Pregunta"
    assert f.back == "Respuesta"


def test_flashcard_set():
    from backend.app.schemas.ai import FlashcardSet, Flashcard
    fs = FlashcardSet(flashcards=[
        Flashcard(front="Q1", back="A1"),
        Flashcard(front="Q2", back="A2"),
    ])
    assert len(fs.flashcards) == 2
    assert fs.flashcards[0].front == "Q1"
