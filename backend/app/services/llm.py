"""
LLM Service using LangChain.
Provides chat model abstraction with Mock, Ollama, and OpenAI providers.
"""
from typing import Optional, AsyncGenerator, Dict, Any
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage, AIMessage
from langchain_core.prompts import ChatPromptTemplate
from backend.app.core.settings import settings


class PromptTemplateRegistry:
    """Registry of prompt templates for different AI tasks."""

    TEMPLATES = {
        "tutor_chat": {
            "system": "Eres un tutor académico riguroso y conciso. Responde siempre en español. Basándote EXCLUSIVAMENTE en el contexto proporcionado, responde la pregunta del estudiante de forma clara y educativa. Si el contexto no contiene información suficiente, indícalo honestamente.",
            "human": "Contexto:\n{context}\n\nPregunta: {question}"
        },
        "generate_quiz": {
            "system": "Eres un diseñador instruccional. Genera un cuestionario interactivo en formato JSON estricto. Responde SOLO con el JSON, sin explicaciones adicionales. El JSON debe ser una lista de objetos con las claves: id, question, options (lista de strings, vacía si es short_answer), answer, type ('multiple_choice' o 'short_answer'). Genera exactamente 3 preguntas mixtas.",
            "human": "Basándote en el siguiente contenido, genera un cuestionario de 3 preguntas (mixtas: opciones múltiples y respuesta corta):\n\n{context}"
        },
        "summarize_notes": {
            "system": "Resume y condensa las notas de estudio provistas. Sé conciso pero incluye todos los conceptos clave. Formatea en Markdown con títulos y listas.",
            "human": "Notas:\n{context}\n\nGenera un resumen Markdown organizado."
        },
        "generate_flashcards": {
            "system": "Crea flashcards de estudio (pregunta/respuesta rápida) basadas en el contenido proporcionado. Formato JSON estricto: lista de objetos con 'front' (pregunta) y 'back' (respuesta). Genera entre 3 y 6 flashcards.",
            "human": "Contenido:\n{context}"
        }
    }

    @classmethod
    def get_prompt(cls, template_name: str, **kwargs) -> Dict[str, str]:
        template = cls.TEMPLATES.get(template_name)
        if not template:
            raise ValueError(f"Template '{template_name}' not found")
        return {
            "system": template["system"],
            "user": template["human"].format(**kwargs)
        }


