import os
from pathlib import Path
from typing import Optional
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class CrossedArtsSettings(BaseSettings):
    """
    Centralized configuration for CrossedArts.
    Loads from ~/.crossedarts/.env or legacy ~/.domestik/.env automatically.
    All values can be overridden via environment variables.
    """
    model_config = SettingsConfigDict(
        env_file=str(
            (Path.home() / ".crossedarts" / ".env")
            if (Path.home() / ".crossedarts" / ".env").exists()
            else (Path.home() / ".domestik" / ".env")
        ),
        env_file_encoding="utf-8",
        extra="ignore",
        env_file_optional=True,  # Don't fail if .env doesn't exist
    )

    # === Server ===
    port: int = Field(default=8080, description="Server port")
    host: str = Field(default="127.0.0.1", description="Server bind host")

    # Computed after init
    api_base_url: str = Field(default="", description="API base URL (auto-computed)")

    # === CORS ===
    # Lista separada por comas de orígenes permitidos. Por defecto, los orígenes
    # locales reales del frontend (Vite en 5173) y del propio backend.
    cors_origins: str = Field(
        default=(
            "http://localhost:5173,http://127.0.0.1:5173,"
            "http://localhost:8080,http://127.0.0.1:8080"
        ),
        description="Orígenes CORS permitidos, separados por comas",
    )

    # === Database ===
    database_url: str = Field(default="", description="SQLAlchemy database URL (auto-computed from data_dir)")

    # === LLM ===
    llm_provider: str = Field(default="mock", description="LLM provider: mock, ollama, openai")
    openai_api_key: str = Field(default="", description="OpenAI API key")
    openai_api_base: str = Field(default="https://api.openai.com/v1", description="OpenAI-compatible API base URL")
    openai_model: str = Field(default="gpt-4o-mini", description="OpenAI model name")
    ollama_api_url: str = Field(default="http://localhost:11434/api/generate", description="Ollama API URL")
    ollama_model: str = Field(default="llama3:8b", description="Ollama model name")

    # === Embeddings ===
    embedding_provider: str = Field(default="mock", description="Embedding provider: mock, ollama, openai, huggingface")
    # Número máximo de registros de embedding explorados por búsqueda semántica.
    # El límite se aplica en SQL (no en memoria) y acota el coste del cálculo de
    # similitud en Python. Ver backend/app/services/vector_store.py (A-4).
    semantic_scan_limit: int = Field(default=3000, description="Máximo de embeddings explorados por búsqueda semántica")
    ollama_embed_url: str = Field(default="http://localhost:11434/api/embeddings", description="Ollama embeddings URL")
    ollama_embed_model: str = Field(default="nomic-embed-text", description="Ollama embedding model")
    openai_embed_model: str = Field(default="text-embedding-3-small", description="OpenAI embedding model")
    huggingface_embed_model: str = Field(default="sentence-transformers/all-MiniLM-L6-v2", description="HuggingFace local embedding model")

    # === LangChain (optional) ===
    langchain_tracing_v2: bool = Field(default=False, description="Enable LangSmith tracing")
    langchain_api_key: str = Field(default="", description="LangSmith API key")
    langchain_project: str = Field(default="crossedarts", description="LangSmith project name")

    def model_post_init(self, __context) -> None:
        """Auto-compute derived fields after initialization."""
        # Auto-compute api_base_url if not explicitly set
        if not self.api_base_url:
            object.__setattr__(self, 'api_base_url', f"http://127.0.0.1:{self.port}/api/v1")

        # Auto-compute database_url if not explicitly set
        if not self.database_url:
            db_path = self.db_path
            object.__setattr__(self, 'database_url', f"sqlite:///{db_path}")

    @property
    def cors_origin_list(self) -> list[str]:
        """Orígenes CORS permitidos como lista limpia (sin entradas vacías)."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def data_dir(self) -> Path:
        """
        User data directory.

        Compatibilidad DomestiK (intencional, no accidental): el proyecto era
        anteriormente DomestiK y conserva rutas heredadas para no perder los
        datos de usuarios existentes.
          - Directorio actual: ~/.crossedarts/
          - Directorio legado: ~/.domestik/ (solo se usa si ya existe y el
            directorio actual todavía no existe)
        """
        legacy_dir = Path.home() / ".domestik"
        primary_dir = Path.home() / ".crossedarts"
        if legacy_dir.exists() and not primary_dir.exists():
            return legacy_dir
        return primary_dir

    @property
    def db_path(self) -> Path:
        """
        Path to the SQLite database file.

        Compatibilidad DomestiK (intencional): dentro del directorio de datos se
        prefiere crossedarts.db y solo se usa domestik.db si es el único que
        existe.
        """
        legacy_db = self.data_dir / "domestik.db"
        primary_db = self.data_dir / "crossedarts.db"
        if legacy_db.exists() and not primary_db.exists():
            return legacy_db
        return primary_db

    @property
    def media_dir(self) -> Path:
        """Directory for imported content (courses/books)."""
        return self.data_dir / "content"

    @property
    def covers_dir(self) -> Path:
        """Directory for uploaded cover images."""
        return self.data_dir / "covers"

    @property
    def static_dir(self) -> Path:
        """Static assets bundled with the project (not user data)."""
        return Path(__file__).parent.parent.parent.parent / "static"

    def ensure_dirs(self) -> None:
        """Create all user data directories if they don't exist."""
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.media_dir.mkdir(parents=True, exist_ok=True)
        self.covers_dir.mkdir(parents=True, exist_ok=True)


# Singleton instance and backward-compatibility alias
# `DomestiKSettings` se conserva para importaciones heredadas de la etapa
# DomestiK. Los nombres de campo se leen TAL CUAL por pydantic-settings: no se
# aplica ningún prefijo automático (ver .env.example).
settings = CrossedArtsSettings()
DomestiKSettings = CrossedArtsSettings

