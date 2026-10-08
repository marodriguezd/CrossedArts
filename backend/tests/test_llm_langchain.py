import pytest
import asyncio


def test_prompt_template_registry_valid():
    from backend.app.services.llm import PromptTemplateRegistry
    prompt = PromptTemplateRegistry.get_prompt("tutor_chat", context="Rust", question="¿Qué es ownership?")
    assert "Rust" in prompt["user"]
    assert "ownership" in prompt["user"]
    assert len(prompt["system"]) > 0


def test_prompt_template_registry_all_templates_exist():
    from backend.app.services.llm import PromptTemplateRegistry
    for name in ["tutor_chat", "generate_quiz", "summarize_notes", "generate_flashcards"]:
        prompt = PromptTemplateRegistry.get_prompt(name, context="test", question="test")
        assert "system" in prompt
        assert "user" in prompt


def test_prompt_template_registry_invalid():
    from backend.app.services.llm import PromptTemplateRegistry
    with pytest.raises(ValueError, match="not found"):
        PromptTemplateRegistry.get_prompt("nonexistent_template")


def test_prompt_template_registry_quiz():
    from backend.app.services.llm import PromptTemplateRegistry
    prompt = PromptTemplateRegistry.get_prompt("generate_quiz", context="Python basics")
    assert "Python basics" in prompt["user"]
    assert "cuestionario" in prompt["system"].lower() or "quiz" in prompt["system"].lower()


def test_mock_response_quiz():
    from backend.app.services.llm import LLMService
    response = LLMService._mock_response("Genera un quiz sobre Python")
    assert "q1" in response
    assert "multiple_choice" in response


def test_mock_response_summary():
    from backend.app.services.llm import LLMService
    response = LLMService._mock_response("Resume este contenido")
    assert "Resumen" in response


def test_mock_response_flashcard():
    from backend.app.services.llm import LLMService
    response = LLMService._mock_response("Crea flashcards")
    assert "front" in response
    assert "back" in response


def test_mock_response_default():
    from backend.app.services.llm import LLMService
    response = LLMService._mock_response("¿Qué es FastAPI?")
    assert "mock" in response.lower() or "ejemplo" in response.lower()


def test_llm_service_provider_name():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    name = LLMService.get_provider_name()
    assert name == "mock-llm-provider"


def test_llm_service_model_name():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    name = LLMService.get_model_name()
    assert name == "mock"


def test_llm_service_is_not_available_in_mock():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    assert LLMService.is_available() is False


def test_llm_service_get_provider_none():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    assert LLMService.get_provider() is None


@pytest.mark.asyncio
async def test_llm_generate_mock():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    response = await LLMService.generate("¿Qué es Python?")
    assert len(response) > 0
    assert "mock" in response.lower() or "ejemplo" in response.lower()


@pytest.mark.asyncio
async def test_llm_generate_with_system_prompt():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    response = await LLMService.generate("Responde algo", system_prompt="Sé breve")
    assert len(response) > 0


@pytest.mark.asyncio
async def test_llm_generate_response_template():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    response = await LLMService.generate_response(
        "tutor_chat", context="Python es un lenguaje", question="¿Qué es Python?"
    )
    assert len(response) > 0


@pytest.mark.asyncio
async def test_llm_generate_stream_mock():
    from backend.app.services.llm import LLMService
    LLMService._initialized = False
    LLMService._chat_model = None
    chunks = []
    async for chunk in LLMService.generate_stream("Pregunta streaming"):
        chunks.append(chunk)
    assert len(chunks) > 0
    assert len("".join(chunks)) > 0


@pytest.mark.asyncio
async def test_llm_generate_structured_returns_none_in_mock():
    from backend.app.services.llm import LLMService
    from backend.app.schemas.ai import QuizQuestion
    LLMService._initialized = False
    LLMSA_service = LLMService
    result = await LLMService.generate_structured("Genera quiz", "Sistema", QuizQuestion)
    assert result is None
