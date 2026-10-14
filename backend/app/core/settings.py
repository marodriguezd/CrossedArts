from pathlib import Path
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.app.core.compatibility import (
    resolve_legacy_data_dir,
    resolve_legacy_db_path,
    resolve_legacy_env_file,
)


class CrossedArtsSettings(BaseSettings):
    """
    Centralized configuration for CrossedArts.
    Loads from ~/.crossedarts/.env or legacy ~/.domestik/.env automatically.
    All values can be overridden via environment variables.
    """
    model_config = SettingsConfigDict(
        env_file=str(resolve_legacy_env_file()),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # === Server ===
    port: int = Field(default=8080, description="Server port")
    host: str = Field(default="127.0.0.1", description="Server bind host")
    # Explicit opt-in to expose the API beyond loopback. The API has no auth:
    # listening stays localhost-only by default, so changing HOST never
    # exposes it to the network silently.
    allow_network_access: bool = Field(
        default=False,
        description="Allow binding the API to non-local interfaces (no auth)",
    )

    # Computed after init
    api_base_url: str = Field(default="", description="API base URL (auto-computed)")

    # === CORS ===
    # Comma-separated list of allowed origins. Defaults to the real local
    # frontend origins (Vite on 5173) and the backend itself.
    cors_origins: str = Field(
        default=(
            "http://localhost:5173,http://127.0.0.1:5173,"
            "http://localhost:8080,http://127.0.0.1:8080"
        ),
        description="Allowed CORS origins, comma-separated",
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
    # Max embedding records scanned per semantic search. The limit applies in
    # SQL (not in memory) and bounds the Python similarity cost.
    # See backend/app/services/vector_store.py.
    semantic_scan_limit: int = Field(default=3000, description="Max embeddings scanned per semantic search")
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
    def is_localhost_binding(self) -> bool:
        """True only when the configured host is loopback (no network exposure)."""
        return self.host.strip().lower() in {"127.0.0.1", "localhost", "::1"}

    @property
    def cors_origin_list(self) -> list[str]:
        """Allowed CORS origins as a clean list (no empty entries)."""
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def data_dir(self) -> Path:
        """User data directory, respecting legacy DomestiK fallback."""
        return resolve_legacy_data_dir()

    @property
    def db_path(self) -> Path:
        """Path to SQLite database file, respecting legacy DomestiK fallback."""
        return resolve_legacy_db_path(self.data_dir)

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
# `DomestiKSettings` is kept for legacy imports from the DomestiK stage. Field
# names are read AS IS by pydantic-settings: no automatic prefix applies
# (see .env.example).
settings = CrossedArtsSettings()
DomestiKSettings = CrossedArtsSettings

