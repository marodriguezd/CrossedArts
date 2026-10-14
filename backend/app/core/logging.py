"""
CrossedArts structured logging.

Every backend module logs via `get_logger(...)` instead of `print(...)`: diagnostics
stay tagged with level and module, can be silenced by configuration, and never
end up on stdout mixed with API output.

Content rules (never log):
- API keys or secrets,
- user personal data,
- full file or model contents,
- long LLM outputs.
Messages must stay short yet sufficient for diagnosis.
"""
import logging
import os

_ROOT_LOGGER_NAME = "crossedarts"
_configured = False


def configure_logging(level: str | None = None) -> None:
    """Configure the project root logger exactly once."""
    global _configured
    if _configured:
        return

    resolved_level = (level or os.getenv("CROSSEDARTS_LOG_LEVEL", "INFO")).upper()
    handler = logging.StreamHandler()
    handler.setFormatter(
        logging.Formatter(
            fmt="%(asctime)s %(levelname)-7s [%(name)s] %(message)s",
            datefmt="%H:%M:%S",
        )
    )

    root = logging.getLogger(_ROOT_LOGGER_NAME)
    root.setLevel(getattr(logging, resolved_level, logging.INFO))
    root.addHandler(handler)
    # No propagation: avoids duplicate messages when the host app already
    # configured the Python root logger.
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    """Return a project logger (`crossedarts.<name>`)."""
    configure_logging()
    return logging.getLogger(f"{_ROOT_LOGGER_NAME}.{name}")