class LLMService:
    """Service for LLM operations using LangChain."""

    _chat_model: Optional[BaseChatModel] = None
    _initialized: bool = False

    @classmethod
    def initialize(cls) -> None:
        """Initialize the LLM provider based on settings."""
        if cls._initialized:
            return

        provider = settings.llm_provider

        if provider == "openai" and settings.openai_api_key:
            try:
                from langchain_openai import ChatOpenAI
                cls._chat_model = ChatOpenAI(
                    model=settings.openai_model,
                    api_key=settings.openai_api_key,
                    base_url=settings.openai_api_base,
                    temperature=0.2,
                    timeout=60,
                    max_tokens=2048,
                )
            except ImportError:
                print("[CrossedArts] langchain-openai not installed. Using mock LLM.")
                cls._chat_model = None
        elif provider == "ollama":
            try:
                try:
                    from langchain_ollama import OllamaLLM
                    base_url = settings.ollama_api_url.replace("/api/generate", "")
                    cls._chat_model = OllamaLLM(
                        model=settings.ollama_model,
                        base_url=base_url,
                    )
                except ImportError:
                    from langchain_community.llms import Ollama
                    base_url = settings.ollama_api_url.replace("/api/generate", "")
                    cls._chat_model = Ollama(
                        model=settings.ollama_model,
                        base_url=base_url,
                    )
            except ImportError:
                print("[CrossedArts] langchain-ollama/langchain-community not installed. Using mock LLM.")
                cls._chat_model = None
        else:
            cls._chat_model = None  # Mock mode

        cls._initialized = True
        mode = provider if cls._chat_model else "mock"
        print(f"[CrossedArts] LLM Service initialized: {mode}")

    @classmethod
    def initialize_from_env(cls, client=None) -> None:
        """Initialize from environment settings (backward compatibility).
        
        The client parameter is ignored in LangChain implementation as LangChain
        manages its own HTTP clients.
        """
        cls.initialize()

    @classmethod
    def get_provider_name(cls) -> str:
        """Get the name of the current provider (backward compatibility)."""
        if not cls._initialized:
            cls.initialize()
        if cls._chat_model is None:
            return "mock-llm-provider"
        return settings.openai_model if settings.llm_provider == "openai" else settings.ollama_model

    @classmethod
    def get_provider(cls):
        """Get the current provider (backward compatibility)."""
        return cls._chat_model

    @classmethod
    async def generate(cls, prompt: str, system_prompt: Optional[str] = None) -> str:
        """Generate a response using the configured LLM."""
        if not cls._initialized:
            cls.initialize()

        if cls._chat_model is None:
            return cls._mock_response(prompt)

        messages = []
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        messages.append(HumanMessage(content=prompt))

        try:
            result = await cls._chat_model.ainvoke(messages)
            return result.content
        except Exception as e:
            print(f"[CrossedArts] LLM error: {e}")
            raise

    @classmethod
    async def generate_structured(cls, prompt: str, system_prompt: Optional[str], schema):
        """Generate a structured response using LangChain's with_structured_output."""
        if not cls._initialized:
            cls.initialize()

        if cls._chat_model is None:
            return None

        messages = []
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        messages.append(HumanMessage(content=prompt))

        try:
            structured_model = cls._chat_model.with_structured_output(schema)
            result = await structured_model.ainvoke(messages)
            return result
        except Exception as e:
            print(f"[CrossedArts] LLM structured output error: {e}")
            return None

    @classmethod
    async def generate_stream(cls, prompt: str, system_prompt: Optional[str] = None) -> AsyncGenerator[str, None]:
        """Generate a streaming response."""
        if not cls._initialized:
            cls.initialize()

        if cls._chat_model is None:
            yield cls._mock_response(prompt)
            return

        messages = []
        if system_prompt:
            messages.append(SystemMessage(content=system_prompt))
        messages.append(HumanMessage(content=prompt))

        try:
            async for chunk in cls._chat_model.astream(messages):
                if chunk.content:
                    yield chunk.content
        except Exception as e:
            print(f"[CrossedArts] LLM stream error: {e}")
            raise

    @classmethod
    async def generate_response(cls, template_name: str, **kwargs) -> str:
        """Generate a response using a named template (backward compatibility)."""
        if not cls._initialized:
            cls.initialize()

        prompt_data = PromptTemplateRegistry.get_prompt(template_name, **kwargs)
        return await cls.generate(
            prompt=prompt_data["user"],
            system_prompt=prompt_data["system"]
        )

    @classmethod
    def _mock_response(cls, prompt: str) -> str:
        """Generate a mock response for development/testing."""
        prompt_lower = prompt.lower()
        if "quiz" in prompt_lower or "cuestionario" in prompt_lower:
            return '[{"id":"q1","question":"Pregunta de ejemplo","options":["A","B","C"],"answer":"A","type":"multiple_choice"}]'
        elif "resumen" in prompt_lower or "resume" in prompt_lower:
            return "## Resumen\n\nEste es un resumen de ejemplo generado en modo mock."
        elif "flashcard" in prompt_lower:
            return '[{"front":"Pregunta de ejemplo","back":"Respuesta de ejemplo"}]'
        else:
            return "Esta es una respuesta de ejemplo del Tutor de CrossedArts (modo mock). Para obtener respuestas reales, configura un proveedor de LLM en tu entorno o en ~/.crossedarts/.env"

    @classmethod
    def get_model_name(cls) -> str:
        """Get the name of the current model."""
        if not cls._initialized:
            cls.initialize()
        if cls._chat_model is None:
            return "mock"
        return settings.openai_model if settings.llm_provider == "openai" else settings.ollama_model

    @classmethod
    def is_available(cls) -> bool:
        """Check if a real LLM is configured."""
        if not cls._initialized:
            cls.initialize()
        return cls._chat_model is not None
