"""Structural validation of LLM-generated study material.

The frontend already validates structure AND grounding of local-model answers
(studyGeneration/validators.ts). The backend used to `json.loads()` and swap
failure for fabricated generic material presented as a successful generation.
This module centralizes backend validation so malformed or empty material is
NEVER persisted or returned as valid.
"""
from typing import Any, Dict, List, Optional, Tuple

# Sane size limits: neither empty batches nor absurd volumes.
MAX_QUESTIONS = 20
MAX_FLASHCARDS = 30
MAX_OPTIONS = 6
MAX_TEXT_LENGTH = 2000

ALLOWED_QUESTION_TYPES = {"multiple_choice", "short_answer"}


class StudyMaterialValidationError(ValueError):
    """LLM-generated material fails the minimum structure."""


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _extract_list(payload: Any, list_keys: Tuple[str, ...]) -> Optional[List[Any]]:
    """Acepta una lista directa o un objeto que envuelve la lista en `list_keys`."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for key in list_keys:
            candidate = payload.get(key)
            if isinstance(candidate, list):
                return candidate
    return None


def validate_quiz_questions(
    payload: Any,
    *,
    min_questions: int = 1,
    max_questions: int = MAX_QUESTIONS,
) -> List[Dict[str, Any]]:
    """
    Validate a quiz-question batch's structure.

    Requires: a list of `min_questions..max_questions` items; each an object with
    a non-empty prompt, an allowed type ('multiple_choice'|'short_answer'), and
    a present answer; multiple-choice needs 2..MAX_OPTIONS unique non-empty
    options including the answer.
    """
    if payload is None:
        raise StudyMaterialValidationError("La respuesta del modelo está vacía.")

    items = _extract_list(payload, ("questions", "quiz"))
    if items is None:
        raise StudyMaterialValidationError(
            "El material generado debe ser una lista de preguntas o un objeto con la propiedad 'questions'."
        )
    if not (min_questions <= len(items) <= max_questions):
        raise StudyMaterialValidationError(
            f"El cuestionario debe contener entre {min_questions} y {max_questions} preguntas (recibidas: {len(items)})."
        )

    validated: List[Dict[str, Any]] = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise StudyMaterialValidationError(f"La pregunta {index + 1} no es un objeto válido.")
        question = _clean_text(item.get("question") or item.get("pregunta"))
        answer = _clean_text(item.get("answer") or item.get("respuesta"))
        q_type = (item.get("type") or item.get("tipo") or "multiple_choice").strip().lower()
        options = item.get("options", item.get("opciones", []))

        if len(question) < 5:
            raise StudyMaterialValidationError(f"El enunciado de la pregunta {index + 1} es demasiado corto o está vacío.")
        if not answer:
            raise StudyMaterialValidationError(f"La pregunta {index + 1} no tiene respuesta.")
        if q_type not in ALLOWED_QUESTION_TYPES:
            raise StudyMaterialValidationError(
                f"La pregunta {index + 1} tiene un tipo no permitido: '{q_type}'."
            )

        if q_type == "multiple_choice":
            if not isinstance(options, list):
                raise StudyMaterialValidationError(f"Las opciones de la pregunta {index + 1} deben ser una lista.")
            cleaned_options = [_clean_text(o) for o in options if _clean_text(o)]
            if not (2 <= len(cleaned_options) <= MAX_OPTIONS):
                raise StudyMaterialValidationError(
                    f"La pregunta {index + 1} debe tener entre 2 y {MAX_OPTIONS} opciones no vacías (recibidas: {len(cleaned_options)})."
                )
            lowered = [o.lower() for o in cleaned_options]
            if len(set(lowered)) != len(lowered):
                raise StudyMaterialValidationError(f"La pregunta {index + 1} tiene opciones duplicadas.")
            if answer.lower() not in lowered:
                raise StudyMaterialValidationError(
                    f"La respuesta de la pregunta {index + 1} no figura entre las opciones."
                )
            final_options = cleaned_options
        else:
            final_options = []

        validated.append({
            "id": str(item.get("id") or f"q{index + 1}"),
            "question": question[:MAX_TEXT_LENGTH],
            "options": final_options,
            "answer": answer[:MAX_TEXT_LENGTH],
            "type": q_type,
        })

    return validated


def validate_flashcards(
    payload: Any,
    *,
    min_cards: int = 1,
    max_cards: int = MAX_FLASHCARDS,
) -> List[Dict[str, str]]:
    """
    Validate a flashcard batch's structure.

    Requires: a list of `min_cards..max_cards` items, each with non-empty
    length-bounded front (front/question) and back (back/answer). Rejects exact
    front duplicates.
    """
    if payload is None:
        raise StudyMaterialValidationError("La respuesta del modelo está vacía.")

    items = _extract_list(payload, ("flashcards", "cards"))
    if items is None:
        raise StudyMaterialValidationError(
            "El material generado debe ser una lista de tarjetas o un objeto con la propiedad 'flashcards'."
        )
    if not (min_cards <= len(items) <= max_cards):
        raise StudyMaterialValidationError(
            f"El lote debe contener entre {min_cards} y {max_cards} tarjetas (recibidas: {len(items)})."
        )

    validated: List[Dict[str, str]] = []
    seen_fronts = set()
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise StudyMaterialValidationError(f"La tarjeta {index + 1} no es un objeto válido.")
        front = _clean_text(item.get("front") or item.get("question") or item.get("anverso"))
        back = _clean_text(item.get("back") or item.get("answer") or item.get("reverso"))

        if len(front) < 3:
            raise StudyMaterialValidationError(f"El anverso de la tarjeta {index + 1} es demasiado corto o está vacío.")
        if len(back) < 2:
            raise StudyMaterialValidationError(f"El reverso de la tarjeta {index + 1} es demasiado corto o está vacío.")

        key = front.lower()
        if key in seen_fronts:
            continue  # Duplicado exacto: se descarta sin invalidar el lote.
        seen_fronts.add(key)

        validated.append({
            "front": front[:MAX_TEXT_LENGTH],
            "back": back[:MAX_TEXT_LENGTH],
        })

    if not validated:
        raise StudyMaterialValidationError("No quedaron tarjetas válidas tras descartar duplicados.")

    return validated


def strip_code_fences(raw_text: str) -> str:
    """Extrae el JSON de una respuesta que puede venir envuelta en fences Markdown."""
    text = (raw_text or "").strip()
    if text.startswith("```"):
        first_newline = text.find("\n")
        if first_newline != -1:
            text = text[first_newline + 1:]
        closing = text.rfind("```")
        if closing != -1:
            text = text[:closing]
    return text.strip()
